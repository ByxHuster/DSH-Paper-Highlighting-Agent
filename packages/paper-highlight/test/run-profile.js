'use strict'

/**
 * paper-highlight · user profile layer test (v0.3 Phase 0)
 *
 * Exercises host/profile.js (design §4.3) + the read_profile / confirm_proposal
 * tools + schema.validateReflections:
 *
 *   - colors.yml minimal-YAML parser/serializer round trip + rejection
 *   - ensureProfile: default four-layer creation, idempotent (no overwrite)
 *   - readProfile / writeProfile round trip; validateProfile rejection matrix
 *   - buildProfileSummary: pre-onboarding defaults vs populated profile
 *     (L2 top-k enabled rules, L3 top-k exemplars, one-line L4 stats)
 *   - applyProposal: full accept / partial accept / full reject, immutability,
 *     low-confidence rules land disabled (candidates, D7), stats recompute (D4)
 *   - confirm_proposal tool: one-shot confirmation (reflections.confirmation
 *     append-only; second confirm rejected), profile persisted, lossless JSON
 *
 * Run:  node test/run-profile.js
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const {
  parseColorsYaml,
  stringifyColorsYaml,
  defaultProfile,
  validateProfile,
  ensureProfile,
  readProfile,
  writeProfile,
  buildProfileSummary,
  applyProposal,
  derivePaperMetrics,
  recomputeOverall,
  readReflections,
  writeReflections,
  listPendingProposals,
} = require('../host/profile')
const { validateReflections } = require('../host/schema')
const { writePaper } = require('../host/store')
const { readProfileTool, confirmProposalTool } = require('../host/tools')
const { assert } = require('./verify')

const ROOT = path.join(__dirname, '.tmp', 'profile-root')

/** A proposal in the exact shape the reflect skill writes (reflections.json). */
function makeProposal(paperId) {
  return {
    paper_id: paperId,
    updated_at: '2026-08-27T00:00:00.000Z',
    sections: [
      { section_id: 's3', title: '1 Introduction', status: 'reviewed', counts: { proposed: 3, accepted: 0, rejected: 1, recolored: 1, rescoped: 1, noted: 0, user_added: 1, pending: 1 } },
    ],
    inferred: [],
    profile_proposal: {
      rules: [
        { rule: 'color_semantics: 引言问题/动机类内容归 red（核心洞见）', confidence: 'low', from: 's3 节 s-009 被 blue→red 改色' },
        { rule: 'granularity: 高亮默认取短语级短片段，避免整句刷色', confidence: 'medium', from: 's-003 与 s-006 两次 rescope 缩小范围' },
        { rule: 'value/density: 背景铺垫/通用经验法则类句子不提出高亮', confidence: 'high', from: 's3 节 s-010 被删除' },
      ],
      exemplars: [
        { span_id: 's-009', suggested: { color: 'blue' }, user_decision: { color: 'red' }, section: 's3', note: '问题/动机类内容用户归 red' },
        { span_id: 's-012', suggested: null, user_decision: { action: 'added', color: 'purple' }, section: 's3', note: '用户节标题 purple 标记' },
      ],
      stats: { sections_reviewed: 1, overall_accept_rate: 0, recolor_events: 1, reject_events: 1, user_added: 1, pending: 1 },
    },
  }
}

async function seedPaper(root, paperId) {
  const md = ['# Title', '', '## Abstract', '', 'Abstract body text.', ''].join('\n')
  const find = (s) => md.indexOf(s)
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: find('Title') },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'title', text: 'Abstract', md_offset: find('Abstract') },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'Abstract body text.', md_offset: find('Abstract body text.') },
  }
  await writePaper(root, paperId, {
    paperMd: md,
    anchors,
    meta: { id: paperId, title: 'Title', source_pdf: 's.pdf', mineru_task: 'm', stats: { kept_blocks: 3 } },
  })
}

function lossless(value, label) {
  const seen = new Set()
  function check(node, p) {
    if (node === null) return
    const t = typeof node
    if (t === 'undefined') throw new Error(`${label}: undefined at ${p}`)
    if (t === 'number' && !Number.isFinite(node)) throw new Error(`${label}: non-finite at ${p}`)
    if (t === 'bigint') throw new Error(`${label}: bigint at ${p}`)
    if (t !== 'object') return
    if (seen.has(node)) throw new Error(`${label}: circular at ${p}`)
    seen.add(node)
    if (Array.isArray(node)) node.forEach((v, i) => check(v, `${p}[${i}]`))
    else for (const k of Object.keys(node)) check(node[k], `${p}.${k}`)
    seen.delete(node)
  }
  check(value, '$')
  assert(JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value), `${label}: JSON round-trip stable`)
}

async function main() {
  await fsp.rm(ROOT, { recursive: true, force: true })

  // ── 1) colors.yml minimal-YAML round trip ──────────────────────────────────
  const colors = { red: { color: '#ff9c94', label: '核心洞见/贡献' }, blue: { color: '#8fd0f7', label: '局限/风险' } }
  const yaml = stringifyColorsYaml(colors)
  assert(yaml.indexOf('colors:') === 0 || yaml.indexOf('\ncolors:') >= 0, 'yaml starts with the colors: root key')
  const parsed = parseColorsYaml(yaml)
  assert(parsed.red.color === '#ff9c94' && parsed.red.label === '核心洞见/贡献', 'yaml round trip: red entry')
  assert(parsed.blue.color === '#8fd0f7', 'yaml round trip: blue entry')
  assert(parseColorsYaml('# comment\n\ncolors:\n  green:\n    color: #b0e3a8\n    label: 可借鉴/启发\n').green.color === '#b0e3a8', 'yaml: comments + blank lines skipped')
  let yamlThrew = false
  try {
    parseColorsYaml('colors:\n  red:\n    color: #ff9c94\nunparsable line here')
  } catch (err) {
    yamlThrew = true
    assert(/unparsable line/.test(err.message), `yaml rejection message: ${err.message}`)
  }
  assert(yamlThrew, 'yaml: unparsable line rejected')

  // ── 2) ensureProfile: create defaults, idempotent ─────────────────────────
  const r1 = await ensureProfile(ROOT)
  assert(r1.created === true && r1.dir === path.join(ROOT, 'highlight-profile'), 'ensureProfile creates the profile dir')
  const r2 = await ensureProfile(ROOT)
  assert(r2.created === false, 'ensureProfile is idempotent (second call creates nothing)')
  const files = await fsp.readdir(r1.dir)
  for (const name of ['colors.yml', 'rules.json', 'exemplars.json', 'stats.json', 'reflection-notes.md']) {
    assert(files.includes(name), `profile file exists: ${name}`)
  }
  const profile0 = await readProfile(ROOT)
  assert(Object.keys(profile0.colors).length === 5, 'default profile has the 5 colors')
  assert(profile0.colors.red.color === '#ff9c94' && profile0.colors.red.label === '核心洞见/贡献', 'default colors match the client COLOR_MAP/LABELS')
  assert(Array.isArray(profile0.rules) && profile0.rules.length === 0, 'default rules empty (cold-start baseline fills later)')
  assert(Array.isArray(profile0.exemplars) && Array.isArray(profile0.stats.papers), 'default exemplars array + stats.papers array')

  // ── 3) validateProfile rejection matrix ────────────────────────────────────
  const bad1 = defaultProfile()
  bad1.colors.red.color = 'red' // not a hex
  let vThrew = false
  try { validateProfile(bad1) } catch (err) { vThrew = true; assert(/hex/.test(err.message), `colors hex validation: ${err.message}`) }
  assert(vThrew, 'validateProfile rejects a non-hex color')
  const bad2 = defaultProfile()
  bad2.rules = [{ rule: '' }]
  vThrew = false
  try { validateProfile(bad2) } catch (err) { vThrew = true; assert(/non-empty string/.test(err.message), `rules validation: ${err.message}`) }
  assert(vThrew, 'validateProfile rejects an empty rule')
  const bad3 = defaultProfile()
  bad3.exemplars = ['not-an-object']
  vThrew = false
  try { validateProfile(bad3) } catch (err) { vThrew = true; assert(/must be an object/.test(err.message), `exemplars validation: ${err.message}`) }
  assert(vThrew, 'validateProfile rejects a non-object exemplar')
  const bad4 = defaultProfile()
  bad4.stats = { papers: 'nope' }
  vThrew = false
  try { validateProfile(bad4) } catch (err) { vThrew = true; assert(/papers must be an array/.test(err.message), `stats validation: ${err.message}`) }
  assert(vThrew, 'validateProfile rejects a malformed stats layer')

  // ── 4) writeProfile round trip (custom colors + rules persisted) ───────────
  const custom = await readProfile(ROOT)
  custom.colors.teal = { color: '#7fe0d0', label: '新颜色' }
  custom.rules.push({ id: 'rule-1', rule: 'granularity: 句子级', confidence: 'medium', source: 'user-cold-start', enabled: true })
  await writeProfile(ROOT, custom)
  const back = await readProfile(ROOT)
  assert(back.colors.teal.color === '#7fe0d0' && back.colors.teal.label === '新颜色', 'writeProfile round trip: custom color survives')
  assert(back.rules.length === 1 && back.rules[0].id === 'rule-1' && back.rules[0].enabled === true, 'writeProfile round trip: rule survives')

  // ── 5) buildProfileSummary ─────────────────────────────────────────────────
  const summaryNull = buildProfileSummary(null)
  assert(summaryNull.has_profile === false, 'summary(null): has_profile false (cold start)')
  assert(Object.keys(summaryNull.colors).length === 5 && summaryNull.rules.length === 0, 'summary(null): built-in color defaults, no rules')
  assert(typeof summaryNull.stats_summary === 'string' && /冷启动/.test(summaryNull.stats_summary), 'summary(null): cold-start stats one-liner')
  const summaryPop = buildProfileSummary(back)
  assert(summaryPop.has_profile === true && summaryPop.colors.teal !== undefined, 'summary(profile): carries profile colors')
  assert(summaryPop.rules.length === 1 && summaryPop.rules[0].rule.indexOf('granularity') === 0, 'summary(profile): top-k enabled rules')
  assert(summaryPop.granularity !== null && summaryPop.granularity.rule.indexOf('granularity') === 0, 'summary(profile): granularity baseline extracted')
  assert(/冷启动/.test(summaryPop.stats_summary), 'summary(profile): no stats yet → cold-start one-liner')
  const summaryTrim = buildProfileSummary({ ...back, rules: Array.from({ length: 8 }, (_, i) => ({ id: 'r' + i, rule: 'rule ' + i, enabled: true })) })
  assert(summaryTrim.rules.length === 5, 'summary: rules capped at max_rules (5)')
  lossless(summaryPop, 'buildProfileSummary output')

  // ── 6) derivePaperMetrics + recomputeOverall (D4 accounting) ───────────────
  const metrics = derivePaperMetrics(makeProposal('p-x'))
  assert(metrics.sections_reviewed === 1 && metrics.decided === 4, 'metrics: decided = accepted0+rejected1+recolored1+rescoped1+added1 = 4')
  assert(metrics.approved === 2 && Math.abs(metrics.approve_rate - 0.5) < 1e-9, 'metrics: approved = accepted+recolored+rescoped = 2 → 0.5')
  assert(Math.abs(metrics.modify_rate - 0.5) < 1e-9, 'metrics: modify_rate = 1 - approve_rate')
  const overall = recomputeOverall([{ decided: 4, approved: 2 }, { decided: 6, approved: 6 }])
  assert(overall.papers_reviewed === 2 && overall.decided === 10 && overall.approved === 8, 'overall aggregate across papers')
  assert(Math.abs(overall.approve_rate - 0.8) < 1e-9 && Math.abs(overall.modify_rate - 0.2) < 1e-9, 'overall rates')

  // ── 7) applyProposal matrix ────────────────────────────────────────────────
  const base = defaultProfile()
  const prop = makeProposal('p-apply')
  const highlights = { spans: [{ id: 's-009', color: 'red', status: 'accepted' }, { id: 's-010', color: 'green', status: 'rejected' }, { id: 's-012', color: 'purple', status: 'user_added' }] }
  const baseSnapshot = JSON.stringify(base)

  // full accept: all rules + all exemplars merged; low-confidence rule disabled
  const full = applyProposal(base, prop, { accept: 'all' }, highlights)
  assert(full.applied.rules === 3 && full.applied.exemplars === 2, 'full accept: 3 rules + 2 exemplars applied')
  assert(full.profile.rules.length === 3, 'full accept: rules merged into profile')
  const lowRule = full.profile.rules.find((r) => r.confidence === 'low')
  assert(lowRule && lowRule.enabled === false, 'D7: low-confidence rule stored disabled (candidate)')
  const medRule = full.profile.rules.find((r) => r.confidence === 'medium')
  assert(medRule && medRule.enabled === true, 'medium/high-confidence rules stored enabled')
  assert(full.profile.rules.every((r) => /^rule-\d+$/.test(r.id)), 'merged rules carry sequential ids')
  assert(full.profile.exemplars.length === 2 && full.profile.exemplars[0].from === 'p-apply', 'exemplars ingested with source paper')
  assert(full.profile.stats.papers.length === 1 && full.profile.stats.papers[0].paper_id === 'p-apply', 'stats: paper entry appended')
  assert(full.profile.stats.papers[0].color_distribution.red === 1 && full.profile.stats.papers[0].color_distribution.purple === 1, 'stats: color distribution from non-rejected spans')
  assert(full.profile.stats.overall.papers_reviewed === 1 && Math.abs(full.profile.stats.overall.approve_rate - 0.5) < 1e-9, 'stats: overall recomputed')
  assert(JSON.stringify(base) === baseSnapshot, 'applyProposal never mutates the input profile')

  // partial accept: only rule-1 + exemplar-0 by proposal-relative id
  const partial = applyProposal(defaultProfile(), prop, { accept: ['rule-1', 'exemplar-0'] })
  assert(partial.applied.rules === 1 && partial.applied.exemplars === 1, 'partial accept: rule-1 + exemplar-0 only')
  assert(partial.profile.rules[0].rule.indexOf('granularity') === 0, 'partial accept: the granularity rule (index 1)')
  assert(partial.profile.exemplars[0].span_id === 's-009', 'partial accept: exemplar index 0')

  // full reject: nothing merged (proposal still handled by the caller)
  const none = applyProposal(defaultProfile(), prop, { reject: 'all' })
  assert(none.applied.rules === 0 && none.applied.exemplars === 0, 'full reject: nothing applied')
  assert(none.profile.rules.length === 0 && none.profile.exemplars.length === 0, 'full reject: profile unchanged')

  // mixed: accept all rules, reject exemplar-1
  const mixed = applyProposal(defaultProfile(), prop, { accept: 'all', reject: ['exemplar-1'] })
  assert(mixed.applied.rules === 3 && mixed.applied.exemplars === 1, 'mixed: all rules, exemplar-1 rejected')

  // invalid proposal → throws
  let pThrew = false
  try { applyProposal(defaultProfile(), { paper_id: 'p' }, { accept: 'all' }) } catch (err) { pThrew = true; assert(/profile_proposal/.test(err.message), `invalid proposal rejection: ${err.message}`) }
  assert(pThrew, 'applyProposal rejects a proposal without profile_proposal')
  lossless(full, 'applyProposal full result')
  lossless(partial, 'applyProposal partial result')

  // ── 8) schema.validateReflections (confirmation contract) ──────────────────
  assert(validateReflections({ paper_id: 'p', profile_proposal: {}, confirmation: null }) === true, 'reflections: null confirmation valid')
  assert(validateReflections({ paper_id: 'p', confirmation: { accepted: true, at: 't', decisions: { accept: 'all' } } }) === true, 'reflections: confirmation object valid')
  let refThrew = false
  try { validateReflections({ paper_id: 'p', confirmation: { accepted: 'yes' } }) } catch (err) { refThrew = true; assert(/boolean/.test(err.message), `confirmation validation: ${err.message}`) }
  assert(refThrew, 'reflections: confirmation.accepted must be boolean')
  refThrew = false
  try { validateReflections({ paper_id: '' }) } catch (err) { refThrew = true; assert(/paper_id/.test(err.message), `paper_id validation: ${err.message}`) }
  assert(refThrew, 'reflections: paper_id required')

  // ── 9) tool-level flow: read_profile → confirm_proposal (one-shot) ─────────
  const paperId = 'p-profile'
  await seedPaper(ROOT, paperId)
  const readTool = readProfileTool()
  const before = await readTool.execute({ root: ROOT })
  assert(before.ok === true && before.has_profile === true, 'read_profile: profile exists (defaults from step 4/5)')
  assert(before.summary.has_profile === true && before.pending_proposals === 0, 'read_profile: summary + no pending proposals yet')
  lossless(before, 'read_profile output')

  await writeReflections(ROOT, paperId, makeProposal(paperId))
  const pending = await listPendingProposals(ROOT)
  assert(pending.length === 1 && pending[0].paper_id === paperId, 'listPendingProposals: one unconfirmed proposal')

  const withPending = await readTool.execute({ root: ROOT })
  assert(withPending.pending_proposals === 1, 'read_profile: pending_proposals count reflects the new proposal')

  const confirmTool = confirmProposalTool()
  const badConfirm = await confirmTool.execute({ paper_id: 'p-no-such', decisions: { accept: 'all' }, root: ROOT })
  assert(badConfirm.ok === false && /no reflections/.test(badConfirm.error), 'confirm_proposal: paper without reflections → ok:false')

  const okConfirm = await confirmTool.execute({ paper_id: paperId, decisions: { accept: 'all' }, root: ROOT })
  assert(okConfirm.ok === true && okConfirm.applied.rules === 3 && okConfirm.applied.exemplars === 2, 'confirm_proposal: full accept applied')
  assert(okConfirm.confirmation && okConfirm.confirmation.accepted === true && typeof okConfirm.confirmation.at === 'string', 'confirm_proposal: confirmation recorded')
  lossless(okConfirm, 'confirm_proposal output')

  const refAfter = await readReflections(ROOT, paperId)
  assert(refAfter.confirmation && refAfter.confirmation.accepted === true, 'reflections.json: confirmation persisted (append-only)')

  const doubleConfirm = await confirmTool.execute({ paper_id: paperId, decisions: { accept: 'all' }, root: ROOT })
  assert(doubleConfirm.ok === false && /already confirmed/.test(doubleConfirm.error), 'confirm_proposal: second confirm rejected (one-shot)')

  const afterProfile = await readProfile(ROOT)
  assert(afterProfile.rules.length === 4, 'profile rules: 1 cold-start rule (step 4) + 3 from the proposal')
  assert(afterProfile.exemplars.length === 2, 'profile exemplars: 2 from the proposal')
  assert(afterProfile.stats.papers.length === 1 && afterProfile.stats.papers[0].paper_id === paperId, 'profile stats: proposal paper recorded')
  const pending2 = await listPendingProposals(ROOT)
  assert(pending2.length === 0, 'listPendingProposals: confirmed proposal no longer pending')

  // reject-all path: a second paper proposal fully rejected → confirmation accepted:false
  const paperId2 = 'p-reject'
  await seedPaper(ROOT, paperId2)
  await writeReflections(ROOT, paperId2, makeProposal(paperId2))
  const rejectConfirm = await confirmTool.execute({ paper_id: paperId2, decisions: { reject: 'all' }, root: ROOT })
  assert(rejectConfirm.ok === true && rejectConfirm.applied.rules === 0 && rejectConfirm.applied.exemplars === 0, 'confirm_proposal: reject-all applies nothing')
  assert(rejectConfirm.confirmation.accepted === false, 'confirm_proposal: reject-all records accepted:false')
  const afterReject = await readProfile(ROOT)
  assert(afterReject.rules.length === 4 && afterReject.exemplars.length === 2, 'reject-all: profile unchanged by the rejected proposal')
  assert(afterReject.stats.papers.length === 2, 'reject-all: stats still records the reviewed paper (paper_id p-reject)')

  // cleanup
  await fsp.rm(ROOT, { recursive: true, force: true })

  console.log(JSON.stringify({
    step: 'profile',
    result: 'PASS',
    colors_yaml: 'minimal YAML subset round trip + rejection (colors.yml L1)',
    ensure: 'default four-layer creation, idempotent',
    validate: 'colors hex / rules / exemplars / stats rejection matrix',
    summary: 'buildProfileSummary — cold-start defaults vs populated profile (L2 top-k + L3 top-k + L4 one-liner + density/granularity extraction)',
    metrics: 'derivePaperMetrics (D4: approved = accepted+recolored+rescoped) + recomputeOverall',
    apply_proposal: 'full accept / partial / full reject / mixed; low-confidence rules stored disabled (D7); stats + color distribution; immutability',
    confirm_tool: 'read_profile (has_profile/summary/pending) + confirm_proposal one-shot (confirmation append-only, double-confirm rejected, reject-all accepted:false)',
    reflections_schema: 'validateReflections — confirmation null|{accepted,at,decisions}',
    lossless: 'all tool/profile outputs lossless JSON',
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('PROFILE TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
