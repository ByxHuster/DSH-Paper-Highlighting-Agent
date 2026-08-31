'use strict'

/**
 * paper-highlight · one-click format (factory reset) — v0.5
 *
 * A destructive "一键格式化" that clears ALL paper highlight records and the
 * personalization profile, returning the workspace to a factory-fresh state:
 *
 *   scope 'highlights' (default part of 'all'):
 *     for every paper under data/<paper_id>/
 *       - paper.highlights.json → fresh skeleton (paper meta + anchors kept,
 *         plan/spans/duplicates reset) — the parsed paper (paper.md,
 *         anchors.json, meta.json) is NEVER touched, so re-proposing can
 *         resume immediately
 *       - reflections.json  → deleted (per-paper reflect proposals)
 *       - export/           → deleted (generated export artifacts)
 *       - paper-reflection.md → deleted (paper-level reflection scaffold)
 *   scope 'profile':
 *     highlight-profile/ (colors.yml / rules.json / exemplars.json /
 *       stats.json / reflection-notes.md) → directory deleted → the GUI
 *       returns to cold-start onboarding
 *
 * Design notes (mirroring v0.4 D1–D7 conventions):
 *   - formatHighlights / normalizeScope are PURE (unit-testable).
 *   - formatAll is the async orchestrator; it REQUIRES `confirm: true`
 *     (a destructive operation must never fire from a GET pre-fetch or a
 *     mis-click — the GUI and the tool both send an explicit confirmation).
 *   - The report counts every cleared unit (spans / plan entries /
 *     duplicates / reflections / export files / paper-reflections / rules /
 *     exemplars) so the caller (route or tool) can surface what was wiped.
 *   - No backup files are created: the user asked to wipe, a backup would
 *     silently re-create state. The response IS the audit record.
 *
 * Zero external dependencies (node builtins + sibling store/profile/schema)
 * so it resolves cleanly through the profile junction tree.
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const { readHighlights, writeHighlights, paperDir } = require('./store')
const { profileDir } = require('./profile')

const SCOPES = ['all', 'highlights', 'profile']

/**
 * Validate + normalize the format scope. Defaults to 'all'.
 * @param {string} [scope]
 * @returns {string} 'all' | 'highlights' | 'profile'
 * @throws when scope is provided but not one of the known values
 */
function normalizeScope(scope) {
  const s = scope === undefined || scope === null || scope === '' ? 'all' : String(scope).toLowerCase()
  if (!SCOPES.includes(s)) throw new Error(`format: unsupported scope ${JSON.stringify(scope)} (all|highlights|profile)`)
  return s
}

/**
 * PURE — reset one highlights document to a fresh skeleton.
 * Keeps paper meta + the anchors map; clears plan (summary + sections),
 * spans and duplicates. The returned document passes validateHighlights
 * (paper.id is preserved, so the schema's non-empty id contract holds).
 */
function formatHighlights(highlights) {
  const h = highlights && typeof highlights === 'object' ? highlights : {}
  const paper = h.paper && typeof h.paper === 'object' ? h.paper : {}
  const anchors = h.anchors && typeof h.anchors === 'object' ? h.anchors : {}
  return {
    paper: { id: paper.id || '', title: paper.title || '', source_pdf: paper.source_pdf || '', mineru_task: paper.mineru_task || '' },
    anchors,
    plan: { summary: '', sections: [] },
    spans: [],
    duplicates: [],
  }
}

/** Directories (papers) under <root>/data/ — empty/missing data dir → []. */
async function listPaperDirs(root) {
  const dataDir = path.join(root, 'data')
  let entries = []
  try {
    entries = await fsp.readdir(dataDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

async function fileExists(file) {
  try {
    await fsp.access(file)
    return true
  } catch {
    return false
  }
}

async function isDir(dir) {
  try {
    const st = await fsp.stat(dir)
    return st.isDirectory()
  } catch {
    return false
  }
}

/** Count rules/exemplars in the profile WITHOUT the ensureProfile side effect
 *  (readProfile would CREATE missing layers — a format call must not write). */
async function countProfileLayers(root) {
  const out = { rules: 0, exemplars: 0 }
  for (const name of ['rules', 'exemplars']) {
    const file = path.join(profileDir(root), name + '.json')
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8'))
      if (Array.isArray(parsed)) out[name] = parsed.length
    } catch {
      // missing / malformed layer → counted as 0 (the dir is still removed)
    }
  }
  return out
}

/**
 * Async orchestrator — wipe paper highlight records and/or the profile.
 * @param {string} root workspace root (holds data/ + highlight-profile/)
 * @param {object} opts { confirm: boolean (REQUIRED true), scope?, now? }
 * @returns {Promise<object>} { ok, scope, at, papers_processed, spans_cleared,
 *          plans_cleared, duplicates_cleared, reflections_removed,
 *          exports_removed, paper_reflections_removed, profile_removed,
 *          rules_cleared, exemplars_cleared }
 * @throws when confirm is not exactly true
 */
async function formatAll(root, opts) {
  if (!opts || opts.confirm !== true) {
    throw new Error('format: confirm: true is required (destructive operation)')
  }
  const scope = normalizeScope(opts && opts.scope)
  const at = (opts && opts.now) || new Date().toISOString()
  const stats = {
    ok: true,
    scope,
    at,
    papers_processed: 0,
    spans_cleared: 0,
    plans_cleared: 0,
    duplicates_cleared: 0,
    reflections_removed: 0,
    exports_removed: 0,
    paper_reflections_removed: 0,
    profile_removed: false,
    rules_cleared: 0,
    exemplars_cleared: 0,
  }

  if (scope === 'all' || scope === 'highlights') {
    const paperIds = await listPaperDirs(root)
    for (const paperId of paperIds) {
      stats.papers_processed++
      const dir = paperDir(root, paperId)
      // 1) reset paper.highlights.json (keep paper + anchors, drop the rest)
      try {
        const highlights = await readHighlights(root, paperId)
        stats.spans_cleared += (highlights.spans || []).length
        stats.duplicates_cleared += (highlights.duplicates || []).length
        stats.plans_cleared += ((highlights.plan && highlights.plan.sections) || []).length
        await writeHighlights(root, paperId, formatHighlights(highlights))
      } catch (err) {
        // missing / malformed highlights.json → nothing to reset, keep going
        stats.spans_cleared += 0
      }
      // 2) reflections.json — per-paper reflect proposals
      const reflectionsFile = path.join(dir, 'reflections.json')
      if (await fileExists(reflectionsFile)) {
        await fsp.rm(reflectionsFile, { force: true })
        stats.reflections_removed++
      }
      // 3) export/ — generated export artifacts
      const exportDir = path.join(dir, 'export')
      if (await isDir(exportDir)) {
        try {
          stats.exports_removed += (await fsp.readdir(exportDir)).length
        } catch {
          // counting is best-effort; the rm below is authoritative
        }
        await fsp.rm(exportDir, { recursive: true, force: true })
      }
      // 4) paper-reflection.md — paper-level reflection scaffold
      const prFile = path.join(dir, 'paper-reflection.md')
      if (await fileExists(prFile)) {
        await fsp.rm(prFile, { force: true })
        stats.paper_reflections_removed++
      }
    }
  }

  if (scope === 'all' || scope === 'profile') {
    const dir = profileDir(root)
    if (await isDir(dir)) {
      const counts = await countProfileLayers(root)
      stats.rules_cleared += counts.rules
      stats.exemplars_cleared += counts.exemplars
      await fsp.rm(dir, { recursive: true, force: true })
      stats.profile_removed = true
    }
  }

  return stats
}

module.exports = {
  SCOPES,
  normalizeScope,
  formatHighlights,
  formatAll,
  listPaperDirs,
}
