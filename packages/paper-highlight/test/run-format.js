'use strict'

/**
 * paper-highlight · one-click format (v0.5) unit test
 *
 * Covers host/format.js (pure) + the POST /paper-hl/format route:
 *   - normalizeScope: default 'all', explicit values, unknown -> throw
 *   - formatHighlights: PURE reset — paper meta + anchors kept, plan / spans /
 *     duplicates cleared, output passes validateHighlights
 *   - formatAll confirm guard: throws without confirm:true
 *   - formatAll scope='highlights': clears spans/plan/duplicates + deletes
 *     reflections.json / export/ / paper-reflection.md for every paper; keeps
 *     the parsed paper files (paper.md / anchors.json / meta.json); profile
 *     untouched
 *   - formatAll scope='profile': deletes highlight-profile/ (rules/exemplars
 *     counted) ; highlights untouched
 *   - formatAll scope='all': both cleared
 *   - route matrix: GET -> 404, POST without confirm -> 400, malformed JSON ->
 *     400, unknown scope -> 400, confirm:true -> 200 + audit stats, on-disk
 *     state verified
 *
 * The fixture runs under test/.tmp (gitignored) so real data is never touched.
 *
 * Run:  node test/run-format.js
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const plugin = require('../host/plugin')
const { writePaper, writeHighlights, readHighlights, paperDir } = require('../host/store')
const { newHighlightsSkeleton } = require('../host/schema')
const { writeReflections, ensureProfile, writeProfile } = require('../host/profile')
const { normalizeScope, formatHighlights, formatAll } = require('../host/format')
const { assert } = require('./verify')

function fakeCtx() {
  const captured = []
  return {
    effect: (fn) => fn(),
    webServer: { register: (route) => captured.push(route) },
    captured,
  }
}

function invoke(handler, req) {
  return new Promise((resolve) => {
    const res = { status: 0, body: '', headers: {} }
    res.writeHead = (s, h) => { res.status = s; res.headers = h || {} }
    res.end = (b) => { res.body = b; resolve(res) }
    handler(req, res)
  })
}

/** One paper fixture: highlights with 2 spans + plan + duplicates + a
 *  reflections.json + an export/ dir + paper-reflection.md. Returns { root, paperId }. */
async function seedPaper(root, paperId, title) {
  const md = ['# Title', '', '## Abstract', '', 'Abstract body text.', '', '## References', ''].join('\n')
  const find = (s) => md.indexOf(s)
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: find('Title') },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'title', text: 'Abstract', md_offset: find('Abstract') },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'Abstract body text.', md_offset: find('Abstract body text.') },
    'a-0001-04-01': { page: 1, block: 4, par: 1, type: 'title', text: 'References', md_offset: find('References') },
  }
  await writePaper(root, paperId, {
    paperMd: md,
    anchors,
    meta: { id: paperId, title, source_pdf: 's.pdf', mineru_task: 'm', stats: { kept_blocks: 4 } },
  })
  const doc = newHighlightsSkeleton({ id: paperId, title, sourcePdf: 's.pdf', mineruTask: 'm' })
  doc.anchors = anchors
  doc.plan.sections = [{ id: 's2', section: 'Abstract', status: 'reviewed' }]
  doc.spans = [
    { id: 's-001', anchor: 'a-0001-03-01', char_start: 0, char_end: 7, color: 'red', rationale: 'core', status: 'accepted', decisions: [{ action: 'accepted', by: 'user', at: 't0' }] },
    { id: 's-002', anchor: 'a-0001-03-01', char_start: 8, char_end: 14, color: 'blue', rationale: 'risk', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
  ]
  doc.duplicates = [{ claim: 'repeated claim', highlighted_at: 's-001', repeats_at: ['a-0001-02-01'] }]
  await writeHighlights(root, paperId, doc)
  // reflections.json (pending proposal)
  await writeReflections(root, paperId, {
    paper_id: paperId,
    updated_at: '2026-08-27T00:00:00.000Z',
    profile_proposal: { rules: [{ rule: 'x' }], exemplars: [], stats: {} },
  })
  // export/ + paper-reflection.md
  const dir = paperDir(root, paperId)
  await fsp.mkdir(path.join(dir, 'export'), { recursive: true })
  await fsp.writeFile(path.join(dir, 'export', paperId + '.html'), '<!DOCTYPE html>', 'utf8')
  await fsp.writeFile(path.join(dir, 'export', paperId + '.md'), '# x', 'utf8')
  await fsp.writeFile(path.join(dir, 'paper-reflection.md'), '# 论文级反思 — ' + title, 'utf8')
  return { root, paperId }
}

async function seedProfile(root) {
  await ensureProfile(root)
  const profile = {
    colors: { red: { color: '#ff9c94', label: '核心洞见/贡献' }, yellow: { color: '#fff3a0', label: '关键定义/方法' }, blue: { color: '#8fd0f7', label: '局限/风险' }, green: { color: '#b0e3a8', label: '可借鉴/启发' }, purple: { color: '#d9b8f2', label: '待深挖/存疑' } },
    rules: [
      { id: 'rule-1', rule: 'density_per_section: 每节 3-5 处', confidence: 'medium', enabled: true },
      { id: 'rule-2', rule: 'granularity: 句子级', confidence: 'low', enabled: false },
    ],
    exemplars: [{ span_id: 's-001', suggested: { color: 'red' }, user_decision: { action: 'accepted' }, section: 's2', note: 'x', from: 'p-a' }],
    stats: { papers: [{ paper_id: 'p-a', decided: 1, approved: 1, approve_rate: 1, modify_rate: 0, change_kinds: { accepted: 1, rejected: 0, recolored: 0, rescoped: 0, user_added: 0, pending: 0 } }], overall: { papers_reviewed: 1, decided: 1, approved: 1, approve_rate: 1, modify_rate: 0 } },
    reflection_notes: '# 笔记',
  }
  await writeProfile(root, profile)
  return profile
}

async function main() {
  // ── 1) normalizeScope ──────────────────────────────────────────────────────
  assert(normalizeScope(undefined) === 'all' && normalizeScope(null) === 'all' && normalizeScope('') === 'all', 'normalizeScope: missing -> all')
  assert(normalizeScope('ALL') === 'all' && normalizeScope('highlights') === 'highlights' && normalizeScope('profile') === 'profile', 'normalizeScope: explicit values normalized')
  let scopeThrew = false
  try { normalizeScope('nuke') } catch (err) { scopeThrew = /unsupported scope/.test(err.message) }
  assert(scopeThrew, 'normalizeScope: unknown scope throws')

  // ── 2) formatHighlights (pure) ─────────────────────────────────────────────
  const doc = newHighlightsSkeleton({ id: 'p-x', title: 'T', sourcePdf: 's.pdf', mineruTask: 'm' })
  doc.anchors = { 'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: 2 } }
  doc.plan.sections = [{ id: 's1', section: 'T', status: 'reviewed' }]
  doc.spans = [{ id: 's-001', anchor: 'a-0001-01-01', char_start: 0, char_end: 5, color: 'red', rationale: 'r', status: 'accepted', decisions: [] }]
  doc.duplicates = [{ claim: 'c' }]
  const fresh = formatHighlights(doc)
  assert(fresh.paper.id === 'p-x' && fresh.paper.title === 'T', 'formatHighlights: paper meta kept')
  assert(fresh.anchors['a-0001-01-01'] !== undefined, 'formatHighlights: anchors kept')
  assert(fresh.plan.summary === '' && fresh.plan.sections.length === 0, 'formatHighlights: plan reset')
  assert(fresh.spans.length === 0 && fresh.duplicates.length === 0, 'formatHighlights: spans + duplicates cleared')
  const { validateHighlights } = require('../host/schema')
  assert(validateHighlights(fresh) === true, 'formatHighlights: output passes validateHighlights')
  const freshEmpty = formatHighlights(null)
  assert(Array.isArray(freshEmpty.spans) && freshEmpty.plan.sections.length === 0, 'formatHighlights: null input yields a fresh skeleton')

  // ── 3) formatAll confirm guard ─────────────────────────────────────────────
  const guardRoot = path.join(__dirname, '.tmp', 'format-guard')
  await fsp.rm(guardRoot, { recursive: true, force: true })
  await fsp.mkdir(guardRoot, { recursive: true })
  let guardThrew = false
  try { await formatAll(guardRoot, { scope: 'all' }) } catch (err) { guardThrew = /confirm: true/.test(err.message) }
  assert(guardThrew, 'formatAll: throws without confirm:true')
  let guardFalse = false
  try { await formatAll(guardRoot, { confirm: false }) } catch (err) { guardFalse = /confirm: true/.test(err.message) }
  assert(guardFalse, 'formatAll: confirm:false throws')
  await fsp.rm(guardRoot, { recursive: true, force: true })

  // ── 4) formatAll scope='highlights' ────────────────────────────────────────
  const hlRoot = path.join(__dirname, '.tmp', 'format-hl')
  await fsp.rm(hlRoot, { recursive: true, force: true })
  await seedPaper(hlRoot, 'p-a', 'Paper A')
  await seedPaper(hlRoot, 'p-b', 'Paper B')
  await seedProfile(hlRoot)
  const hlRes = await formatAll(hlRoot, { confirm: true, scope: 'highlights' })
  assert(hlRes.ok === true && hlRes.scope === 'highlights', 'formatAll highlights: ok + scope')
  assert(hlRes.papers_processed === 2, 'formatAll highlights: 2 papers processed')
  assert(hlRes.spans_cleared === 4 && hlRes.plans_cleared === 2 && hlRes.duplicates_cleared === 2,
    'formatAll highlights: cleared 4 spans / 2 plans / 2 duplicates across 2 papers')
  assert(hlRes.reflections_removed === 2, 'formatAll highlights: 2 reflections.json removed')
  assert(hlRes.exports_removed === 4, 'formatAll highlights: 4 export files removed (2 per paper)')
  assert(hlRes.paper_reflections_removed === 2, 'formatAll highlights: 2 paper-reflection.md removed')
  assert(hlRes.profile_removed === false, 'formatAll highlights: profile NOT touched')
  // on-disk verification
  for (const pid of ['p-a', 'p-b']) {
    const after = await readHighlights(hlRoot, pid)
    assert(after.spans.length === 0 && after.duplicates.length === 0 && after.plan.sections.length === 0,
      'formatAll highlights: ' + pid + ' highlights reset on disk')
    assert(after.paper.id === pid && after.anchors['a-0001-03-01'] !== undefined, 'formatAll highlights: ' + pid + ' paper + anchors kept')
    for (const name of ['reflections.json', 'paper-reflection.md']) {
      let exists = true
      try { await fsp.access(path.join(paperDir(hlRoot, pid), name)) } catch { exists = false }
      assert(!exists, 'formatAll highlights: ' + pid + ' ' + name + ' deleted')
    }
    let exportDir = true
    try { await fsp.access(path.join(paperDir(hlRoot, pid), 'export')) } catch { exportDir = false }
    assert(!exportDir, 'formatAll highlights: ' + pid + ' export/ deleted')
    // parsed paper files survive → re-proposing can resume
    for (const name of ['paper.md', 'anchors.json', 'meta.json']) {
      let exists = false
      try { await fsp.access(path.join(paperDir(hlRoot, pid), name)); exists = true } catch {}
      assert(exists, 'formatAll highlights: ' + pid + ' ' + name + ' KEPT')
    }
  }
  // profile still present (scoped out)
  let profileDirStill = true
  try { await fsp.access(path.join(hlRoot, 'highlight-profile', 'colors.yml')) } catch { profileDirStill = false }
  assert(profileDirStill, 'formatAll highlights: highlight-profile/ untouched')
  await fsp.rm(hlRoot, { recursive: true, force: true })

  // ── 5) formatAll scope='profile' ───────────────────────────────────────────
  const pfRoot = path.join(__dirname, '.tmp', 'format-profile')
  await fsp.rm(pfRoot, { recursive: true, force: true })
  await seedPaper(pfRoot, 'p-a', 'Paper A')
  await seedProfile(pfRoot)
  const pfRes = await formatAll(pfRoot, { confirm: true, scope: 'profile' })
  assert(pfRes.ok === true && pfRes.profile_removed === true, 'formatAll profile: profile removed')
  assert(pfRes.rules_cleared === 2 && pfRes.exemplars_cleared === 1, 'formatAll profile: counted 2 rules + 1 exemplar before removal')
  assert(pfRes.papers_processed === 0 && pfRes.spans_cleared === 0, 'formatAll profile: highlights untouched')
  let profileGone = false
  try { await fsp.access(path.join(pfRoot, 'highlight-profile')) } catch { profileGone = true }
  assert(profileGone, 'formatAll profile: highlight-profile/ directory deleted')
  const pfHighlights = await readHighlights(pfRoot, 'p-a')
  assert(pfHighlights.spans.length === 2, 'formatAll profile: paper highlights preserved')
  await fsp.rm(pfRoot, { recursive: true, force: true })

  // ── 6) formatAll scope='all' (route-driven below asserts the same path) ────
  const allRoot = path.join(__dirname, '.tmp', 'format-all')
  await fsp.rm(allRoot, { recursive: true, force: true })
  await seedPaper(allRoot, 'p-a', 'Paper A')
  await seedProfile(allRoot)
  const allRes = await formatAll(allRoot, { confirm: true, scope: 'all' })
  assert(allRes.spans_cleared === 2 && allRes.reflections_removed === 1 && allRes.exports_removed === 2
    && allRes.paper_reflections_removed === 1 && allRes.profile_removed === true
    && allRes.rules_cleared === 2 && allRes.exemplars_cleared === 1, 'formatAll all: combined clears')
  await fsp.rm(allRoot, { recursive: true, force: true })

  // ══════════════════ POST /paper-hl/format route ══════════════════
  const rtRoot = path.join(__dirname, '.tmp', 'format-route')
  await fsp.rm(rtRoot, { recursive: true, force: true })
  await seedPaper(rtRoot, 'p-a', 'Paper A')
  await seedProfile(rtRoot)
  const ctx = fakeCtx()
  plugin.apply(ctx, { root: rtRoot })
  const route = ctx.captured[0]

  // GET → 404 (POST-only destructive route)
  const getFmt = await invoke(route.handler, { url: '/paper-hl/format' })
  assert(getFmt.status === 404 && JSON.parse(getFmt.body).ok === false, 'format route: GET -> 404 (POST only)')

  // POST without confirm → 400
  const noConfirm = await invoke(route.handler, { method: 'POST', url: '/paper-hl/format', body: JSON.stringify({ scope: 'all' }) })
  assert(noConfirm.status === 400 && /confirm: true/.test(JSON.parse(noConfirm.body).error), 'format route: missing confirm -> 400')

  // POST malformed JSON → 400
  const badJson = await invoke(route.handler, { method: 'POST', url: '/paper-hl/format', body: 'not-json' })
  assert(badJson.status === 400 && /JSON/.test(JSON.parse(badJson.body).error), 'format route: malformed body -> 400')

  // POST unknown scope → 400
  const badScope = await invoke(route.handler, { method: 'POST', url: '/paper-hl/format', body: JSON.stringify({ confirm: true, scope: 'nuke' }) })
  assert(badScope.status === 400 && /unsupported scope/.test(JSON.parse(badScope.body).error), 'format route: unknown scope -> 400')

  // confirm:true but profile is intact at this point (the negatives above must
  // have NO side effects)
  let profileBefore = true
  try { await fsp.access(path.join(rtRoot, 'highlight-profile', 'colors.yml')) } catch { profileBefore = false }
  assert(profileBefore, 'format route: negative requests did not wipe the profile')

  // POST confirm:true scope=highlights → 200 + audit stats + on-disk reset
  const fmt = await invoke(route.handler, { method: 'POST', url: '/paper-hl/format', body: JSON.stringify({ confirm: true, scope: 'highlights' }) })
  const jfmt = JSON.parse(fmt.body)
  assert(fmt.status === 200 && jfmt.ok === true && jfmt.scope === 'highlights', 'format route: confirm:true -> 200 ok')
  assert(jfmt.spans_cleared === 2 && jfmt.reflections_removed === 1 && jfmt.exports_removed === 2
    && jfmt.paper_reflections_removed === 1 && jfmt.profile_removed === false, 'format route: audit stats (highlights scope)')
  assert(typeof jfmt.at === 'string' && jfmt.at.length > 0, 'format route: timestamp present')
  const afterRoute = await readHighlights(rtRoot, 'p-a')
  assert(afterRoute.spans.length === 0 && afterRoute.plan.sections.length === 0, 'format route: on-disk highlights reset')
  let profileAfterScope = true
  try { await fsp.access(path.join(rtRoot, 'highlight-profile', 'colors.yml')) } catch { profileAfterScope = false }
  assert(profileAfterScope, 'format route: highlights scope keeps the profile')

  // POST confirm:true scope=profile → profile removed
  const fmt2 = await invoke(route.handler, { method: 'POST', url: '/paper-hl/format', body: JSON.stringify({ confirm: true, scope: 'profile' }) })
  const jfmt2 = JSON.parse(fmt2.body)
  assert(fmt2.status === 200 && jfmt2.profile_removed === true && jfmt2.rules_cleared === 2 && jfmt2.exemplars_cleared === 1,
    'format route: profile scope removes the profile (2 rules + 1 exemplar)')
  let profileGoneRoute = false
  try { await fsp.access(path.join(rtRoot, 'highlight-profile')) } catch { profileGoneRoute = true }
  assert(profileGoneRoute, 'format route: highlight-profile/ deleted on disk')

  // cleanup
  await fsp.rm(rtRoot, { recursive: true, force: true })

  console.log(JSON.stringify({
    step: 'format',
    result: 'PASS',
    pure: 'normalizeScope (default/unknown throw) + formatHighlights (paper+anchors kept, plan/spans/duplicates reset, schema-valid)',
    guard: 'formatAll requires confirm:true (throws otherwise)',
    highlights_scope: '2 papers: 4 spans / 2 plans / 2 duplicates cleared + 2 reflections + 4 export files + 2 paper-reflections removed; paper.md/anchors.json/meta.json KEPT; profile untouched',
    profile_scope: 'highlight-profile/ removed (2 rules + 1 exemplar counted); highlights preserved',
    all_scope: 'combined clears',
    route: 'POST /paper-hl/format — GET 404 / missing-confirm 400 / malformed 400 / unknown-scope 400 (no side effects) / confirm:true -> 200 + audit stats + on-disk reset',
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FORMAT TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
