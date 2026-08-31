'use strict'

/**
 * paper-highlight · review actions (v0.2 Phase 1)
 *
 * Pure, HTTP-free mutations over a paper.highlights.json document, driven by
 * the GUI review interactions (design doc §8 v0.2, decisions #1/#4):
 *
 *   accept  { span_id }                    → status=accepted
 *   reject  { span_id }                    → status=rejected
 *   recolor { span_id, color }             → span.color
 *   rescope { span_id, anchor, char_start, char_end }
 *   add     { anchor, char_start, char_end, color, rationale? }
 *   note    { span_id, note }              → span.note (user comment)
 *   review_section { section }             → plan.sections[i].status='reviewed'
 *   approve_section { section }            → accept ALL proposed spans in the
 *                                             section's anchor_ids + mark the
 *                                             section reviewed (v0.5.1)
 *
 * Every action appends an immutable decision (design §4.2: decisions append-
 * only, the profile-learning audit log). The caller persists the mutated
 * document with writeHighlights (which re-validates the whole schema).
 */

const ACTIONS = new Set(['accept', 'reject', 'recolor', 'rescope', 'add', 'note', 'review_section', 'approve_section'])

function nowIso() {
  return new Date().toISOString()
}

function decision(action, extra) {
  return Object.assign({ action, by: 'user', at: nowIso() }, extra || {})
}

function findSpan(doc, spanId) {
  const s = (doc.spans || []).find((x) => x.id === spanId)
  if (!s) throw new Error(`unknown span id: ${JSON.stringify(spanId)}`)
  return s
}

function assertColor(color) {
  if (typeof color !== 'string' || color.length === 0) throw new Error('color must be a non-empty string')
}

function assertRange(doc, anchorId, start, end) {
  const anchor = doc.anchors[anchorId]
  if (!anchor) throw new Error(`unknown anchor: ${JSON.stringify(anchorId)}`)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > anchor.text.length) {
    throw new Error(`range [${start}, ${end}) invalid for anchor ${anchorId} (text length ${anchor.text.length})`)
  }
}

function nextSpanId(doc) {
  let max = 0
  for (const s of doc.spans || []) {
    const m = /^s-(\d+)$/.exec(s.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return 's-' + String(max + 1).padStart(3, '0')
}

function applyAccept(doc, a) {
  const s = findSpan(doc, a.span_id)
  s.status = 'accepted'
  s.decisions.push(decision('accepted'))
  return { span: s }
}

function applyReject(doc, a) {
  const s = findSpan(doc, a.span_id)
  s.status = 'rejected'
  s.decisions.push(decision('rejected'))
  return { span: s }
}

function applyRecolor(doc, a) {
  const s = findSpan(doc, a.span_id)
  assertColor(a.color)
  const from = s.color
  s.color = a.color
  s.decisions.push(decision('recolored', { from, to: a.color }))
  return { span: s }
}

function applyRescope(doc, a) {
  const s = findSpan(doc, a.span_id)
  assertRange(doc, a.anchor, a.char_start, a.char_end)
  const from = { anchor: s.anchor, char_start: s.char_start, char_end: s.char_end }
  const to = { anchor: a.anchor, char_start: a.char_start, char_end: a.char_end }
  s.anchor = a.anchor
  s.char_start = a.char_start
  s.char_end = a.char_end
  s.decisions.push(decision('rescoped', { from, to }))
  return { span: s }
}

function applyAdd(doc, a) {
  assertRange(doc, a.anchor, a.char_start, a.char_end)
  assertColor(a.color)
  if (a.rationale !== undefined && typeof a.rationale !== 'string') throw new Error('rationale must be a string')
  const span = {
    id: nextSpanId(doc),
    anchor: a.anchor,
    char_start: a.char_start,
    char_end: a.char_end,
    color: a.color,
    rationale: a.rationale || '',
    status: 'user_added',
    decisions: [decision('added')],
  }
  doc.spans.push(span)
  return { span }
}

function applyNote(doc, a) {
  const s = findSpan(doc, a.span_id)
  if (a.note !== undefined && typeof a.note !== 'string') throw new Error('note must be a string')
  const note = a.note || ''
  s.note = note
  s.decisions.push(decision('noted', { note }))
  return { span: s }
}

/** Shared section-entry resolution: find the plan entry (by id or section
 *  title) or create one; then mark it reviewed. Returns the entry. */
function resolveReviewEntry(doc, section, opts) {
  let entry = (doc.plan.sections || []).find((e) => e.id === section || e.section === section)
  if (!entry) {
    let title = section
    if (opts && Array.isArray(opts.sections)) {
      const built = opts.sections.find((s) => s.id === section)
      if (built) title = built.title
    }
    entry = { id: section, section: title, status: 'reviewed', reviewed_at: nowIso() }
    doc.plan.sections.push(entry)
    return entry
  }
  entry.status = 'reviewed'
  entry.reviewed_at = nowIso()
  return entry
}

function applyReviewSection(doc, a, opts) {
  const section = a.section
  if (typeof section !== 'string' || section.length === 0) throw new Error('review_section: section must be a non-empty string id')
  return { section: resolveReviewEntry(doc, section, opts) }
}

/**
 * v0.5.1 · approve_section — one-click batch approval from the section TOC.
 * Accepts EVERY proposed span whose anchor belongs to the section (from the
 * built section index, opts.sections → anchor_ids), then marks the section
 * reviewed. When the agent proposed no highlights in the section (or the
 * section id is unknown / has no anchors) zero spans are accepted and the
 * section is still marked reviewed — "passing" an empty section. Accepted /
 * user_added / rejected spans are left untouched. Each accept appends an
 * 'accepted' decision (audit log). Pure mutation of `doc`.
 */
function applyApproveSection(doc, a, opts) {
  const section = a.section
  if (typeof section !== 'string' || section.length === 0) throw new Error('approve_section: section must be a non-empty string id')
  const anchors = new Set()
  if (opts && Array.isArray(opts.sections)) {
    const built = opts.sections.find((s) => s.id === section)
    if (built && Array.isArray(built.anchor_ids)) {
      for (const id of built.anchor_ids) anchors.add(id)
    }
  }
  const accepted = []
  for (const s of doc.spans || []) {
    if (s.status !== 'proposed' || !anchors.has(s.anchor)) continue
    s.status = 'accepted'
    s.decisions.push(decision('accepted'))
    accepted.push(s)
  }
  return { section: resolveReviewEntry(doc, section, opts), accepted, accepted_count: accepted.length }
}

/**
 * @param {object} doc    highlights document (mutated in place)
 * @param {object} action { action, ... }
 * @param {object} [opts] { sections?: built section list }
 * @returns {{ span?: object, section?: object }}
 */
function applyAction(doc, action, opts) {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) throw new Error('action must be an object')
  const kind = action.action
  if (typeof kind !== 'string' || !ACTIONS.has(kind)) throw new Error(`unsupported action: ${JSON.stringify(kind)}`)
  switch (kind) {
    case 'accept':
      return applyAccept(doc, action)
    case 'reject':
      return applyReject(doc, action)
    case 'recolor':
      return applyRecolor(doc, action)
    case 'rescope':
      return applyRescope(doc, action)
    case 'add':
      return applyAdd(doc, action)
    case 'note':
      return applyNote(doc, action)
    case 'review_section':
      return applyReviewSection(doc, action, opts)
    case 'approve_section':
      return applyApproveSection(doc, action, opts)
    default:
      throw new Error(`unsupported action: ${kind}`)
  }
}

module.exports = { applyAction, ACTIONS }
