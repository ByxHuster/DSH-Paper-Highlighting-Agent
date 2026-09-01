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
const { writeReflections, readReflections, profileDir, profileExists } = require('../host/profile')
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
    const res = { status: 0, body: '', headers: {} }
    res.writeHead = (s, h) => { res.status = s; res.headers = h || {} }
    res.end = (b) => { res.body = b; resolve(res) }
    handler(req, res)
  })
}

function marks(text) {
  return (text.match(/<mark/g) || []).length
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

/** v0.5.1 approve_section fixture: 2 proposed spans in Abstract + 1 in References. */
async function seedFixtureApprove() {
  const root = path.join(__dirname, '.tmp', 'v051-approve-fixture')
  await fsp.rm(root, { recursive: true, force: true })
  const md = ['# Title', '', '## Abstract', '', 'Abstract body text.', '', '## References', '', 'Ref item.'].join('\n')
  const find = (s) => md.indexOf(s)
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: find('Title') },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'title', text: 'Abstract', md_offset: find('Abstract') },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'Abstract body text.', md_offset: find('Abstract body text.') },
    'a-0001-04-01': { page: 1, block: 4, par: 1, type: 'title', text: 'References', md_offset: find('References') },
    'a-0001-05-01': { page: 1, block: 5, par: 1, type: 'text', text: 'Ref item.', md_offset: find('Ref item.') },
  }
  await writePaper(root, 'p-test2', {
    paperMd: md,
    anchors,
    meta: { id: 'p-test2', title: 'Title', source_pdf: 's.pdf', mineru_task: 'm', stats: { kept_blocks: 5 } },
  })
  const doc = newHighlightsSkeleton({ id: 'p-test2', title: 'Title', sourcePdf: 's.pdf', mineruTask: 'm' })
  doc.anchors = anchors
  doc.plan.sections = [{ id: 's2', section: 'Abstract', status: 'pending' }]
  doc.spans = [
    { id: 's-001', anchor: 'a-0001-03-01', char_start: 0, char_end: 7, color: 'red', rationale: 'core', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
    { id: 's-002', anchor: 'a-0001-03-01', char_start: 9, char_end: 12, color: 'blue', rationale: 'risk', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
    { id: 's-003', anchor: 'a-0001-05-01', char_start: 0, char_end: 4, color: 'yellow', rationale: 'ref', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
  ]
  await writeHighlights(root, 'p-test2', doc)
  return { root, paperId: 'p-test2' }
}

async function main() {
  // ── 1) apply with an explicit config.root ──────────────────────────────────
  const ctx = fakeCtx()
  plugin.apply(ctx, { root: ROOT })
  assert(ctx.captured.length === 1, 'one route registered')
  const route = ctx.captured[0]
  assert(route.kind === 'prefix' && route.path === '/paper-hl', 'prefix route /paper-hl')

  // ── 2) GET /read serves the real paper from config.root (cwd-independent) ──
  // Explicit paperId: with 3 papers under data/ the bare route picks the first
  // alphabetical one (p-bahdanau…), so address p-mikolov directly.
  const ok = await invoke(route.handler, { url: '/paper-hl/read?paperId=p-mikolov-2013-2013-1-word2vec' })
  const j = JSON.parse(ok.body)
  assert(ok.status === 200 && j.ok === true, 'route serves a paper (200 ok)')
  assert(j.paperId === 'p-mikolov-2013-2013-1-word2vec', 'explicit paperId resolves the real paper')
  assert(j.anchors && Object.keys(j.anchors).length === 80, '80 anchors served')
  // The real demo data may legitimately carry extra user-added spans from a
  // manual browser walkthrough (live /write add persists), or be empty after a
  // one-click format (一键格式化 wipes highlight records while keeping the
  // parsed paper). Guard the array SHAPE only — not specific spans/counts.
  assert(Array.isArray(j.highlights.spans), 'real data serves a spans array')

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
  assert(fb.status === 200 && jf.ok === true && typeof jf.paperId === 'string' && jf.paperId !== 'missing', 'unknown paperId falls back')

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

  // 11b) v0.5.1 approve_section on the (already accepted/user_added) fixture →
  //      empty batch (0 proposed left) but section still marked reviewed.
  const ap0 = await post('paperId=p-test', { action: 'approve_section', section: 's2' })
  const jap0 = JSON.parse(ap0.body)
  assert(ap0.status === 200 && jap0.ok === true && jap0.accepted_count === 0 && jap0.section.status === 'reviewed', 'approve_section: no proposed left → 0 accepted + reviewed')

  // ══════════════════ v0.5.1: approve_section route (batch accept) ══════════════════
  const fx2 = await seedFixtureApprove()
  const ctx4 = fakeCtx()
  plugin.apply(ctx4, { root: fx2.root })
  const w2 = ctx4.captured[0]
  const post2 = (url, action) => invoke(w2.handler, {
    method: 'POST',
    url: '/paper-hl/write' + (url ? '?' + url : ''),
    body: action === undefined ? '' : (typeof action === 'string' ? action : JSON.stringify(action)),
  })

  // 11c) approve_section Abstract → accepts its 2 proposed spans + reviewed.
  const ap = await post2('paperId=p-test2', { action: 'approve_section', section: 's2' })
  const jap = JSON.parse(ap.body)
  assert(ap.status === 200 && jap.ok === true && jap.action === 'approve_section', 'write approve_section -> 200')
  assert(jap.accepted_count === 2 && Array.isArray(jap.accepted) && jap.accepted.length === 2, 'approve_section accepts the 2 Abstract spans')
  assert(jap.accepted.every((s) => s.status === 'accepted'), 'approve_section response spans are accepted')
  assert(jap.section.status === 'reviewed', 'approve_section response section reviewed')
  const apDisk = await readHighlights(fx2.root, fx2.paperId)
  assert(apDisk.spans.filter((s) => s.status === 'accepted').length === 2 && apDisk.spans.find((s) => s.id === 's-003').status === 'proposed', 'approve_section persisted: Abstract accepted, References untouched')

  // 11d) approve_section References → accepts its 1 proposed span.
  const ap2 = await post2('paperId=p-test2', { action: 'approve_section', section: 's3' })
  const jap2 = JSON.parse(ap2.body)
  assert(jap2.accepted_count === 1 && jap2.accepted[0].id === 's-003', 'approve_section accepts the References span')
  assert(jap2.section.status === 'reviewed', 'approve_section marks References reviewed')

  // 11e) re-approving Abstract is idempotent (0 new accepts).
  const ap3 = await post2('paperId=p-test2', { action: 'approve_section', section: 's2' })
  assert(JSON.parse(ap3.body).accepted_count === 0, 'approve_section idempotent on re-approve')

  // 11f) empty section id → 400.
  const ap4 = await post2('paperId=p-test2', { action: 'approve_section', section: '' })
  assert(ap4.status === 400 && /section must be/.test(JSON.parse(ap4.body).error), 'approve_section empty section -> 400')

  // ══════════════════ v0.5.3: revert_section route (batch 反选 = 恢复待审) ══════════════════
  // Fresh fixture: 2 proposed in Abstract + 1 in References (all proposed).
  const fx3 = await seedFixtureApprove()
  const ctx5 = fakeCtx()
  plugin.apply(ctx5, { root: fx3.root })
  const w3 = ctx5.captured[0]
  const post3 = (url, action) => invoke(w3.handler, {
    method: 'POST',
    url: '/paper-hl/write' + (url ? '?' + url : ''),
    body: action === undefined ? '' : (typeof action === 'string' ? action : JSON.stringify(action)),
  })

  // 11g) approve Abstract first (2 accepted + reviewed), then revert_section →
  // the 2 accepted spans go back to proposed (待审) + the section back to pending.
  const rj = await post3('paperId=p-test2', { action: 'approve_section', section: 's2' })
  assert(rj.status === 200 && JSON.parse(rj.body).accepted_count === 2, 'write approve_section first (round-trip setup)')
  const rvr = await post3('paperId=p-test2', { action: 'revert_section', section: 's2' })
  const jrvr = JSON.parse(rvr.body)
  assert(rvr.status === 200 && jrvr.ok === true && jrvr.action === 'revert_section', 'write revert_section -> 200')
  assert(jrvr.reverted_count === 2 && Array.isArray(jrvr.reverted) && jrvr.reverted.length === 2, 'revert_section reverts the 2 Abstract accepted spans')
  assert(jrvr.reverted.every((s) => s.status === 'proposed'), 'revert_section response spans are proposed (待审)')
  assert(jrvr.section.status === 'pending' && jrvr.section.reviewed_at === undefined, 'revert_section response section pending (待审), no reviewed_at')
  const rvrDisk = await readHighlights(fx3.root, fx3.paperId)
  assert(rvrDisk.spans.filter((s) => s.status === 'proposed').length === 3 && rvrDisk.spans.find((s) => s.id === 's-001').status === 'proposed', 'revert_section persisted: Abstract spans back to proposed, References proposed untouched')

  // 11h) re-reverting Abstract is idempotent (0 new reverts).
  const rvr2 = await post3('paperId=p-test2', { action: 'revert_section', section: 's2' })
  assert(JSON.parse(rvr2.body).reverted_count === 0, 'revert_section idempotent on re-revert')

  // 11i) empty section id → 400.
  const rvr3 = await post3('paperId=p-test2', { action: 'revert_section', section: '' })
  assert(rvr3.status === 400 && /section must be/.test(JSON.parse(rvr3.body).error), 'revert_section empty section -> 400')

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

  // ══════════════════ v0.5.4: /paper-hl/propose-request (重新提出高亮) ══════════════════
  // POST writes a durable data/<paper_id>/propose-request.json {status:'pending'};
  // GET reads it back; missing paperId falls back to the first paper (like /read).
  const pr0 = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/propose-request?paperId=' + fx.paperId, body: JSON.stringify({ paper_id: fx.paperId }) })
  const jpr0 = JSON.parse(pr0.body)
  assert(pr0.status === 200 && jpr0.ok === true && jpr0.paper_id === fx.paperId && jpr0.status === 'pending', 'POST /propose-request: 200 + pending marker')
  const prDisk = await fsp.readFile(path.join(fx.root, 'data', fx.paperId, 'propose-request.json'), 'utf8')
  const jprDisk = JSON.parse(prDisk)
  assert(jprDisk.paper_id === fx.paperId && jprDisk.status === 'pending' && typeof jprDisk.requested_at === 'string' && typeof jprDisk.title === 'string', 'propose-request persisted to data/<id>/propose-request.json')
  const prGet = await invoke(wroute.handler, { url: '/paper-hl/propose-request?paperId=' + fx.paperId })
  const jprGet = JSON.parse(prGet.body)
  assert(prGet.status === 200 && jprGet.ok === true && jprGet.request.paper_id === fx.paperId, 'GET /propose-request reads the marker back')
  const prFb = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/propose-request', body: '{}' })
  const jprFb = JSON.parse(prFb.body)
  assert(prFb.status === 200 && jprFb.ok === true && typeof jprFb.paper_id === 'string' && jprFb.paper_id.length > 0, 'POST /propose-request falls back to the first paper')

  // ══════════════════ v0.3 Phase 0: /paper-hl/profile routes ══════════════════
  // GET /profile: no profile yet → has_profile:false (cold start signal for the
  // GUI onboarding); POST /init creates defaults (optionally merged colors +
  // cold-start rules); POST /apply?paperId confirms a reflections proposal.
  const g0 = await invoke(wroute.handler, { url: '/paper-hl/profile' })
  const jg0 = JSON.parse(g0.body)
  assert(g0.status === 200 && jg0.ok === true && jg0.has_profile === false, 'GET /paper-hl/profile: no profile yet (cold start)')
  assert(Array.isArray(jg0.pending_proposals) && jg0.pending_proposals.length === 0, 'GET /profile: no pending proposals yet')

  const init = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/profile/init', body: '{}' })
  const jinit = JSON.parse(init.body)
  assert(init.status === 200 && jinit.ok === true && jinit.created === true, 'POST /profile/init: creates the default profile')
  assert(jinit.colors === 5 && jinit.rules === 0, 'POST /profile/init: 5 default colors, no rules yet')

  const g1 = await invoke(wroute.handler, { url: '/paper-hl/profile' })
  const jg1 = JSON.parse(g1.body)
  assert(g1.status === 200 && jg1.has_profile === true, 'GET /profile: profile exists after init')
  assert(jg1.summary && jg1.summary.has_profile === true && Object.keys(jg1.summary.colors).length === 5, 'GET /profile: summary served')

  // init with onboarding body: custom colors + density/granularity baseline rules
  const init2 = await invoke(wroute.handler, {
    method: 'POST',
    url: '/paper-hl/profile/init',
    body: JSON.stringify({
      colors: { red: { color: '#ff9c94', label: '核心洞见' }, teal: { color: '#7fe0d0', label: '新颜色' } },
      rules: [
        { rule: 'density_per_section: 每节 3-5 处', enabled: true },
        { rule: 'granularity: 句子级', enabled: true },
      ],
    }),
  })
  const jinit2 = JSON.parse(init2.body)
  assert(init2.status === 200 && jinit2.ok === true, 'POST /profile/init: onboarding body accepted')
  const g2 = await invoke(wroute.handler, { url: '/paper-hl/profile' })
  const jg2 = JSON.parse(g2.body)
  assert(jg2.profile.colors.teal !== undefined && jg2.profile.colors.red.label === '核心洞见', 'init merged custom colors')
  assert(jg2.profile.rules.length === 2 && jg2.summary.density !== null && jg2.summary.granularity !== null, 'init stored cold-start baseline rules + summary extraction')

  // apply: confirm a proposal via the GUI channel (mirrors confirm_proposal tool)
  await writeReflections(fx.root, fx.paperId, {
    paper_id: fx.paperId,
    updated_at: '2026-08-27T00:00:00.000Z',
    sections: [{ section_id: 's2', counts: { accepted: 1, rejected: 0, recolored: 0, rescoped: 0, user_added: 0, pending: 0 } }],
    profile_proposal: {
      rules: [{ rule: 'value/density: 背景铺垫类句子不高亮', confidence: 'medium' }],
      exemplars: [],
      stats: { sections_reviewed: 1 },
    },
  })
  const apply = await invoke(wroute.handler, {
    method: 'POST',
    url: '/paper-hl/profile/apply?paperId=' + fx.paperId,
    body: JSON.stringify({ decisions: { accept: 'all' } }),
  })
  const japply = JSON.parse(apply.body)
  assert(apply.status === 200 && japply.ok === true && japply.applied.rules === 1, 'POST /profile/apply: proposal confirmed (1 rule)')
  assert(japply.confirmation && japply.confirmation.accepted === true, 'POST /profile/apply: confirmation recorded')
  const refOnDisk = await readReflections(fx.root, fx.paperId)
  assert(refOnDisk && refOnDisk.confirmation && refOnDisk.confirmation.accepted === true, 'apply persisted reflections.confirmation')
  const g3 = await invoke(wroute.handler, { url: '/paper-hl/profile' })
  const jg3 = JSON.parse(g3.body)
  assert(jg3.pending_proposals.length === 0, 'GET /profile: confirmed proposal no longer pending')

  // apply negatives
  const applyNoPaper = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/profile/apply', body: JSON.stringify({ decisions: { accept: 'all' } }) })
  assert(applyNoPaper.status === 400 && /missing paperId/.test(JSON.parse(applyNoPaper.body).error), 'apply without paperId -> 400')
  const applyUnknown = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/profile/apply?paperId=ghost', body: JSON.stringify({ decisions: { accept: 'all' } }) })
  assert(applyUnknown.status === 400 && /no reflections/.test(JSON.parse(applyUnknown.body).error), 'apply for paper without reflections -> 400')
  const applyTwice = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/profile/apply?paperId=' + fx.paperId, body: JSON.stringify({ decisions: { accept: 'all' } }) })
  assert(applyTwice.status === 400 && /already confirmed/.test(JSON.parse(applyTwice.body).error), 'apply twice -> 400 (append-only confirmation)')
  const initBad = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/profile/init', body: 'not-json' })
  assert(initBad.status === 400 && /JSON/.test(JSON.parse(initBad.body).error), 'init with malformed body -> 400')

  // ══════════════════ v0.3 Phase 3: POST /paper-hl/profile/save ══════════════════
  // GUI edit-panel write: partial update {colors?, rules?, exemplars?, reflection_notes?}
  // merged by applyProfileUpdate (stats NOT editable) → atomic write.
  const save = await invoke(wroute.handler, {
    method: 'POST',
    url: '/paper-hl/profile/save',
    body: JSON.stringify({
      colors: { red: { color: '#ff0000', label: '红核心' } },
      rules: [
        { id: 'rule-1', rule: 'density_per_section: 每节 3-5 处', confidence: 'medium', enabled: true },
        { rule: 'granularity: 短语级', confidence: 'low', enabled: false },
      ],
      exemplars: [{ span_id: 's-001', note: 'keep' }],
      reflection_notes: '# 新笔记',
    }),
  })
  const jsave = JSON.parse(save.body)
  assert(save.status === 200 && jsave.ok === true, 'POST /profile/save -> 200 ok')
  assert(jsave.applied.colors === 1 && jsave.applied.rules === 2 && jsave.applied.exemplars === 1 && jsave.applied.reflection_notes === true,
    'save applied summary covers all four editable layers')
  const gSave = await invoke(wroute.handler, { url: '/paper-hl/profile' })
  const jgSave = JSON.parse(gSave.body)
  assert(jgSave.profile.colors.red.color === '#ff0000' && jgSave.profile.colors.red.label === '红核心', 'save persisted the color edit')
  assert(jgSave.profile.rules.length === 2 && jgSave.profile.rules[0].id === 'rule-1' && jgSave.profile.rules[1].rule.indexOf('短语级') >= 0 && jgSave.profile.rules[1].enabled === false,
    'save persisted the rule edits (kept id + new rule disabled)')
  assert(jgSave.profile.exemplars.length === 1 && jgSave.profile.reflection_notes === '# 新笔记', 'save persisted exemplars + notes')
  const saveBad = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/profile/save', body: JSON.stringify({ colors: { red: { color: 'red' } } }) })
  assert(saveBad.status === 400 && /hex/.test(JSON.parse(saveBad.body).error), 'save with invalid hex -> 400')
  const saveBadJson = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/profile/save', body: 'nope' })
  assert(saveBadJson.status === 400 && /JSON/.test(JSON.parse(saveBadJson.body).error), 'save with malformed body -> 400')

  // ══════════════════ v0.4 Phase 1: GET /paper-hl/export ══════════════════
  // Fixture state: p-test spans = [s-001 accepted green, s-002 user_added
  // yellow]; profile exists (custom colors from the init/save tests above).
  const ex = await invoke(wroute.handler, { url: '/paper-hl/export?paperId=p-test&format=html' })
  const exText = Buffer.isBuffer(ex.body) ? ex.body.toString('utf8') : ex.body
  assert(ex.status === 200 && ex.headers['Content-Type'] === 'text/html; charset=utf-8', 'export html -> 200 + text/html Content-Type')
  assert(exText.startsWith('<!DOCTYPE html>') && marks(exText) === 2, 'export html: self-contained document with 2 marks (accepted + user_added)')
  assert(ex.headers['Content-Disposition'] === undefined, 'export html: no attachment header by default')

  const exDl = await invoke(wroute.handler, { url: '/paper-hl/export?paperId=p-test&format=html&download=1' })
  assert(exDl.status === 200 && /attachment/.test(exDl.headers['Content-Disposition']) && /p-test\.html/.test(exDl.headers['Content-Disposition']),
    'export html download=1 -> Content-Disposition attachment with filename')

  const exMd = await invoke(wroute.handler, { url: '/paper-hl/export?paperId=p-test&format=md' })
  const exMdText = Buffer.isBuffer(exMd.body) ? exMd.body.toString('utf8') : exMd.body
  assert(exMd.status === 200 && exMd.headers['Content-Type'] === 'text/markdown; charset=utf-8', 'export md -> 200 + text/markdown Content-Type')
  assert(exMdText.startsWith('# Title') && marks(exMdText) === 2, 'export md: H1 title + 2 marks')

  // include_pending: add a proposed span, assert default excludes / flag includes it
  const exDoc = await readHighlights(fx.root, fx.paperId)
  exDoc.spans.push({ id: 's-003', anchor: 'a-0001-03-01', char_start: 0, char_end: 3, color: 'purple', rationale: 'pending', status: 'proposed', decisions: [] })
  await writeHighlights(fx.root, fx.paperId, exDoc)
  const exPendOff = await invoke(wroute.handler, { url: '/paper-hl/export?paperId=p-test&format=html' })
  const exPendOffText = Buffer.isBuffer(exPendOff.body) ? exPendOff.body.toString('utf8') : exPendOff.body
  assert(marks(exPendOffText) === 2, 'export default: proposed span excluded')
  const exPendOn = await invoke(wroute.handler, { url: '/paper-hl/export?paperId=p-test&format=html&include_pending=1' })
  const exPendOnText = Buffer.isBuffer(exPendOn.body) ? exPendOn.body.toString('utf8') : exPendOn.body
  assert(marks(exPendOnText) === 3, 'export include_pending=1: proposed span included')

  // export negatives (same contract as /write)
  const exNoPaper = await invoke(wroute.handler, { url: '/paper-hl/export?format=html' })
  assert(exNoPaper.status === 400 && /missing paperId/.test(JSON.parse(exNoPaper.body).error), 'export missing paperId -> 400')
  const exBadFmt = await invoke(wroute.handler, { url: '/paper-hl/export?paperId=p-test&format=pdf' })
  assert(exBadFmt.status === 400 && /unsupported export format/.test(JSON.parse(exBadFmt.body).error), 'export unknown format -> 400')
  const exUnknown = await invoke(wroute.handler, { url: '/paper-hl/export?paperId=ghost&format=html' })
  assert(exUnknown.status === 404 && /unknown paperId/.test(JSON.parse(exUnknown.body).error), 'export unknown paperId -> 404')

  // ══════════════════ v0.5: POST /paper-hl/format (一键格式化) ══════════════════
  // One-click factory reset: confirm-guarded destructive route. Fixture state
  // at this point: p-test spans = [s-001 accepted green, s-002 user_added
  // yellow, s-003 proposed purple] (3), plan.sections = s2 + s3 (2 reviewed),
  // reflections.json confirmed, profile = 2 rules + 1 exemplar (from the
  // save/apply tests above). No export/ dir or paper-reflection.md in this
  // fixture (export tests use the inline route, not file writes).
  const fmtGet = await invoke(wroute.handler, { url: '/paper-hl/format' })
  assert(fmtGet.status === 404, 'format GET -> 404 (POST-only destructive route)')
  const fmtNoConfirm = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/format', body: JSON.stringify({ scope: 'all' }) })
  assert(fmtNoConfirm.status === 400 && /confirm: true/.test(JSON.parse(fmtNoConfirm.body).error), 'format without confirm -> 400')
  const fmtBadScope = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/format', body: JSON.stringify({ confirm: true, scope: 'nuke' }) })
  assert(fmtBadScope.status === 400 && /unsupported scope/.test(JSON.parse(fmtBadScope.body).error), 'format unknown scope -> 400')
  const fmtBadJson = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/format', body: 'nope' })
  assert(fmtBadJson.status === 400 && /JSON/.test(JSON.parse(fmtBadJson.body).error), 'format malformed body -> 400')

  const fmt = await invoke(wroute.handler, { method: 'POST', url: '/paper-hl/format', body: JSON.stringify({ confirm: true, scope: 'all' }) })
  const jfmt = JSON.parse(fmt.body)
  assert(fmt.status === 200 && jfmt.ok === true && jfmt.scope === 'all' && typeof jfmt.at === 'string', 'format confirm:true -> 200 ok with timestamp')
  assert(jfmt.papers_processed === 1 && jfmt.spans_cleared === 3 && jfmt.plans_cleared === 2 && jfmt.duplicates_cleared === 0,
    'format cleared the fixture spans (3) + plan entries (2)')
  assert(jfmt.reflections_removed === 1 && jfmt.exports_removed === 0 && jfmt.paper_reflections_removed === 0,
    'format removed the confirmed reflections.json (no export/ or paper-reflection in this fixture)')
  assert(jfmt.profile_removed === true && jfmt.rules_cleared === 2 && jfmt.exemplars_cleared === 1,
    'format removed the profile (2 rules + 1 exemplar counted)')
  const fmtDisk = await readHighlights(fx.root, fx.paperId)
  assert(fmtDisk.spans.length === 0 && fmtDisk.duplicates.length === 0 && fmtDisk.plan.sections.length === 0,
    'format reset the on-disk highlights (paper + anchors kept)')
  assert(fmtDisk.paper.id === 'p-test' && fmtDisk.anchors['a-0001-03-01'] !== undefined, 'format kept paper meta + anchors')
  assert(await readReflections(fx.root, fx.paperId) === null, 'format deleted reflections.json')
  assert((await profileExists(fx.root)) === false, 'format removed the profile (cold start returns)')

  // cleanup fixture (profile + paper)
  await fsp.rm(profileDir(fx.root), { recursive: true, force: true })
  await fsp.rm(fx.root, { recursive: true, force: true })

  console.log(JSON.stringify({
    step: 'plugin-route',
    result: 'PASS',
    config_root: 'cwd-independent data root (Step 4 restart regression guarded)',
    read: '/paper-hl/read -> 200, 80 anchors, spans array (shape-only: post-format empty or user-walkthrough additions both OK), 22 sections (References empty)',
    write: 'POST /paper-hl/write: accept/recolor/add/review_section applied + persisted; review status merged into read',
    write_negative: 'unknown span/action/paperId, bad range, malformed body, missing paperId -> 4xx',
    profile: 'GET /paper-hl/profile (has_profile/summary/pending_proposals) + POST /init (defaults + onboarding colors/rules merge) + POST /apply?paperId (proposal confirmation, append-only) + POST /save (edit-panel partial update: colors/rules/exemplars/notes, stats read-only) + negatives',
    export: 'GET /paper-hl/export (html|md, self-contained, Content-Type + download attachment header, include_pending effect, negatives 400/404) (v0.4 Phase 1)',
    format: 'POST /paper-hl/format — confirm-guarded factory reset: GET 404 / missing-confirm 400 / unknown-scope 400 / malformed 400; confirm:true clears spans+plan, deletes reflections, removes profile (2 rules + 1 exemplar); paper + anchors kept (v0.5)',
    fallback: 'unknown paperId -> first paper; missing root -> 500 JSON',
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('PLUGIN ROUTE TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
