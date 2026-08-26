'use strict'

/**
 * paper-highlight · durable host plugin (profile host row, Step 4 wiring)
 *
 * Registers one webserver route on the dsh web server:
 *
 *   GET  /paper-hl/read[?paperId=<id>]
 *   → { ok, paperId, paperMd, anchors, highlights, sections, papers }
 *   | { ok: false, error }
 *
 *   POST /paper-hl/write?paperId=<id>
 *   body { action, ... } (v0.2 Phase 1 review actions, see host/actions.js)
 *   → { ok, paper_id, action, span?, section?, span_count } | { ok:false, error }
 *
 * This is the durable port of the Step-3 dynamic host half
 * (dynamic/host-half.js → harness.handle('paper.read')): same payload shape,
 * same read path (data/<paper_id>/* via host/store.js), served over HTTP so
 * the shipped client bundle (client/client.js) can fetch it with plain
 * `fetch('/paper-hl/read')`. Mounted when this package appears as a bundle in
 * a profile composition (see cordis.patch.yml).
 *
 * Zero external dependencies: node builtins + sibling store modules only, so
 * the package resolves cleanly through the profile junction tree.
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const { readPaperMd, readAnchors, readHighlights, writeHighlights } = require('./store')
const { buildSections } = require('./sections')
const { applyAction } = require('./actions')

const name = 'paper-highlight'
const inject = ['webServer']

/**
 * Workspace root holding data/ — resolution order:
 *   1. composition config `root` (the profile patch pins it, e.g. D:\aa)
 *   2. PAPER_HL_ROOT env override
 *   3. process.cwd() — the launch directory; fallback only, because
 *      `dsh --profile paper` may be started from any directory (a restart from
 *      the user's home dir made /paper-hl/read scan C:\Users\eyx\data → 500).
 */
function workspaceRoot(config) {
  return (config && config.root) || process.env.PAPER_HL_ROOT || process.cwd()
}

async function listPaperIds(root) {
  const dataDir = path.join(root, 'data')
  const names = await fsp.readdir(dataDir, { withFileTypes: true })
  return names
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/** Attach the matching plan entry (status/reviewed_at/plan) to each built section. */
function mergePlanStatus(sections, plan) {
  const planSections = (plan && plan.sections) || []
  for (const s of sections) {
    const entry = planSections.find((e) => e.id === s.id || e.section === s.title)
    if (entry) s.plan = entry
  }
  return sections
}

async function handleRead(root, requested) {
  const papers = await listPaperIds(root)
  if (papers.length === 0) return { ok: false, error: 'no papers under data/ (run parse_pdf first)' }
  const paperId = requested && papers.includes(requested) ? requested : papers[0]
  const [paperMd, anchors, highlights] = await Promise.all([
    readPaperMd(root, paperId),
    readAnchors(root, paperId),
    readHighlights(root, paperId),
  ])
  const sections = mergePlanStatus(buildSections({ paperMd, anchors }), highlights.plan)
  return { ok: true, paperId, paperMd, anchors, highlights, sections, papers }
}

/** Collect the request body (stream in the real server, mock in tests). */
function readBody(req) {
  if (typeof req.on !== 'function') {
    return Promise.resolve(typeof req.body === 'string' ? req.body : '')
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(Buffer.concat(chunks).toString('utf8'))
    }
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => finish())
    req.on('error', (e) => finish(e))
  })
}

async function handleWrite(root, url, req, res, sendJson) {
  const paperId = url.searchParams.get('paperId')
  if (!paperId) {
    sendJson(res, 400, { ok: false, error: 'missing paperId query param' })
    return
  }
  const papers = await listPaperIds(root)
  if (!papers.includes(paperId)) {
    sendJson(res, 404, { ok: false, error: `unknown paperId: ${paperId}` })
    return
  }
  let action
  try {
    action = JSON.parse((await readBody(req)) || '{}')
  } catch {
    sendJson(res, 400, { ok: false, error: 'request body must be valid JSON' })
    return
  }
  try {
    const highlights = await readHighlights(root, paperId)
    const paperMd = await readPaperMd(root, paperId)
    const sections = buildSections({ paperMd, anchors: highlights.anchors })
    const result = applyAction(highlights, action, { sections })
    await writeHighlights(root, paperId, highlights)
    sendJson(res, 200, {
      ok: true,
      paper_id: paperId,
      action: action.action ?? null,
      span: result.span ?? null,
      section: result.section ?? null,
      span_count: highlights.spans.length,
    })
  } catch (err) {
    // validation / unknown-id / range errors → 400 (client bug, not a crash)
    sendJson(res, 400, { ok: false, error: String(err && err.message ? err.message : err) })
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function apply(ctx, config) {
  const root = workspaceRoot(config)
  const route = {
    kind: 'prefix',
    path: '/paper-hl',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://dsh-local')
      try {
        if (url.pathname === '/paper-hl/read' && (req.method === 'GET' || req.method === undefined)) {
          const requested = url.searchParams.get('paperId') || null
          const payload = await handleRead(root, requested)
          sendJson(res, payload.ok ? 200 : 500, payload)
          return
        }
        if (url.pathname === '/paper-hl/write' && req.method === 'POST') {
          await handleWrite(root, url, req, res, sendJson)
          return
        }
        sendJson(res, 404, { ok: false, error: 'not found' })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) })
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'paper-highlight: /paper-hl route')
}

module.exports = { name, inject, apply, handleRead, listPaperIds, buildSections, mergePlanStatus }
