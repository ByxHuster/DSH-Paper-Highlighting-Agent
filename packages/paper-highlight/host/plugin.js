'use strict'

/**
 * paper-highlight · durable host plugin (profile host row, Step 4 wiring)
 *
 * Registers one webserver route on the dsh web server:
 *
 *   GET /paper-hl/read[?paperId=<id>]
 *   → { ok: true, paperId, paperMd, anchors, highlights, papers }
 *   | { ok: false, error }
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

const { readPaperMd, readAnchors, readHighlights } = require('./store')

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

async function handleRead(root, requested) {
  const papers = await listPaperIds(root)
  if (papers.length === 0) return { ok: false, error: 'no papers under data/ (run parse_pdf first)' }
  const paperId = requested && papers.includes(requested) ? requested : papers[0]
  const [paperMd, anchors, highlights] = await Promise.all([
    readPaperMd(root, paperId),
    readAnchors(root, paperId),
    readHighlights(root, paperId),
  ])
  return { ok: true, paperId, paperMd, anchors, highlights, papers }
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
      if (url.pathname !== '/paper-hl/read') {
        sendJson(res, 404, { ok: false, error: 'not found' })
        return
      }
      const requested = url.searchParams.get('paperId') || null
      try {
        const payload = await handleRead(root, requested)
        sendJson(res, payload.ok ? 200 : 500, payload)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) })
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'paper-highlight: /paper-hl route')
}

module.exports = { name, inject, apply, handleRead, listPaperIds }
