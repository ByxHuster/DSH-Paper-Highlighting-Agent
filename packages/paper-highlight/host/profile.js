'use strict'

/**
 * paper-highlight · user profile store (design doc §4.3, v0.3 Phase 0)
 *
 * Four-layer personalization profile under <root>/highlight-profile/ (design §9):
 *
 *   colors.yml           L1 color semantics (user-fixed). Minimal YAML subset:
 *                          colors:
 *                            red:
 *                              color: '#ff9c94'
 *                              label: 核心洞见/贡献
 *   rules.json           L2 rules (density / granularity / dedup /
 *                          color-semantics overrides). ONLY user-confirmed
 *                          rules land here (v0.2 reflect proposals → v0.3
 *                          confirm flow, design §6 防污染). Low-confidence
 *                          rules are stored disabled as candidates (D7).
 *   exemplars.json       L3 example library (reference-only, auto-ingested on
 *                          confirmation; never rewrites rules directly).
 *   stats.json           L4a stats: per-paper + overall approval/modify rates
 *                          and change-kind distribution (D4 accounting).
 *   reflection-notes.md  L4b natural-language notes (agent-maintained, user
 *                          editable).
 *
 * Contract mirrors host/store.js: atomic writes (temp + rename), validation
 * before write, lossless JSON. The profile root follows the same resolution
 * as the data root (config root / PAPER_HL_ROOT / cwd) with the profile
 * directory at <root>/highlight-profile/.
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const { atomicWriteJson, atomicWriteText } = require('./store')
const { validateReflections } = require('./schema')

const PROFILE_DIR_NAME = 'highlight-profile'
const JSON_LAYERS = ['rules', 'exemplars', 'stats']

/** Default L1 color semantics — must match client/render-body.js COLOR_MAP/LABELS. */
const DEFAULT_COLORS = {
  red: { color: '#ff9c94', label: '核心洞见/贡献' },
  yellow: { color: '#fff3a0', label: '关键定义/方法' },
  blue: { color: '#8fd0f7', label: '局限/风险' },
  green: { color: '#b0e3a8', label: '可借鉴/启发' },
  purple: { color: '#d9b8f2', label: '待深挖/存疑' },
}

const DEFAULT_STATS = {
  papers: [],
  overall: { papers_reviewed: 0, decided: 0, approved: 0, approve_rate: 0, modify_rate: 0 },
}

const DEFAULT_NOTES = '# 反思笔记（L4b）\n\n（自然语言画像日志，Agent 维护、用户可编辑）\n'

// ── colors.yml (minimal YAML subset: colors: / two-space entries / props) ───

function parseColorsYaml(text) {
  const colors = {}
  let current = null
  const lines = String(text || '').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (line === 'colors:') {
      current = null
      continue
    }
    const entry = /^  ([a-zA-Z0-9_]+):\s*$/.exec(line)
    if (entry) {
      current = entry[1]
      colors[current] = { color: '', label: '' }
      continue
    }
    const prop = /^    (color|label):\s*(.*)$/.exec(line)
    if (prop) {
      if (!current) throw new Error(`colors.yml: property line without a color entry: ${JSON.stringify(trimmed)}`)
      colors[current][prop[1]] = prop[2]
      continue
    }
    throw new Error(`colors.yml: unparsable line: ${JSON.stringify(trimmed)}`)
  }
  return colors
}

function stringifyColorsYaml(colors) {
  const lines = ['# 颜色语义（L1，用户固定指定）', '# <color>: { color: <hex>, label: <语义> }', 'colors:']
  for (const [name, c] of Object.entries(colors || {})) {
    lines.push(`  ${name}:`)
    lines.push(`    color: ${(c && c.color) || ''}`)
    lines.push(`    label: ${(c && c.label) || ''}`)
  }
  return lines.join('\n') + '\n'
}

// ── defaults / validation ────────────────────────────────────────────────────

function defaultProfile() {
  return {
    colors: JSON.parse(JSON.stringify(DEFAULT_COLORS)),
    rules: [],
    exemplars: [],
    stats: JSON.parse(JSON.stringify(DEFAULT_STATS)),
    reflection_notes: DEFAULT_NOTES,
  }
}

/** Throws on the first structural problem. Colors: hex + label; rules: non-empty rule text. */
function validateProfile(profile) {
  if (typeof profile !== 'object' || profile === null) throw new Error('profile must be an object')
  const colors = profile.colors
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) throw new Error('profile.colors must be an object map')
  for (const [name, c] of Object.entries(colors)) {
    if (typeof c !== 'object' || c === null) throw new Error(`profile.colors.${name}: entry must be an object`)
    if (typeof c.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(c.color)) {
      throw new Error(`profile.colors.${name}: color must be a hex string like #ff9c94`)
    }
    if (typeof c.label !== 'string') throw new Error(`profile.colors.${name}: label must be a string`)
  }
  if (!Array.isArray(profile.rules)) throw new Error('profile.rules must be an array')
  for (const r of profile.rules) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) throw new Error('profile.rules entry must be an object')
    if (typeof r.rule !== 'string' || r.rule.length === 0) throw new Error('profile.rules entry: rule must be a non-empty string')
    if (r.id !== undefined && (typeof r.id !== 'string' || r.id.length === 0)) throw new Error('profile.rules entry: id must be a non-empty string when present')
    if (r.confidence !== undefined && r.confidence !== null && typeof r.confidence !== 'string') throw new Error('profile.rules entry: confidence must be a string when present')
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') throw new Error('profile.rules entry: enabled must be a boolean when present')
    if (r.source !== undefined && r.source !== null && typeof r.source !== 'string') throw new Error('profile.rules entry: source must be a string when present')
  }
  if (!Array.isArray(profile.exemplars)) throw new Error('profile.exemplars must be an array')
  for (const e of profile.exemplars) {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new Error('profile.exemplars entry must be an object')
  }
  if (typeof profile.stats !== 'object' || profile.stats === null) throw new Error('profile.stats must be an object')
  if (!Array.isArray(profile.stats.papers)) throw new Error('profile.stats.papers must be an array')
  if (typeof profile.reflection_notes !== 'string') throw new Error('profile.reflection_notes must be a string')
  return true
}

// ── paths ────────────────────────────────────────────────────────────────────

function profileDir(root) {
  return path.join(root, PROFILE_DIR_NAME)
}

function profileFile(root, name) {
  return path.join(profileDir(root), name)
}

function reflectionsFile(root, paperId) {
  return path.join(root, 'data', paperId, 'reflections.json')
}

// ── read / write ─────────────────────────────────────────────────────────────

async function profileExists(root) {
  try {
    await fsp.access(profileFile(root, 'colors.yml'))
    return true
  } catch {
    return false
  }
}

/** Create the default four-layer profile when missing. Idempotent (never overwrites). */
async function ensureProfile(root) {
  const dir = profileDir(root)
  await fsp.mkdir(dir, { recursive: true })
  const defaults = defaultProfile()
  const needs = {
    'colors.yml': stringifyColorsYaml(defaults.colors),
    'rules.json': JSON.stringify(defaults.rules, null, 2),
    'exemplars.json': JSON.stringify(defaults.exemplars, null, 2),
    'stats.json': JSON.stringify(defaults.stats, null, 2),
    'reflection-notes.md': defaults.reflection_notes,
  }
  let created = false
  for (const [name, content] of Object.entries(needs)) {
    const file = profileFile(root, name)
    try {
      await fsp.access(file)
    } catch {
      await atomicWriteText(file, content)
      created = true
    }
  }
  return { created, dir }
}

async function readProfile(root) {
  await ensureProfile(root)
  const colors = parseColorsYaml(await fsp.readFile(profileFile(root, 'colors.yml'), 'utf8'))
  const profile = { colors }
  for (const name of JSON_LAYERS) {
    profile[name] = JSON.parse(await fsp.readFile(profileFile(root, name + '.json'), 'utf8'))
  }
  profile.reflection_notes = await fsp.readFile(profileFile(root, 'reflection-notes.md'), 'utf8')
  validateProfile(profile)
  return profile
}

/** Validate + persist the full profile (all layers). */
async function writeProfile(root, profile) {
  validateProfile(profile)
  const dir = profileDir(root)
  await fsp.mkdir(dir, { recursive: true })
  await atomicWriteText(profileFile(root, 'colors.yml'), stringifyColorsYaml(profile.colors))
  for (const name of JSON_LAYERS) {
    await atomicWriteJson(profileFile(root, name + '.json'), profile[name])
  }
  await atomicWriteText(profileFile(root, 'reflection-notes.md'), profile.reflection_notes)
  return profile
}

// ── profile summary (design §4.3 使用方式: propose 只收摘要) ─────────────────

/**
 * Compact summary injected into propose: L1 colors + L2 top-k enabled rules +
 * L3 top-k exemplars + one-line L4 stats. profile=null → built-in defaults
 * (pre-onboarding fallback), so propose works before cold start.
 */
function buildProfileSummary(profile, opts) {
  const maxRules = (opts && opts.max_rules) || 5
  const maxExemplars = (opts && opts.max_exemplars) || 5
  const colors = profile ? profile.colors : DEFAULT_COLORS
  const rules = profile ? (profile.rules || []).filter((r) => r.enabled !== false) : []
  const exemplars = profile ? (profile.exemplars || []).slice() : []
  const overall = profile && profile.stats && profile.stats.overall ? profile.stats.overall : null
  const statsSummary = overall && overall.papers_reviewed > 0
    ? `${overall.papers_reviewed} 篇论文 · 累计认可率 ${Math.round(overall.approve_rate * 100)}% · 累计修改率 ${Math.round(overall.modify_rate * 100)}%`
    : '暂无画像统计（冷启动）'
  return {
    has_profile: !!profile,
    colors,
    rules: rules.slice(0, maxRules),
    exemplars: exemplars.slice(0, maxExemplars),
    stats_summary: statsSummary,
    density: rules.find((r) => /^density/.test(r.rule)) || null,
    granularity: rules.find((r) => /^granularity/.test(r.rule)) || null,
  }
}

// ── proposal application (design §6: 确认后生效, host-only merge) ────────────

/** Next numeric rule id: 'rule-<n>'. */
function nextRuleId(profile) {
  let max = 0
  for (const r of profile.rules || []) {
    const m = /^rule-(\d+)$/.exec(r.id || '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return 'rule-' + String(max + 1)
}

/**
 * Per-paper approval/modify accounting (D4): decided = all non-pending review
 * outcomes; approved = accepted + recolored-kept + rescoped-kept.
 * Derived from proposal.sections[].counts (the reflect skill's own diff data).
 */
function derivePaperMetrics(proposal) {
  const sections = Array.isArray(proposal.sections) ? proposal.sections : []
  let accepted = 0
  let rejected = 0
  let recolored = 0
  let rescoped = 0
  let added = 0
  let pending = 0
  for (const s of sections) {
    const c = (s && s.counts) || {}
    accepted += c.accepted || 0
    rejected += c.rejected || 0
    recolored += c.recolored || 0
    rescoped += c.rescoped || 0
    added += c.user_added || 0
    pending += c.pending || 0
  }
  const decided = accepted + rejected + recolored + rescoped + added
  const approved = accepted + recolored + rescoped
  const approveRate = decided > 0 ? approved / decided : 0
  return {
    sections_reviewed: sections.length,
    decided,
    approved,
    approve_rate: Number(approveRate.toFixed(3)),
    modify_rate: Number((1 - approveRate).toFixed(3)),
    change_kinds: { accepted, rejected, recolored, rescoped, user_added: added, pending },
  }
}

/** Color distribution over non-rejected spans (optional; pass the paper highlights). */
function deriveColorDistribution(highlights) {
  const dist = {}
  for (const s of (highlights && highlights.spans) || []) {
    if (s.status === 'rejected') continue
    dist[s.color] = (dist[s.color] || 0) + 1
  }
  return dist
}

function recomputeOverall(paperEntries) {
  const decided = paperEntries.reduce((n, p) => n + (p.decided || 0), 0)
  const approved = paperEntries.reduce((n, p) => n + (p.approved || 0), 0)
  const rate = decided > 0 ? approved / decided : 0
  return {
    papers_reviewed: paperEntries.length,
    decided,
    approved,
    approve_rate: Number(rate.toFixed(3)),
    modify_rate: Number((1 - rate).toFixed(3)),
  }
}

/**
 * Pure merge of one reflections.json proposal (profile_proposal) into the
 * profile. decisions: { accept: 'all' | string[], reject: 'all' | string[] }
 * where ids are 'rule-<i>' / 'exemplar-<i>' (proposal-relative index) or the
 * rule's own id. Never mutates the input profile — returns a full next profile
 * the caller persists with writeProfile. Low-confidence rules are stored
 * disabled (candidates, D7). Idempotency (double-confirm rejection) is guarded
 * by the caller via reflections.confirmation.
 */
function applyProposal(profile, proposal, decisions, highlights) {
  if (typeof proposal !== 'object' || proposal === null || typeof proposal.profile_proposal !== 'object' || proposal.profile_proposal === null) {
    throw new Error('applyProposal: proposal must carry a profile_proposal object')
  }
  const pp = proposal.profile_proposal
  const rules = Array.isArray(pp.rules) ? pp.rules : []
  const exemplars = Array.isArray(pp.exemplars) ? pp.exemplars : []
  const d = decisions && typeof decisions === 'object' ? decisions : {}
  const acceptAll = d.accept === 'all'
  const rejectAll = d.reject === 'all'
  const acceptSet = new Set(Array.isArray(d.accept) ? d.accept : [])
  const rejectSet = new Set(Array.isArray(d.reject) ? d.reject : [])
  const want = (id, ownId) => {
    if (rejectAll || rejectSet.has(id) || (ownId && rejectSet.has(ownId))) return false
    return acceptAll || acceptSet.has(id) || (ownId && acceptSet.has(ownId))
  }

  const next = {
    colors: JSON.parse(JSON.stringify(profile.colors)),
    rules: (profile.rules || []).slice(),
    exemplars: (profile.exemplars || []).slice(),
    stats: JSON.parse(JSON.stringify(profile.stats || JSON.parse(JSON.stringify(DEFAULT_STATS)))),
    reflection_notes: profile.reflection_notes || '',
  }
  const applied = { rules: 0, exemplars: 0 }

  rules.forEach((r, i) => {
    if (!r || typeof r.rule !== 'string' || r.rule.length === 0) return
    const id = 'rule-' + i
    if (!want(id, r.id)) return
    next.rules.push({
      id: nextRuleId(next),
      rule: r.rule,
      confidence: r.confidence || null,
      source: r.source || `from ${proposal.paper_id}`,
      from: r.from || null,
      enabled: (r.confidence || '') !== 'low', // D7: low-confidence rules are candidates (disabled)
    })
    applied.rules++
  })

  exemplars.forEach((e, i) => {
    if (!e || typeof e !== 'object') return
    const id = 'exemplar-' + i
    if (!want(id, e.id)) return
    next.exemplars.push({
      span_id: e.span_id || null,
      suggested: e.suggested || null,
      user_decision: e.user_decision || null,
      section: e.section || null,
      note: e.note || null,
      from: proposal.paper_id,
    })
    applied.exemplars++
  })

  // stats: replace/append this paper's entry + recompute the overall aggregate
  const metrics = derivePaperMetrics(proposal)
  const entry = Object.assign({ paper_id: proposal.paper_id }, metrics)
  entry.color_distribution = deriveColorDistribution(highlights || null)
  const others = (next.stats.papers || []).filter((p) => p.paper_id !== proposal.paper_id)
  next.stats.papers = others.concat([entry])
  next.stats.overall = recomputeOverall(next.stats.papers)

  return { applied, profile: next }
}

/**
 * Pure partial update of the profile from the GUI edit panel (v0.3 Phase 3).
 * update: {
 *   colors?:           {name: {color, label}}  — merge over the existing map
 *                      (hex + label validated; unknown names are added)
 *   rules?:            [entries]               — replaces the WHOLE rule list;
 *                      entries keep their id when present, fresh ids are
 *                      allocated for new entries (id collisions deduped)
 *   exemplars?:        [entries]               — replaces the whole list (the
 *                      panel deletes by removing entries)
 *   reflection_notes?: string                  — replaces the notes text
 * }
 * Never mutates the input profile — returns { applied, profile: next } that the
 * caller persists with writeProfile. stats is NOT editable from the panel.
 */
function applyProfileUpdate(profile, update) {
  if (typeof update !== 'object' || update === null) throw new Error('applyProfileUpdate: update must be an object')
  const next = {
    colors: JSON.parse(JSON.stringify(profile.colors)),
    rules: (profile.rules || []).slice(),
    exemplars: (profile.exemplars || []).slice(),
    stats: JSON.parse(JSON.stringify(profile.stats || JSON.parse(JSON.stringify(DEFAULT_STATS)))),
    reflection_notes: profile.reflection_notes || '',
  }
  const applied = { colors: 0, rules: 0, exemplars: 0, reflection_notes: false }

  if (update.colors && typeof update.colors === 'object' && !Array.isArray(update.colors)) {
    for (const [name, c] of Object.entries(update.colors)) {
      if (typeof c !== 'object' || c === null) continue
      const color = typeof c.color === 'string' ? c.color.trim() : ''
      const label = typeof c.label === 'string' ? c.label : ''
      if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) throw new Error(`applyProfileUpdate: colors.${name} must be a hex color like #ff9c94`)
      next.colors[name] = { color, label }
      applied.colors++
    }
  }

  if (Array.isArray(update.rules)) {
    // Two passes: first derive the max numeric id among the SUBMITTED list
    // (the panel posts the whole edited list, so existing ids are authoritative
    // and must not collide with fresh ids for new rules), then rebuild.
    let maxNum = 0
    for (const r of update.rules) {
      if (!r || typeof r !== 'object') continue
      const m = /^rule-(\d+)$/.exec(typeof r.id === 'string' ? r.id : '')
      if (m) maxNum = Math.max(maxNum, Number(m[1]))
    }
    let seq = maxNum + 1
    const seen = new Set()
    const cleaned = []
    for (const r of update.rules) {
      if (!r || typeof r !== 'object') continue
      const rule = typeof r.rule === 'string' ? r.rule.trim() : ''
      if (!rule) continue
      const explicit = typeof r.id === 'string' && r.id.length > 0
      if (explicit && seen.has(r.id)) continue // duplicate explicit id in one submission → keep the first
      let id = explicit ? r.id : 'rule-' + seq
      while (seen.has(id)) {
        seq++
        id = 'rule-' + seq
      }
      seen.add(id)
      cleaned.push({
        id,
        rule,
        confidence: typeof r.confidence === 'string' ? r.confidence : null,
        source: typeof r.source === 'string' ? r.source : 'user-edit',
        enabled: r.enabled !== false,
      })
      seq++
      applied.rules++
    }
    next.rules = cleaned
  }

  if (Array.isArray(update.exemplars)) {
    next.exemplars = update.exemplars.filter((e) => e && typeof e === 'object' && !Array.isArray(e))
    applied.exemplars = next.exemplars.length
  }

  if (typeof update.reflection_notes === 'string') {
    next.reflection_notes = update.reflection_notes
    applied.reflection_notes = true
  }

  validateProfile(next)
  return { applied, profile: next }
}

// ── reflections.json (per-paper proposal + confirmation) ────────────────────

async function readReflections(root, paperId) {
  const file = reflectionsFile(root, paperId)
  let raw
  try {
    raw = await fsp.readFile(file, 'utf8')
  } catch {
    return null
  }
  const ref = JSON.parse(raw)
  validateReflections(ref)
  return ref
}

async function writeReflections(root, paperId, ref) {
  validateReflections(ref)
  await atomicWriteJson(reflectionsFile(root, paperId), ref)
  return ref
}

/** Papers with a reflections.json proposal that has not been confirmed yet. */
async function listPendingProposals(root) {
  const dataDir = path.join(root, 'data')
  let names = []
  try {
    const entries = await fsp.readdir(dataDir, { withFileTypes: true })
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  } catch {
    return []
  }
  const out = []
  for (const paperId of names) {
    let ref = null
    try {
      ref = await readReflections(root, paperId)
    } catch {
      ref = null // malformed reflections.json → skip (do not break the list)
    }
    if (ref && ref.confirmation == null && ref.profile_proposal) {
      out.push({ paper_id: paperId, updated_at: ref.updated_at || null, proposal: ref.profile_proposal })
    }
  }
  return out
}

module.exports = {
  PROFILE_DIR_NAME,
  DEFAULT_COLORS,
  parseColorsYaml,
  stringifyColorsYaml,
  defaultProfile,
  validateProfile,
  profileDir,
  profileFile,
  profileExists,
  ensureProfile,
  readProfile,
  writeProfile,
  buildProfileSummary,
  nextRuleId,
  derivePaperMetrics,
  deriveColorDistribution,
  recomputeOverall,
  applyProposal,
  applyProfileUpdate,
  readReflections,
  writeReflections,
  listPendingProposals,
}
