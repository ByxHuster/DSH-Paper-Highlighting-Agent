'use strict'

/**
 * paper-highlight · review diff analysis (v0.2 Phase 4)
 *
 * Pure functions that classify each span's proposed → final trajectory from
 * the append-only decisions[] log (design §4.2) and aggregate a per-section /
 * per-paper summary. Powers the `summarize_section_diff` agent tool so the
 * reflect skill never has to recount by hand (design §5.3 step 3-4).
 *
 * Decision actions (host/actions.js): proposed (agent), accepted / rejected /
 * recolored{from,to} / rescoped{from,to} / added / noted{note} (user).
 *
 * Primary classification (first match wins):
 *   rejected   status === 'rejected'
 *   added      status === 'user_added'
 *   recolored  any 'recolored' decision
 *   rescoped   any 'rescoped' decision
 *   noted      any 'noted' decision (commented, otherwise kept)
 *   accepted   status === 'accepted'
 *   pending    no user decision yet (status 'proposed')
 */

/** @returns {{ change: string, flags: {recolored:boolean, rescoped:boolean, noted:boolean} }} */
function classifySpanChange(span) {
  if (!span || typeof span !== 'object') return { change: 'pending', flags: { recolored: false, rescoped: false, noted: false } }
  const decisions = Array.isArray(span.decisions) ? span.decisions : []
  const has = (action) => decisions.some((d) => d && d.action === action)
  const flags = { recolored: has('recolored'), rescoped: has('rescoped'), noted: has('noted') }
  let change = 'pending'
  if (span.status === 'rejected') change = 'rejected'
  else if (span.status === 'user_added') change = 'added'
  else if (flags.recolored) change = 'recolored'
  else if (flags.rescoped) change = 'rescoped'
  else if (flags.noted) change = 'noted'
  else if (span.status === 'accepted') change = 'accepted'
  return { change, flags }
}

/** First matching decision detail (for samples). */
function firstDecision(span, action) {
  const decisions = Array.isArray(span.decisions) ? span.decisions : []
  return decisions.find((d) => d && d.action === action) || null
}

/**
 * Summarize a set of spans (already filtered to the target section when
 * requested). Lossless JSON output (no undefined/NaN).
 *
 * @param {Array<object>} spans
 * @param {object} [opts] { max_samples?: number } default 3 per change kind
 * @returns {object} { total, pending, decided, counts, accept_rate, samples }
 */
function summarizeDiff(spans, opts) {
  const maxSamples = (opts && opts.max_samples) || 3
  const counts = { accepted: 0, rejected: 0, recolored: 0, rescoped: 0, noted: 0, added: 0, pending: 0 }
  const samples = { accepted: [], rejected: [], recolored: [], rescoped: [], noted: [], added: [] }
  let total = 0
  for (const span of spans || []) {
    total++
    const { change, flags } = classifySpanChange(span)
    counts[change] = (counts[change] || 0) + 1
    const recolor = firstDecision(span, 'recolored')
    const rescope = firstDecision(span, 'rescoped')
    const sample = {
      span_id: span.id,
      anchor: span.anchor,
      color: span.color,
      status: span.status,
      rationale: span.rationale || '',
      note: span.note || null,
      recolor: recolor ? { from: recolor.from || null, to: recolor.to || null } : null,
      rescope: rescope
        ? {
            from: { anchor: (rescope.from && rescope.from.anchor) || span.anchor, char_start: (rescope.from && rescope.from.char_start) ?? span.char_start, char_end: (rescope.from && rescope.from.char_end) ?? span.char_end },
            to: { anchor: (rescope.to && rescope.to.anchor) || span.anchor, char_start: (rescope.to && rescope.to.char_start) ?? span.char_start, char_end: (rescope.to && rescope.to.char_end) ?? span.char_end },
          }
        : null,
    }
    if (samples[change] && samples[change].length < maxSamples) samples[change].push(sample)
  }
  const decided = total - counts.pending
  return {
    total,
    pending: counts.pending,
    decided,
    counts,
    accept_rate: decided > 0 ? Number((counts.accepted / decided).toFixed(3)) : 0,
    samples,
  }
}

module.exports = { classifySpanChange, summarizeDiff }
