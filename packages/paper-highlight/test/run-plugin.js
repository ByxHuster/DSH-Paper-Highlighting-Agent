'use strict'

/**
 * paper-highlight · host plugin route regression test (Step 4 post-fix)
 *
 * Guards the /paper-hl/read webserver route against the Step-4 regression
 * where a restart from a different working directory made the plugin fall
 * back to process.cwd() (e.g. C:\Users\eyx) and return 500:
 * `ENOENT ... scandir '<cwd>\data'`.
 *
 * Verifies:
 *   - apply(ctx, {root}) registers the prefix route
 *   - the route serves data/<paper_id> with config.root, regardless of cwd
 *   - an unknown paperId falls back to the first paper
 *   - a missing root dir returns a JSON error body (not a crash)
 *
 * Run:  node test/run-plugin.js
 */

const path = require('node:path')

const plugin = require('../host/plugin')
const { assert } = require('./verify')

const ROOT = path.join(__dirname, '..', '..', '..') // D:\aa

function fakeCtx() {
  const captured = []
  return {
    effect: (fn) => fn(),
    webServer: { register: (route) => captured.push(route) },
    captured,
  }
}

function invoke(handler, url) {
  return new Promise((resolve) => {
    const res = { status: 0, body: '' }
    res.writeHead = (s) => { res.status = s }
    res.end = (b) => { res.body = b; resolve(res) }
    handler({ url }, res)
  })
}

async function main() {
  // 1) apply with an explicit config.root
  const ctx = fakeCtx()
  plugin.apply(ctx, { root: ROOT })
  assert(ctx.captured.length === 1, 'one route registered')
  const route = ctx.captured[0]
  assert(route.kind === 'prefix' && route.path === '/paper-hl', 'prefix route /paper-hl')

  // 2) route serves the real paper from config.root (cwd-independent)
  const ok = await invoke(route.handler, '/paper-hl/read')
  const j = JSON.parse(ok.body)
  assert(ok.status === 200 && j.ok === true, 'route serves a paper (200 ok)')
  assert(j.paperId === 'p-mikolov-2013-2013-1-word2vec', 'first paper is the real one')
  assert(j.anchors && Object.keys(j.anchors).length === 80, '80 anchors served')
  assert(Array.isArray(j.highlights.spans) && j.highlights.spans.length === 5, '5 spans served')

  // 3) unknown paperId falls back to the first paper
  const fb = await invoke(route.handler, '/paper-hl/read?paperId=missing')
  const jf = JSON.parse(fb.body)
  assert(fb.status === 200 && jf.ok === true && jf.paperId === j.paperId, 'unknown paperId falls back')

  // 4) non-/read path → 404 JSON
  const nf = await invoke(route.handler, '/paper-hl/other')
  assert(nf.status === 404 && JSON.parse(nf.body).ok === false, 'unknown /paper-hl path -> 404')

  // 5) missing root dir → JSON error body, not a crash
  const ctx2 = fakeCtx()
  plugin.apply(ctx2, { root: path.join(__dirname, '.tmp', 'no-such-root') })
  const miss = await invoke(ctx2.captured[0].handler, '/paper-hl/read')
  assert(miss.status === 500 && JSON.parse(miss.body).ok === false, 'missing root dir -> 500 JSON error body')

  console.log(JSON.stringify({
    step: 'plugin-route',
    result: 'PASS',
    config_root: 'cwd-independent data root (Step 4 restart regression guarded)',
    route: '/paper-hl/read -> 200, 80 anchors, 5 spans',
    fallback: 'unknown paperId -> first paper; missing root -> 500 JSON',
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('PLUGIN ROUTE TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
