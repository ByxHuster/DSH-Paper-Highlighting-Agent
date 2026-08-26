'use strict'

/**
 * paper-highlight · MinerU cloud API client (design §2, §4.1)
 *
 * Calibrated against the official docs (mineru.net/apiManage/docs), 2025:
 *
 *   Auth:   Authorization: Bearer {token}          (NOT X-Token)
 *   Upload: POST /api/v4/file-urls/batch           {files:[{name,data_id}], model_version, ...}
 *           -> {data: {batch_id, file_urls[]}}
 *           PUT file_urls[i] with the raw bytes    (NO Content-Type header)
 *           The system auto-submits the parse task once the upload completes —
 *           no explicit task-creation call needed.
 *   Poll:   GET /api/v4/extract-results/batch/{batch_id}
 *           -> data.extract_result[0].{file_name, state, err_msg, full_zip_url}
 *           states: waiting-file | pending | running | converting | done | failed
 *   Zip:    full_zip_url contains full.md (Markdown) + layout.json (middle
 *           structure: page/block/line) + *_model.json + *_content_list.json.
 *
 * A URL-mode fallback (POST /api/v4/extract/task with {url}) is provided for
 * public-URL inputs; uploadMode: 'url' selects it.
 */

const fsp = require('node:fs/promises')
const path = require('node:path')
const https = require('node:https')
const http = require('node:http')

const DEFAULT_BASE_URL = 'https://mineru.net'
const DONE = 'done'

class MineruError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'MineruError'
    this.code = code // http status, api code, or short label
    this.details = details
  }
}

/** Resolve config from env with explicit overrides winning. */
function resolveMineruConfig(overrides = {}) {
  const apiKey = overrides.apiKey ?? process.env.MINERU_API ?? process.env.MinerU_API ?? ''
  const baseUrl = overrides.baseUrl ?? process.env.MINERU_BASE_URL ?? DEFAULT_BASE_URL
  const uploadMode = overrides.uploadMode ?? process.env.MINERU_UPLOAD_MODE ?? 'file'
  const modelVersion = overrides.modelVersion ?? process.env.MINERU_MODEL ?? 'vlm'
  const language = overrides.language ?? process.env.MINERU_LANGUAGE ?? 'en'
  const isOcr = overrides.isOcr ?? process.env.MINERU_OCR === '1'
  const enableFormula = overrides.enableFormula ?? process.env.MINERU_FORMULA !== '0'
  const enableTable = overrides.enableTable ?? process.env.MINERU_TABLE !== '0'
  if (!apiKey) {
    throw new MineruError('NO_API_KEY', 'MinerU API key missing: set MINERU_API (or MinerU_API) or pass apiKey')
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), uploadMode, modelVersion, language, isOcr, enableFormula, enableTable }
}

function request(method, url, { headers = {}, body, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch (err) {
      reject(new MineruError('BAD_URL', `invalid url: ${url}`))
      return
    }
    // MinerU's API gateway and the presigned OSS upload endpoint both reject
    // requests without Content-Length (chunked transfer-encoding causes
    // `-10002 type mismatch for field "files"` on POST /api/v4/file-urls/batch
    // and would fail the PUT upload too). Set it explicitly for any body.
    const hdrs = { ...headers }
    if (body !== undefined && hdrs['Content-Length'] === undefined && hdrs['content-length'] === undefined) {
      hdrs['Content-Length'] = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body))
    }
    const lib = parsed.protocol === 'http:' ? http : https
    const req = lib.request(
      parsed,
      { method, headers: hdrs },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        })
      },
    )
    req.on('error', (err) => reject(new MineruError('NETWORK', `request to ${parsed.host} failed: ${err.message}`)))
    req.setTimeout(timeoutMs, () => {
      req.destroy(new MineruError('TIMEOUT', `request to ${url} timed out after ${timeoutMs}ms`))
    })
    if (body !== undefined) req.write(body)
    req.end()
  })
}

async function requestJson(method, url, { token, body, timeoutMs }) {
  const res = await request(method, url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs,
  })
  let parsed = null
  const text = res.body.toString('utf8')
  try {
    parsed = JSON.parse(text)
  } catch {
    /* non-JSON response */
  }
  if (res.status < 200 || res.status >= 300) {
    throw new MineruError(String(res.status), `MinerU ${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`, parsed)
  }
  if (parsed && parsed.code !== undefined && parsed.code !== 0) {
    throw new MineruError(`API_${parsed.code}`, `MinerU api error ${parsed.code}: ${parsed.msg || JSON.stringify(parsed).slice(0, 300)}`, parsed)
  }
  return parsed ?? {}
}

/**
 * Request presigned upload URLs for local files (batch flow).
 * @returns {Promise<{batchId: string, fileUrls: string[]}>}
 */
async function requestUploadUrls({ apiKey, baseUrl, files, modelVersion, language, enableFormula, enableTable }) {
  const body = {
    files,
    model_version: modelVersion,
    language,
    enable_formula: enableFormula,
    enable_table: enableTable,
  }
  const res = await requestJson('POST', `${baseUrl}/api/v4/file-urls/batch`, { token: apiKey, body })
  const d = res.data ?? {}
  const fileUrls = Array.isArray(d.file_urls) ? d.file_urls : []
  if (!d.batch_id || fileUrls.length === 0) {
    throw new MineruError('NO_UPLOAD_URL', 'MinerU file-urls/batch returned no batch_id/file_urls', res)
  }
  return { batchId: d.batch_id, fileUrls }
}

/** PUT one local file to a presigned upload URL. No Content-Type header (per docs). */
async function putFile(uploadUrl, data) {
  const res = await request('PUT', uploadUrl, { body: data, timeoutMs: 180000 })
  if (res.status < 200 || res.status >= 300) {
    throw new MineruError(String(res.status), `presigned upload failed: ${res.status} ${res.body.toString('utf8').slice(0, 200)}`)
  }
}

/** Create a single parse task from a public URL (URL mode). */
async function createTaskFromUrl({ apiKey, baseUrl, url, modelVersion, language, isOcr, enableFormula, enableTable }) {
  const body = {
    url,
    model_version: modelVersion,
    language,
    is_ocr: isOcr,
    enable_formula: enableFormula,
    enable_table: enableTable,
  }
  const res = await requestJson('POST', `${baseUrl}/api/v4/extract/task`, { token: apiKey, body })
  const taskId = res.data?.task_id
  if (!taskId) throw new MineruError('NO_TASK_ID', 'MinerU extract/task returned no task_id', res)
  return taskId
}

/** Extract the first actionable result entry from a poll response. */
function firstExtractResult(data) {
  if (data && Array.isArray(data.extract_result) && data.extract_result.length > 0) return data.extract_result[0]
  if (data && typeof data === 'object' && 'state' in data) return data
  return null
}

/**
 * Poll a batch (upload flow) or single task (url flow) until done/failed/timeout.
 * @returns {Promise<{state: string, fullZipUrl: string, errMsg: string}>}
 */
async function pollTask({ apiKey, baseUrl, id, isBatch = true, intervalMs = 4000, timeoutMs = 900000, onProgress }) {
  const url = isBatch
    ? `${baseUrl}/api/v4/extract-results/batch/${encodeURIComponent(id)}`
    : `${baseUrl}/api/v4/extract/task/${encodeURIComponent(id)}`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await requestJson('GET', url, { token: apiKey })
    const entry = firstExtractResult(res.data ?? {})
    if (!entry) {
      if (Date.now() > deadline) throw new MineruError('TASK_TIMEOUT', `Mineru task ${id} returned no result entry`)
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }
    const state = entry.state ?? 'unknown'
    if (typeof onProgress === 'function') onProgress(entry)
    if (state === DONE) return { state, fullZipUrl: entry.full_zip_url ?? '', errMsg: entry.err_msg ?? '' }
    if (state === 'failed') {
      throw new MineruError('TASK_FAILED', `MinerU task failed: ${entry.err_msg ?? 'unknown error'}`, entry)
    }
    if (Date.now() > deadline) {
      throw new MineruError('TASK_TIMEOUT', `MinerU task ${id} not done within ${timeoutMs}ms (last state: ${state})`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/** Download full_zip_url to a local file. */
async function downloadZip(url, destPath) {
  const res = await request('GET', url, { timeoutMs: 300000 })
  if (res.status < 200 || res.status >= 300) {
    throw new MineruError(String(res.status), `zip download failed: ${res.status}`)
  }
  await fsp.writeFile(destPath, res.body)
  return destPath
}

/**
 * Full parse pipeline for one local PDF: request upload url → PUT file →
 * poll (system auto-submits) → download zip.
 * @returns {Promise<{batchId: string, state: string, zipPath: string, workDir: string}>}
 */
async function parsePdf(pdfPath, options = {}) {
  const cfg = resolveMineruConfig(options)
  const data = await fsp.readFile(pdfPath)
  const name = path.basename(pdfPath)

  const { batchId, fileUrls } = await requestUploadUrls({
    ...cfg,
    files: options.dataId ? [{ name, data_id: options.dataId }] : [{ name }],
  })
  if (fileUrls.length !== 1) {
    throw new MineruError('BAD_UPLOAD_URLS', `expected exactly 1 upload url for 1 file, got ${fileUrls.length}`, { batchId, fileUrls })
  }
  await putFile(fileUrls[0], data)

  const { state, fullZipUrl } = await pollTask({ ...cfg, id: batchId, isBatch: true, onProgress: options.onProgress })
  const workDir = options.workDir ?? path.join(path.dirname(pdfPath), '.mineru-work', batchId)
  await fsp.mkdir(workDir, { recursive: true })
  const zipPath = path.join(workDir, `${batchId}.zip`)
  await downloadZip(fullZipUrl, zipPath)
  return { batchId, state, zipPath, workDir }
}

/** URL-mode parse: submit a public URL, poll a single task, download zip. */
async function parsePdfFromUrl(publicUrl, options = {}) {
  const cfg = resolveMineruConfig({ ...options, uploadMode: 'url' })
  const taskId = await createTaskFromUrl({ ...cfg, url: publicUrl })
  const { state, fullZipUrl } = await pollTask({ ...cfg, id: taskId, isBatch: false, onProgress: options.onProgress })
  const workDir = options.workDir ?? path.join(process.cwd(), '.mineru-work', taskId)
  await fsp.mkdir(workDir, { recursive: true })
  const zipPath = path.join(workDir, `${taskId}.zip`)
  await downloadZip(fullZipUrl, zipPath)
  return { taskId, state, zipPath, workDir }
}

module.exports = {
  MineruError,
  resolveMineruConfig,
  request,
  requestJson,
  requestUploadUrls,
  putFile,
  createTaskFromUrl,
  pollTask,
  downloadZip,
  parsePdf,
  parsePdfFromUrl,
}
