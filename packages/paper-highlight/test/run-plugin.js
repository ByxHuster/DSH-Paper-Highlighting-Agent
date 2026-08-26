'use strict'

/**
 * paper-highlight · host plugin route regression test (Step 4 post-fix + v0.2 Phase 1)
 *
 * Guards the /paper-hl webserver routes:
 *
 *   GET  /paper-hl/read[?paperId]  — serves data/<paper_id> with config.root
 *        (cwd-independent), and now includes the derived `sections` index
 *        (v0.2 Phase 1) with plan status merged.
 *   POST /paper-hl/write?paperId   — review actions (accept/reject/recolor/
 *        rescope/add/note/review_section) applied + persisted; validation
 *        matrix: unknown paperId → 404, bad action/range → 400, missing body
 *        paperId → 400.
 *
 * The write tests run against a throwaway fixture under test/.tmp (gitignored)
 * so the REAL paper data (data/p-mikolov-2013-2013-1-word2vec, 5 spans) is
 * never mutated.
 *
 * Run:  node test/run-plugin.js
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const plugin = require('../host/plugin')
const { writePaper, writeHighlights, readHighlights } = require('../host/store')
const { newHighlightsSkeleton } = require('../host/schema')
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

/** invoke(handler, req) → Promise<res>. For POST, pass req.body (mock string body). */
function invoke(handler, req) {
  return new Promise((resolve) => {
    const res = { status: 0, body: '' }
    res.writeHead = (s) => { res.status = s }
    res.end = (b) => { res.body = b; resolve(res) }
    handler(req, res)
  })
}

/** Build a throwaway paper fixture under test/.tmp (gitignored) → { root, paperId }. */
async function seedFixture() {
  const root = path.join(__dirname, '.tmp', 'v02-fixture')
  await fsp.rm(root, { recursive: true, force: true })
  const md = ['# Title', '', '## Abstract', '', 'Abstract body text.', '', '## References', ''].join('\n')
  const find = (s) => md.indexOf(s)
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: find('Title') },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'title', text: 'Abstract', md_offset: find('Abstract') },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'Abstract body text.', md_offset: find('Abstract body text.') },
    'a-0001-04-01': { page: 1, block: 4, par: 1, type: 'title', text: 'References', md_offset: find('References') },
  }
  await writePaper(root, 'p-test', {
    paperMd: md,
    anchors,
    meta: { id: 'p-test', title: 'Title', source_pdf: 's.pdf', mineru_task: 'm', stats: { kept_blocks: 4 } },
  })
  const doc = newHighlightsSkeleton({ id: 'p-test', title: 'Title', sourcePdf: 's.pdf', mineruTask: 'm' })
  doc.anchors = anchors
  doc.plan.sections = [{ id: 's2', section: 'Abstract', status: 'pending' }]
  doc.spans = [
    { id: 's-001', anchor: 'a-0001-03-01', char_start: 0, char_end: 7, color: 'red', rationale: 'core', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
  ]
  await writeHighlights(root, 'p-test', doc)
  return { root, paperId: 'p-test' }
}

async function main() {
  // ── 1) apply with an explicit config.root ──────────────────────────────────
  const ctx = fakeCtx()
  plugin.apply(ctx, { root: ROOT })
  assert(ctx.captured.length === 1, 'one route registered')
  const route = ctx.captured[0]
  assert(route.kind === 'prefix' && route.path === '/paper-hl', 'prefix route /paper-hl')

  // ── 2) GET /read serves the real paper from config.root (cwd-independent) ──
  const ok = await invoke(route.handler, { url: '/paper-hl/read' })
  const j = JSON.parse(ok.body)
  assert(ok.status === 200 && j.ok === true, 'route serves a paper (200 ok)')
  assert(j.paperId === 'p-mikolov-2013-2013-1-word2vec', 'first paper is the real one')
  assert(j.anchors && Object.keys(j.anchors).length === 80, '80 anchors served')
  assert(Array.isArray(j.highlights.spans) && j.highlights.spans.length === 5, '5 spans served')

  // ── 3) GET /read returns the derived section index (v0.2 Phase 1) ──────────
  assert(Array.isArray(j.sections) && j.sections.length === 22, '22 sections derived')
  const refs = j.sections.find((s) => s.title === 'References')
  assert(refs && refs.empty === true && refs.kind === 'section', 'References is an empty section')
  const title = j.sections[0]
  assert(title && title.kind === 'paper_title' && title.level === 1, 'first section is the paper title (level 1)')
  assert(j.sections.every((s) => typeof s.id === 'string' && Array.isArray(s.anchor_ids) && s.anchor_ids.length > 0), 'every section carries id + anchor_ids')

  // ── 4) unknown paperId falls back to the first paper ───────────────────────
  const fb = await invoke(route.handler, { url: '/paper-hl/read?paperId=missing' })
  const jf = JSON.parse(fb.body)
  assert(fb.status === 200 && jf.ok === true && jf.paperId === j.paperId, 'unknown paperId falls back')

  // ── 5) non-/read, non-/write path → 404 JSON ───────────────────────────────
  const nf = await invoke(route.handler, { url: '/paper-hl/other' })
  assert(nf.status === 404 && JSON.parse(nf.body).ok === false, 'unknown /paper-hl path -> 404')

  // ── 6) missing root dir → JSON error body, not a crash ─────────────────────
  const ctx2 = fakeCtx()
  plugin.apply(ctx2, { root: path.join(__dirname, '.tmp', 'no-such-root') })
  const miss = await invoke(ctx2.captured[0].handler, { url: '/paper-hl/read' })
  assert(miss.status === 500 && JSON.parse(miss.body).ok === false, 'missing root dir -> 500 JSON error body')

  // ══════════════════ v0.2 Phase 1: POST /paper-hl/write ══════════════════════
  const fx = await seedFixture()
  const ctx3 = fakeCtx()
  plugin.apply(ctx3, { root: fx.root })
  const wroute = ctx3.captured[0]

  const post = (url, action) => invoke(wroute.handler, {
    method: 'POST',
    url: '/paper-hl/write' + (url ? '?' + url : ''),
    // a string action is used as the RAW body (malformed-JSON case); objects are JSON-encoded
    body: action === undefined ? '' : (typeof action === 'string' ? action : JSON.stringify(action)),
  })

  // 7) accept → span status flips + decision appended + persisted on disk
  const acc = await post('paperId=p-test', { action: 'accept', span_id: 's-001' })
  const ja = JSON.parse(acc.body)
  assert(acc.status === 200 && ja.ok === true, 'write accept -> 200 ok')
  assert(ja.action === 'accept' && ja.span.status === 'accepted' && ja.span_count === 1, 'accept response reflects new status')
  const onDisk = await readHighlights(fx.root, fx.paperId)
  assert(onDisk.spans[0].status === 'accepted' && onDisk.spans[0].decisions.length === 2, 'accept persisted (status + decision)')

  // 8) recolor → color updated with from/to decision
  const rec = await post('paperId=p-test', { action: 'recolor', span_id: 's-001', color: 'green' })
  const jr = JSON.parse(rec.body)
  assert(rec.status === 200 && jr.span.color === 'green', 'write recolor -> 200, color green')
  const rdec = jr.span.decisions[jr.span.decisions.length - 1]
  assert(rdec.action === 'recolored' && rdec.from === 'red' && rdec.to === 'green', 'recolor decision carries from/to')

  // 9) add → new span, next id, persisted
  const add = await post('paperId=p-test', { action: 'add', anchor: 'a-0001-03-01', char_start: 8, char_end: 14, color: 'yellow', rationale: 'user' })
  const ja2 = JSON.parse(add.body)
  assert(add.status === 200 && ja2.span.id === 's-002' && ja2.span.status === 'user_added', 'write add -> s-002 user_added')
  const onDisk2 = await readHighlights(fx.root, fx.paperId)
  assert(onDisk2.spans.length === 2, 'add persisted (2 spans)')

  // 10) review_section → plan.sections[s2].status=reviewed + merged into /read
  const rv = await post('paperId=p-test', { action: 'review_section', section: 's2' })
  const jrv = JSON.parse(rv.body)
  assert(rv.status === 200 && jrv.section.status === 'reviewed' && typeof jrv.section.reviewed_at === 'string', 'write review_section -> reviewed with timestamp')
  const rd = await invoke(wroute.handler, { url: '/paper-hl/read?paperId=p-test' })
  const jrd = JSON.parse(rd.body)
  const s2 = jrd.sections.find((s) => s.id === 's2')
  assert(s2 && s2.plan && s2.plan.status === 'reviewed', 'read merges plan status onto sections')

  // 11) review_section for a section not in plan → entry created
  const rv2 = await post('paperId=p-test', { action: 'review_section', section: 's3' })
  const jrv2 = JSON.parse(rv2.body)
  assert(rv2.status === 200 && jrv2.section.id === 's3' && jrv2.section.section === 'References', 'review_section creates missing entry with title')

  // ── negative write matrix ──
  const bad = await post('paperId=p-test', { action: 'accept', span_id: 's-999' })
  assert(bad.status === 400 && JSON.parse(bad.body).ok === false, 'unknown span id -> 400')
  const bad2 = await post('paperId=p-test', { action: 'nuke' })
  assert(bad2.status === 400 && JSON.parse(bad2.body).ok === false, 'unsupported action -> 400')
  const bad3 = await post('paperId=p-test', { action: 'add', anchor: 'a-0001-03-01', char_start: 0, char_end: 999, color: 'red' })
  assert(bad3.status === 400 && /out of bounds|range/.test(JSON.parse(bad3.body).error), 'out-of-range add -> 400')
  const bad4 = await post('paperId=does-not-exist', { action: 'accept', span_id: 's-001' })
  assert(bad4.status === 404 && JSON.parse(bad4.body).ok === false, 'unknown paperId -> 404')
  const bad5 = await post('', { action: 'accept', span_id: 's-001' })
  assert(bad5.status === 400 && /missing paperId/.test(JSON.parse(bad5.body).error), 'missing paperId -> 400')
  const bad6 = await post('paperId=p-test', 'not-json')
  assert(bad6.status === 400 && /JSON/.test(JSON.parse(bad6.body).error), 'malformed JSON body -> 400')
  const bad7 = await post('paperId=p-test')
  assert(bad7.status === 400 && JSON.parse(bad7.body).ok === false, 'missing action body -> 400 (unsupported undefined)')

  // 12) negative actions did not corrupt the persisted doc
  const final = await readHighlights(fx.root, fx.paperId)
  assert(final.spans.length === 2 && final.spans[0].status === 'accepted', 'document intact after negative matrix')

  // cleanup fixture
  await fsp.rm(fx.root, { recursive: true, force: true })

  console.log(JSON.stringify({
    step: 'plugin-route',
    result: 'PASS',
    config_root: 'cwd-independent data root (Step 4 restart regression guarded)',
    read: '/paper-hl/read -> 200, 80 anchors, 5 spans, 22 sections (References empty)',
    write: 'POST /paper-hl/write: accept/recolor/add/review_section applied + persisted; review status merged into read',
    write_negative: 'unknown span/action/paperId, bad range, malformed body, missing paperId -> 4xx',
    fallback: 'unknown paperId -> first paper; missing root -> 500 JSON',
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('PLUGIN ROUTE TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
