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
const {
  profileDir,
  profileExists,
  ensureProfile,
  readProfile,
  writeProfile,
  buildProfileSummary,
  nextRuleId,
  applyProposal,
  applyProfileUpdate,
  readReflections,
  writeReflections,
  listPendingProposals,
} = require('./profile')
const { buildExport, normalizeFormat, exportFileName } = require('./export')
const { formatAll } = require('./format')

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

/** POST /paper-hl/profile/save — GUI edit-panel write (v0.3 Phase 3):
 *  body { colors?, rules?, exemplars?, reflection_notes? } → applyProfileUpdate
 *  (pure merge, stats NOT editable) → atomic write → applied summary. */
async function handleProfileSave(root, req, res, send) {
  let body = {}
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    send(res, 400, { ok: false, error: 'request body must be valid JSON' })
    return
  }
  try {
    const profile = await readProfile(root)
    const result = applyProfileUpdate(profile, body)
    await writeProfile(root, result.profile)
    send(res, 200, { ok: true, applied: result.applied })
  } catch (err) {
    send(res, 400, { ok: false, error: String(err && err.message ? err.message : err) })
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

// ── v0.3 Phase 0: /paper-hl/profile routes (profile read / cold-start init /
//    proposal confirmation) ───────────────────────────────────────────────────

async function handleProfileGet(root) {
  const has = await profileExists(root)
  let profile = null
  if (has) profile = await readProfile(root)
  const pending = await listPendingProposals(root)
  return {
    ok: true,
    has_profile: has,
    profile_dir: profileDir(root),
    profile,
    summary: buildProfileSummary(profile),
    pending_proposals: pending,
  }
}

/** POST /paper-hl/profile/init — cold start: create defaults, then merge an
 *  optional { colors, rules } from the onboarding form (D6). */
async function handleProfileInit(root, req, res, send) {
  let body = {}
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    send(res, 400, { ok: false, error: 'request body must be valid JSON' })
    return
  }
  try {
    const { created, dir } = await ensureProfile(root)
    const profile = await readProfile(root)
    if (body.colors && typeof body.colors === 'object' && !Array.isArray(body.colors)) {
      for (const [name, c] of Object.entries(body.colors)) {
        if (c && typeof c === 'object' && typeof c.color === 'string' && c.color.length > 0) {
          profile.colors[name] = { color: c.color, label: (c && c.label) || name }
        }
      }
    }
    if (Array.isArray(body.rules)) {
      for (const r of body.rules) {
        if (!r || typeof r.rule !== 'string' || r.rule.length === 0) continue
        profile.rules.push({
          id: nextRuleId(profile),
          rule: r.rule,
          confidence: r.confidence || null,
          source: r.source || 'user-cold-start',
          enabled: r.enabled !== false,
        })
      }
    }
    await writeProfile(root, profile)
    send(res, 200, { ok: true, created, profile_dir: dir, colors: Object.keys(profile.colors).length, rules: profile.rules.length })
  } catch (err) {
    send(res, 400, { ok: false, error: String(err && err.message ? err.message : err) })
  }
}

/** POST /paper-hl/profile/apply?paperId=<id> — GUI confirmation channel (D5):
 *  body { decisions } mirrors the confirm_proposal tool (host-only merge). */
async function handleProfileApply(root, url, req, res, send) {
  const paperId = url.searchParams.get('paperId')
  if (!paperId) {
    send(res, 400, { ok: false, error: 'missing paperId query param' })
    return
  }
  let body = {}
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    send(res, 400, { ok: false, error: 'request body must be valid JSON' })
    return
  }
  try {
    const ref = await readReflections(root, paperId)
    if (!ref) {
      send(res, 400, { ok: false, error: `no reflections.json (no pending proposal) for paperId ${paperId}` })
      return
    }
    if (ref.confirmation != null) {
      send(res, 400, { ok: false, error: 'proposal already confirmed (confirmation recorded, append-only)' })
      return
    }
    const has = await profileExists(root)
    if (!has) await ensureProfile(root)
    const profile = await readProfile(root)
    let highlights = null
    try {
      highlights = await readHighlights(root, paperId)
    } catch {
      highlights = null
    }
    const decisions = body.decisions || {}
    const result = applyProposal(profile, ref, decisions, highlights)
    await writeProfile(root, result.profile)
    const accepted = result.applied.rules + result.applied.exemplars > 0
    ref.confirmation = { accepted, at: new Date().toISOString(), decisions }
    await writeReflections(root, paperId, ref)
    send(res, 200, { ok: true, paper_id: paperId, applied: result.applied, confirmation: ref.confirmation })
  } catch (err) {
    send(res, 400, { ok: false, error: String(err && err.message ? err.message : err) })
  }
}

/** GET /paper-hl/export?paperId=<id>&format=html|md&include_pending=&download=1
 *  (v0.4 Phase 1, D7): render the highlighted export for a paper and stream it
 *  back with the right Content-Type (text/html|text/markdown, utf-8) + no-store.
 *  `download=1` adds Content-Disposition: attachment. Colors come from the L1
 *  profile when present (built-in five otherwise); no side effects (never
 *  creates the profile — export falls back to defaults). */
async function handleExport(root, url, res) {
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
  let format
  try {
    format = normalizeFormat(url.searchParams.get('format') || 'html')
  } catch (err) {
    sendJson(res, 400, { ok: false, error: String(err && err.message ? err.message : err) })
    return
  }
  const q = (name) => url.searchParams.get(name) || ''
  const includePending = q('include_pending') === '1' || q('include_pending') === 'true'
  const download = q('download') === '1' || q('download') === 'true'
  try {
    const highlights = await readHighlights(root, paperId)
    const has = await profileExists(root)
    const colors = has ? (await readProfile(root)).colors : null
    const exported = buildExport({
      format,
      highlights,
      colors,
      include_pending: includePending,
      exported_at: new Date().toISOString(),
    })
    const body = Buffer.from(exported.content, 'utf8')
    const headers = {
      'Content-Type': format === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    }
    if (download) headers['Content-Disposition'] = `attachment; filename="${exportFileName(paperId, format)}"`
    res.writeHead(200, headers)
    res.end(body)
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) })
  }
}

/** POST /paper-hl/format — one-click factory reset (v0.5). Destructive:
 *  body { confirm: true, scope?: 'all'|'highlights'|'profile' } → formatAll
 *  clears all paper highlight records and/or the personalization profile.
 *  confirm must be exactly true, else 400 (no accidental wipes from a GET
 *  pre-fetch or a mis-click). Returns the cleared-count audit summary. */
async function handleFormat(root, req, res, send) {
  let body = {}
  try {
    body = JSON.parse((await readBody(req)) || '{}')
  } catch {
    send(res, 400, { ok: false, error: 'request body must be valid JSON' })
    return
  }
  if (body.confirm !== true) {
    send(res, 400, { ok: false, error: 'format requires confirm: true (destructive operation)' })
    return
  }
  try {
    const result = await formatAll(root, { confirm: true, scope: body.scope })
    send(res, 200, result)
  } catch (err) {
    send(res, 400, { ok: false, error: String(err && err.message ? err.message : err) })
  }
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
        if (url.pathname === '/paper-hl/profile' && (req.method === 'GET' || req.method === undefined)) {
          const payload = await handleProfileGet(root)
          sendJson(res, payload.ok ? 200 : 500, payload)
          return
        }
        if (url.pathname === '/paper-hl/profile/init' && req.method === 'POST') {
          await handleProfileInit(root, req, res, sendJson)
          return
        }
        if (url.pathname === '/paper-hl/profile/save' && req.method === 'POST') {
          await handleProfileSave(root, req, res, sendJson)
          return
        }
        if (url.pathname === '/paper-hl/profile/apply' && req.method === 'POST') {
          await handleProfileApply(root, url, req, res, sendJson)
          return
        }
        if (url.pathname === '/paper-hl/export' && (req.method === 'GET' || req.method === undefined)) {
          await handleExport(root, url, res)
          return
        }
        if (url.pathname === '/paper-hl/format' && req.method === 'POST') {
          await handleFormat(root, req, res, sendJson)
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

module.exports = { name, inject, apply, handleRead, handleProfileGet, handleProfileInit, handleProfileApply, handleProfileSave, handleExport, handleFormat, listPaperIds, buildSections, mergePlanStatus }
