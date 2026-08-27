'use strict'

/**
 * paper-highlight · data model (design doc §4.1 / §4.2)
 *
 * Files under data/<paper_id>/:
 *   paper.md              rendered body-text Markdown (generated from kept blocks)
 *   anchors.json          anchor index: anchor_id -> { page, block, par, text, md_offset }
 *   paper.highlights.json self-contained highlight document (embeds the anchors map)
 *   meta.json             paper metadata + normalization stats
 *
 * Anchor model:
 *   anchor_id = `a-<page:04d>-<block:02d>-<par:02d>` with 1-based, zero-padded
 *   components (page = MinerU page_idx + 1, block = block index + 1, par = paragraph
 *   ordinal within block + 1). Span char offsets are 0-based half-open [start, end)
 *   ranges into anchor.text.
 */

const ANCHOR_ID_RE = /^a-\d{4}-\d{2}-\d{2}$/

const SPAN_STATUSES = ['proposed', 'accepted', 'rejected', 'user_added']

function parseAnchorId(id) {
  if (typeof id !== 'string' || !ANCHOR_ID_RE.test(id)) {
    throw new Error(`invalid anchor id: ${JSON.stringify(id)}`)
  }
  const [page, block, par] = id.slice(2).split('-').map(Number)
  return { page, block, par }
}

/** Build an anchor id from 1-based components. */
function anchorId(page, block, par) {
  const p = String(page).padStart(4, '0')
  const b = String(block).padStart(2, '0')
  const r = String(par).padStart(2, '0')
  return `a-${p}-${b}-${r}`
}

/** Fresh paper.highlights.json skeleton per design §4.2. */
function newHighlightsSkeleton({ id, title, sourcePdf, mineruTask }) {
  return {
    paper: {
      id,
      title: title || '',
      source_pdf: sourcePdf || '',
      mineru_task: mineruTask || '',
    },
    anchors: {},
    plan: { summary: '', sections: [] },
    spans: [],
    duplicates: [],
  }
}

/** Validate the anchors map (anchors.json body). Throws on the first problem. */
function validateAnchors(anchors) {
  if (typeof anchors !== 'object' || anchors === null || Array.isArray(anchors)) {
    throw new Error('anchors must be an object map')
  }
  for (const [id, a] of Object.entries(anchors)) {
    if (!ANCHOR_ID_RE.test(id)) throw new Error(`anchor key is not a valid anchor id: ${JSON.stringify(id)}`)
    if (typeof a !== 'object' || a === null) throw new Error(`anchor ${id}: entry must be an object`)
    for (const k of ['page', 'block', 'par']) {
      if (!Number.isInteger(a[k]) || a[k] < 1) throw new Error(`anchor ${id}: ${k} must be a positive integer`)
    }
    if (typeof a.text !== 'string' || a.text.length === 0) throw new Error(`anchor ${id}: text must be a non-empty string`)
    if (a.type !== undefined && typeof a.type !== 'string') throw new Error(`anchor ${id}: type must be a string when present`)
    if (typeof a.md_offset !== 'number' || a.md_offset < 0) throw new Error(`anchor ${id}: md_offset must be a non-negative number`)
    const parsed = parseAnchorId(id)
    if (parsed.page !== a.page || parsed.block !== a.block || parsed.par !== a.par) {
      throw new Error(`anchor ${id}: id components do not match the entry fields`)
    }
  }
}

/** Validate a highlights document. Throws on the first problem. */
function validateHighlights(h) {  if (typeof h !== 'object' || h === null) throw new Error('highlights must be an object')
  if (typeof h.paper !== 'object' || h.paper === null) throw new Error('highlights.paper must be an object')
  if (typeof h.paper.id !== 'string' || h.paper.id.length === 0) throw new Error('highlights.paper.id must be a non-empty string')
  validateAnchors(h.anchors)
  if (typeof h.plan !== 'object' || h.plan === null || typeof h.plan.summary !== 'string') {
    throw new Error('highlights.plan must be an object with a string summary')
  }
  if (!Array.isArray(h.plan.sections)) throw new Error('highlights.plan.sections must be an array')
  for (const s of h.plan.sections) {
    if (typeof s !== 'object' || s === null) throw new Error('plan.sections entry must be an object')
    if (s.id !== undefined && (typeof s.id !== 'string' || s.id.length === 0)) {
      throw new Error('plan.sections: id must be a non-empty string when present')
    }
    if (s.section !== undefined && typeof s.section !== 'string') throw new Error('plan.sections: section must be a string when present')
    if (s.expected_colors !== undefined && !Array.isArray(s.expected_colors)) {
      throw new Error('plan.sections: expected_colors must be an array when present')
    }
    if (s.density_hint !== undefined && typeof s.density_hint !== 'string') {
      throw new Error('plan.sections: density_hint must be a string when present')
    }
    if (s.skip !== undefined && typeof s.skip !== 'boolean') throw new Error('plan.sections: skip must be a boolean when present')
    if (s.status !== undefined && !['pending', 'reviewed'].includes(s.status)) {
      throw new Error(`plan.sections: invalid status ${JSON.stringify(s.status)}`)
    }
    if (s.reviewed_at !== undefined && typeof s.reviewed_at !== 'string') {
      throw new Error('plan.sections: reviewed_at must be a string when present')
    }
  }
  if (!Array.isArray(h.spans)) throw new Error('highlights.spans must be an array')
  if (!Array.isArray(h.duplicates)) throw new Error('highlights.duplicates must be an array')
  // Phase 4: duplicates are append-only registrations of repeated claims
  // (design §4.2): { claim, highlighted_at?, repeats_at? }. Validate entries so
  // the propose skill's dedup registration cannot corrupt the document.
  for (const d of h.duplicates) {
    if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new Error('duplicates entry must be an object')
    if (typeof d.claim !== 'string' || d.claim.length === 0) throw new Error('duplicates entry: claim must be a non-empty string')
    if (d.highlighted_at !== undefined && typeof d.highlighted_at !== 'string') throw new Error('duplicates entry: highlighted_at must be a string when present')
    if (d.repeats_at !== undefined && (!Array.isArray(d.repeats_at) || d.repeats_at.some((r) => typeof r !== 'string'))) {
      throw new Error('duplicates entry: repeats_at must be an array of strings when present')
    }
  }

  const seenSpanIds = new Set()
  for (const s of h.spans) {
    if (typeof s !== 'object' || s === null) throw new Error('span entry must be an object')
    if (typeof s.id !== 'string' || s.id.length === 0) throw new Error('span: id must be a non-empty string')
    if (seenSpanIds.has(s.id)) throw new Error(`duplicate span id: ${s.id}`)
    seenSpanIds.add(s.id)
    const anchor = h.anchors[s.anchor]
    if (!anchor) throw new Error(`span ${s.id}: unknown anchor ${JSON.stringify(s.anchor)}`)
    if (!Number.isInteger(s.char_start) || !Number.isInteger(s.char_end)) {
      throw new Error(`span ${s.id}: char_start/char_end must be integers`)
    }
    if (s.char_start < 0 || s.char_end <= s.char_start || s.char_end > anchor.text.length) {
      throw new Error(`span ${s.id}: range [${s.char_start}, ${s.char_end}) out of bounds for anchor text length ${anchor.text.length}`)
    }
    if (typeof s.color !== 'string' || s.color.length === 0) throw new Error(`span ${s.id}: color must be a non-empty string`)
    if (typeof s.rationale !== 'string') throw new Error(`span ${s.id}: rationale must be a string`)
    if (s.note !== undefined && typeof s.note !== 'string') throw new Error(`span ${s.id}: note must be a string when present`)
    if (!SPAN_STATUSES.includes(s.status)) throw new Error(`span ${s.id}: invalid status ${JSON.stringify(s.status)}`)
    if (!Array.isArray(s.decisions)) throw new Error(`span ${s.id}: decisions must be an array`)
  }
  return true
}

/**
 * Validate a reflections.json document (v0.2 Phase 5 reflect output + v0.3
 * Phase 0 confirmation). Lenient: only the shape that the confirm flow relies
 * on is enforced — paper_id, optional profile_proposal object, and an
 * append-only confirmation (null | { accepted, at?, decisions? }).
 */
function validateReflections(r) {
  if (typeof r !== 'object' || r === null) throw new Error('reflections must be an object')
  if (typeof r.paper_id !== 'string' || r.paper_id.length === 0) throw new Error('reflections.paper_id must be a non-empty string')
  if (r.profile_proposal !== undefined && (typeof r.profile_proposal !== 'object' || r.profile_proposal === null)) {
    throw new Error('reflections.profile_proposal must be an object when present')
  }
  if (r.confirmation !== undefined && r.confirmation !== null) {
    const c = r.confirmation
    if (typeof c !== 'object' || c === null) throw new Error('reflections.confirmation must be null or an object')
    if (typeof c.accepted !== 'boolean') throw new Error('reflections.confirmation.accepted must be a boolean')
    if (c.at !== undefined && typeof c.at !== 'string') throw new Error('reflections.confirmation.at must be a string when present')
    if (c.decisions !== undefined && (typeof c.decisions !== 'object' || c.decisions === null)) {
      throw new Error('reflections.confirmation.decisions must be an object when present')
    }
  }
  return true
}

module.exports = {
  ANCHOR_ID_RE,
  SPAN_STATUSES,
  parseAnchorId,
  anchorId,
  newHighlightsSkeleton,
  validateAnchors,
  validateHighlights,
  validateReflections,
}
