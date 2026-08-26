'use strict'

/**
 * paper-highlight · end-to-end pipeline: MinerU parse → normalize → store.
 * Shared by the CLI tests and (later) the agent tool implementation.
 */

const path = require('node:path')

const { parsePdf } = require('./mineru')
const { normalizeMineruZip } = require('./normalize')
const { writePaper } = require('./store')

/** Derive a stable-ish paper id from a PDF filename (ascii slug). */
function paperIdFromPdfPath(pdfPath) {
  const base = path.basename(pdfPath, path.extname(pdfPath))
  const slug = base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, ' ') // drop non-ascii (e.g. CJK)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `p-${slug || 'paper'}`
}

/**
 * Full pipeline for one local PDF.
 * @param {object} opts { pdfPath, root, paperId?, title?, mineruConfig?, onProgress? }
 * @returns {Promise<{taskId, zipPath, dir, paperMd, anchors, meta}>}
 */
async function processPdf(opts) {
  const paperId = opts.paperId ?? paperIdFromPdfPath(opts.pdfPath)
  const mineruOpts = {
    ...(opts.mineruConfig ?? {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  }
  const { batchId, zipPath, workDir } = await parsePdf(opts.pdfPath, mineruOpts)
  const { paperMd, anchors, meta } = await normalizeMineruZip({
    zipPath,
    paperId,
    title: opts.title,
    sourcePdf: opts.pdfPath,
    mineruTask: batchId,
  })
  const dir = await writePaper(opts.root, paperId, { paperMd, anchors, meta })
  return { batchId, zipPath, workDir, dir, paperId, paperMd, anchors, meta }
}

module.exports = { paperIdFromPdfPath, processPdf }
