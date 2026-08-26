'use strict'

/**
 * paper-highlight · dynamic dual-half plugin — HOST half (Step 3 verification)
 *
 * This module's export is a SELF-CONTAINED JavaScript function body handed to
 * `cordis_define` as `code.host`. It is evaluated in the harness process
 * inside a node:vm sandbox: no Node globals (require/process/fs), no imports —
 * services arrive through `inject` and the guarded ctx; file access uses the
 * cordis `fs` service (resolve + readText/listDir). Everything the body needs
 * must live inside the string.
 *
 * Registers one invoke handler for the paired browser half:
 *   harness.handle('paper.read', (args) => JsonValue)
 *   args: { paperId?: string }   — omitted/empty → auto-pick first paper
 *   returns: { ok: true, paperId, paperMd, anchors, highlights, papers }
 *          | { ok: false, error }
 *
 * Durable port: host/http.js (Step 4) mirrors this handler verbatim as a
 * webserver route so the shipped client bundle can fetch the same payload.
 */

const BODY = String.raw`
const ROOT = 'D:/aa'
const joinPath = (root, ...parts) => [root, ...parts].join('/')

async function readText(ctx, path) {
  const target = await ctx.fs.resolve(path, { cwd: ROOT })
  return ctx.fs.readText(target)
}
async function readJson(ctx, path) {
  return JSON.parse(await readText(ctx, path))
}
async function listPapers(ctx) {
  const dirTarget = await ctx.fs.resolve(joinPath(ROOT, 'data'), { cwd: ROOT })
  const entries = await ctx.fs.listDir(dirTarget)
  return entries
    .filter((e) => e.type === 'directory')
    .map((e) => e.name)
    .sort()
}
async function readPaperBundle(ctx, paperId) {
  const base = joinPath(ROOT, 'data', paperId)
  const paperMd = await readText(ctx, joinPath(base, 'paper.md'))
  const anchors = await readJson(ctx, joinPath(base, 'anchors.json'))
  const highlights = await readJson(ctx, joinPath(base, 'paper.highlights.json'))
  return { paperId, paperMd, anchors, highlights }
}
async function handleRead(ctx, args) {
  const requested = args && typeof args.paperId === 'string' && args.paperId.trim() !== '' ? args.paperId.trim() : null
  try {
    const papers = await listPapers(ctx)
    if (papers.length === 0) return { ok: false, error: 'no papers under data/ (run parse_pdf first)' }
    const paperId = requested && papers.includes(requested) ? requested : papers[0]
    const bundle = await readPaperBundle(ctx, paperId)
    return { ok: true, ...bundle, papers }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  }
}

return {
  inject: ['fs'],
  apply(ctx) {
    ctx.effect(() => harness.handle('paper.read', (args) => handleRead(ctx, args)), 'paper-highlight: paper.read invoke handler')
  }
}
`

module.exports = BODY
