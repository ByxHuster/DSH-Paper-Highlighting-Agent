'use strict'

/**
 * paper-highlight · review actions unit test (v0.2 Phase 1)
 *
 * Pure-logic coverage of host/actions.js WITHOUT the HTTP layer:
 *   - each action mutates the doc and appends an immutable decision
 *   - status transitions (accept/reject), recolor/rescope/note
 *   - manual add allocates the next s-<n> id with status user_added
 *   - review_section updates an existing plan entry and creates a missing one
 *   - negative cases throw (unknown span/anchor, bad ranges, bad color,
 *     unsupported action) and never persist partial mutations
 *
 * Run:  node test/run-actions.js
 */

const { applyAction } = require('../host/actions')
const { newHighlightsSkeleton, validateHighlights } = require('../host/schema')
const { assert } = require('./verify')

const SECTIONS = [
  { id: 's1', title: 'Title', level: 1, anchor_id: 'a-0001-01-01', empty: true, kind: 'paper_title' },
  { id: 's2', title: 'Abstract', level: 2, anchor_id: 'a-0001-03-01', empty: false, kind: 'section', anchor_ids: ['a-0001-03-01', 'a-0001-04-01'] },
  { id: 's3', title: 'References', level: 2, anchor_id: 'a-0001-05-01', empty: true, kind: 'section', anchor_ids: ['a-0001-05-01'] },
]

function makeDoc() {
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: 2 },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'text', text: 'Intro text.', md_offset: 9 },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'title', text: 'Abstract', md_offset: 28 },
    'a-0001-04-01': { page: 1, block: 4, par: 1, type: 'text', text: 'Abstract body text.', md_offset: 38 },
    'a-0001-05-01': { page: 1, block: 5, par: 1, type: 'title', text: 'References', md_offset: 62 },
  }
  const doc = newHighlightsSkeleton({ id: 'p-test', title: 'Title', sourcePdf: 's.pdf', mineruTask: 'm' })
  doc.anchors = anchors
  doc.plan.sections = [{ id: 's2', section: 'Abstract', status: 'pending' }]
  doc.spans = [
    { id: 's-001', anchor: 'a-0001-02-01', char_start: 0, char_end: 5, color: 'red', rationale: 'core', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
    { id: 's-002', anchor: 'a-0001-04-01', char_start: 0, char_end: 7, color: 'blue', rationale: 'risk', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
  ]
  return doc
}

function main() {
  // ── accept / reject ────────────────────────────────────────────────────────
  let doc = makeDoc()
  let r = applyAction(doc, { action: 'accept', span_id: 's-001' })
  assert(r.span && r.span.id === 's-001' && r.span.status === 'accepted', 'accept → status accepted')
  assert(r.span.decisions.length === 2 && r.span.decisions[1].action === 'accepted' && r.span.decisions[1].by === 'user', 'accept appends user decision')
  r = applyAction(doc, { action: 'reject', span_id: 's-002' })
  assert(r.span.status === 'rejected', 'reject → status rejected')
  assert(doc.spans[0].decisions.length === 2 && doc.spans[1].decisions.length === 2, 'decisions are append-only')

  // ── recolor ────────────────────────────────────────────────────────────────
  doc = makeDoc()
  r = applyAction(doc, { action: 'recolor', span_id: 's-001', color: 'green' })
  assert(r.span.color === 'green', 'recolor updates color')
  const rec = r.span.decisions[r.span.decisions.length - 1]
  assert(rec.action === 'recolored' && rec.from === 'red' && rec.to === 'green', 'recolor decision carries from/to')

  // ── rescope ────────────────────────────────────────────────────────────────
  doc = makeDoc()
  r = applyAction(doc, { action: 'rescope', span_id: 's-001', anchor: 'a-0001-04-01', char_start: 2, char_end: 6 })
  assert(r.span.anchor === 'a-0001-04-01' && r.span.char_start === 2 && r.span.char_end === 6, 'rescope updates anchor+range')
  const rs = r.span.decisions[r.span.decisions.length - 1]
  assert(rs.action === 'rescoped' && rs.to.char_start === 2 && rs.to.anchor === 'a-0001-04-01', 'rescope decision carries from/to')

  // ── add (manual highlight) ─────────────────────────────────────────────────
  doc = makeDoc()
  r = applyAction(doc, { action: 'add', anchor: 'a-0001-04-01', char_start: 8, char_end: 14, color: 'yellow', rationale: 'user note' })
  assert(r.span.id === 's-003', 'add allocates next id s-003')
  assert(r.span.status === 'user_added', 'add → status user_added')
  assert(r.span.rationale === 'user note', 'add keeps rationale')
  assert(doc.spans.length === 3, 'add pushes a span')
  assert(r.span.decisions.length === 1 && r.span.decisions[0].action === 'added', 'add appends added decision')

  // ── note ───────────────────────────────────────────────────────────────────
  doc = makeDoc()
  r = applyAction(doc, { action: 'note', span_id: 's-002', note: 'check later' })
  assert(r.span.note === 'check later', 'note sets span.note')
  const nt = r.span.decisions[r.span.decisions.length - 1]
  assert(nt.action === 'noted' && nt.note === 'check later', 'note decision carries note')

  // ── review_section: existing plan entry ────────────────────────────────────
  doc = makeDoc()
  r = applyAction(doc, { action: 'review_section', section: 's2' }, { sections: SECTIONS })
  assert(r.section && r.section.status === 'reviewed', 'review_section marks existing entry reviewed')
  assert(typeof r.section.reviewed_at === 'string' && r.section.reviewed_at.length > 0, 'reviewed_at timestamp set')
  assert(doc.plan.sections.length === 1, 'existing entry updated, not duplicated')

  // ── review_section: missing entry is created (with title from sections) ───
  doc = makeDoc()
  r = applyAction(doc, { action: 'review_section', section: 's3' }, { sections: SECTIONS })
  assert(r.section.status === 'reviewed' && r.section.id === 's3' && r.section.section === 'References', 'missing plan entry created with title')
  assert(doc.plan.sections.length === 2, 'new plan entry appended')

  // ── v0.5.1 approve_section: accepts ALL proposed spans in the section ─────
  doc = makeDoc()
  r = applyAction(doc, { action: 'approve_section', section: 's2' }, { sections: SECTIONS })
  assert(r.section && r.section.status === 'reviewed', 'approve_section marks the section reviewed')
  assert(Array.isArray(r.accepted) && r.accepted.length === 1, 'approve_section accepts exactly the section spans')
  assert(r.accepted[0].id === 's-002' && r.accepted[0].status === 'accepted', 'proposed span in Abstract accepted')
  assert(r.accepted_count === 1, 'accepted_count reported')
  assert(doc.spans[0].status === 'proposed', 'span in Intro (not in Abstract) untouched')
  assert(r.accepted[0].decisions.length === 2 && r.accepted[0].decisions[1].action === 'accepted' && r.accepted[0].decisions[1].by === 'user', 'approve_section appends per-span user decision')

  // ── approve_section: accepted/user_added/rejected spans are untouched ─────
  doc = makeDoc()
  doc.spans[1].status = 'user_added' // s-002 now user_added
  doc.spans.push({ id: 's-003', anchor: 'a-0001-04-01', char_start: 8, char_end: 14, color: 'red', status: 'rejected', decisions: [] })
  doc.spans.push({ id: 's-004', anchor: 'a-0001-04-01', char_start: 8, char_end: 14, color: 'red', status: 'accepted', decisions: [] })
  r = applyAction(doc, { action: 'approve_section', section: 's2' }, { sections: SECTIONS })
  assert(r.accepted_count === 0, 'no proposed span in section → 0 accepted')
  assert(doc.spans.find((s) => s.id === 's-002').status === 'user_added', 'user_added span untouched')
  assert(doc.spans.find((s) => s.id === 's-003').status === 'rejected', 'rejected span untouched')
  assert(doc.spans.find((s) => s.id === 's-004').status === 'accepted', 'accepted span untouched')
  assert(r.section.status === 'reviewed', 'empty-but-approved section still marked reviewed')

  // ── approve_section: unknown section id → accept none + still reviewed ────
  doc = makeDoc()
  r = applyAction(doc, { action: 'approve_section', section: 's9' }, { sections: SECTIONS })
  assert(r.accepted_count === 0 && r.section.id === 's9' && r.section.status === 'reviewed', 'unknown section: accept none, entry created reviewed')
  assert(doc.plan.sections.length === 2, 'unknown section plan entry appended')

  // ── approve_section: no opts.sections → accept none, still reviewed ───────
  doc = makeDoc()
  r = applyAction(doc, { action: 'approve_section', section: 's2' })
  assert(r.accepted_count === 0 && r.section.status === 'reviewed', 'no sections index → accept none, reviewed')

  // ── v0.5.3 revert_section (反选 = 批量恢复待审): reverts EVERY accepted span ─
  // ── in the section back to proposed (待审) + sets the section to pending ─────
  doc = makeDoc()
  doc.spans[1].status = 'accepted' // s-002 (Abstract body) was approved
  r = applyAction(doc, { action: 'revert_section', section: 's2' }, { sections: SECTIONS })
  assert(r.section && r.section.status === 'pending', 'revert_section sets the section back to pending (待审)')
  assert(Array.isArray(r.reverted) && r.reverted.length === 1, 'revert_section reverts exactly the section accepted spans')
  assert(r.reverted[0].id === 's-002' && r.reverted[0].status === 'proposed', 'accepted span in Abstract back to proposed (待审)')
  assert(r.reverted_count === 1, 'reverted_count reported')
  assert(doc.spans[0].status === 'proposed', 'span in Intro (not in Abstract) untouched')
  assert(r.reverted[0].decisions.length === 2 && r.reverted[0].decisions[1].action === 'proposed' && r.reverted[0].decisions[1].by === 'user', 'revert_section appends per-span user decision')

  // ── revert_section: only accepted spans revert; proposed/user_added/rejected ─
  // ── are untouched ───────────────────────────────────────────────────────────
  doc = makeDoc()
  doc.spans[1].status = 'user_added' // s-002 now user_added
  doc.spans.push({ id: 's-003', anchor: 'a-0001-04-01', char_start: 8, char_end: 14, color: 'red', status: 'rejected', decisions: [] })
  doc.spans.push({ id: 's-004', anchor: 'a-0001-04-01', char_start: 8, char_end: 14, color: 'red', status: 'accepted', decisions: [] })
  r = applyAction(doc, { action: 'revert_section', section: 's2' }, { sections: SECTIONS })
  assert(r.reverted_count === 1, 'only the accepted span in section reverts')
  assert(doc.spans.find((s) => s.id === 's-002').status === 'user_added', 'user_added span untouched by revert')
  assert(doc.spans.find((s) => s.id === 's-003').status === 'rejected', 'rejected span untouched by revert')
  assert(doc.spans.find((s) => s.id === 's-004').status === 'proposed', 'accepted span reverts to proposed')
  assert(r.section.status === 'pending', 'section back to pending even with 1 revert')

  // ── revert_section: approve → revert round trip (undo the one-click approve) ─
  doc = makeDoc()
  applyAction(doc, { action: 'approve_section', section: 's2' }, { sections: SECTIONS })
  assert(doc.spans.find((s) => s.id === 's-002').status === 'accepted' && doc.plan.sections.find((e) => e.id === 's2').status === 'reviewed', 'approve first: accepted + reviewed')
  r = applyAction(doc, { action: 'revert_section', section: 's2' }, { sections: SECTIONS })
  assert(r.reverted_count === 1 && doc.spans.find((s) => s.id === 's-002').status === 'proposed', 'revert undoes the approve (accepted → proposed)')
  assert(r.section.status === 'pending' && r.section.reviewed_at === undefined, 'revert clears reviewed + timestamp (section 待审)')

  // ── revert_section: unknown section id → revert none + entry created pending ─
  doc = makeDoc()
  r = applyAction(doc, { action: 'revert_section', section: 's9' }, { sections: SECTIONS })
  assert(r.reverted_count === 0 && r.section.id === 's9' && r.section.status === 'pending', 'unknown section: revert none, entry created pending')

  // ── revert_section: no opts.sections → revert none, section pending ────────
  doc = makeDoc()
  r = applyAction(doc, { action: 'revert_section', section: 's2' })
  assert(r.reverted_count === 0 && r.section.status === 'pending', 'no sections index → revert none, pending')

  // ── mutations stay schema-valid (note field + plan status/reviewed_at) ────
  assert(validateHighlights(doc) === true, 'document remains schema-valid after mutations')

  // ── negative cases ─────────────────────────────────────────────────────────
  const expectThrow = (fn, re, msg) => {
    let threw = null
    try {
      fn()
    } catch (err) {
      threw = err
    }
    assert(threw && (!re || re.test(threw.message)), msg + (threw ? ' :: ' + threw.message : ' (did not throw)'))
  }
  expectThrow(() => applyAction(makeDoc(), { action: 'accept', span_id: 's-999' }), /unknown span id/, 'unknown span id throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'recolor', span_id: 's-001', color: '' }), /color must be/, 'empty color throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'rescope', span_id: 's-001', anchor: 'a-0001-04-01', char_start: 0, char_end: 999 }), /out of bounds|range/, 'out-of-bounds rescope throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'rescope', span_id: 's-001', anchor: 'a-0009-99-99', char_start: 0, char_end: 2 }), /unknown anchor/, 'unknown rescope anchor throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'add', anchor: 'a-0001-04-01', char_start: -1, char_end: 3, color: 'red' }), /range/, 'negative add range throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'add', anchor: 'a-0001-04-01', char_start: 0, char_end: 3, color: '' }), /color must be/, 'add empty color throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'note', span_id: 's-001', note: 42 }), /note must be/, 'non-string note throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'nuke' }), /unsupported action/, 'unsupported action throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'review_section', section: '' }), /section must be/, 'empty review_section throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'approve_section', section: '' }), /section must be/, 'empty approve_section throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'approve_section', section: 42 }), /section must be/, 'non-string approve_section throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'revert_section', section: '' }), /section must be/, 'empty revert_section throws')
  expectThrow(() => applyAction(makeDoc(), { action: 'revert_section', section: 42 }), /section must be/, 'non-string revert_section throws')
  expectThrow(() => applyAction(makeDoc(), null), /action must be an object/, 'null action throws')

  console.log(JSON.stringify({
    step: 'actions-unit',
    result: 'PASS',
    covered: ['accept', 'reject', 'recolor', 'rescope', 'add', 'note', 'review_section', 'approve_section', 'revert_section'],
    approve_section: 'batch accept of all proposed spans in the section (anchor_ids), section marked reviewed; accepted/user_added/rejected untouched; empty/unknown/no-index sections → accept 0 + still reviewed; per-span user decisions appended',
    revert_section: '反选 = 批量恢复待审 — batch revert of all ACCEPTED spans in the section (anchor_ids) back to proposed (待审), section set back to pending (待审, clears reviewed_at); proposed/user_added/rejected untouched; approve→revert round trip undoes the one-click approve; unknown/no-index sections → revert 0 + entry pending; per-span user decisions appended',
    negative: 'unknown span/anchor, bad range, bad color, bad note, unsupported action, empty section (review + approve + revert)',
    audit: 'decisions append-only, mutations stay schema-valid',
  }, null, 2))
}

main()
