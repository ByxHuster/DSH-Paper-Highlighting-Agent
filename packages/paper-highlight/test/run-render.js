'use strict'

/**
 * paper-highlight · render helper unit test (v0.2 Phase 0)
 *
 * Exercises the SAME pure functions that are embedded into the shipped bundle
 * (client/render-body.js exports the module-level source, and gen-client.js
 * embeds their toString() into client.js / dynamic/client-half.js):
 *
 *   - buildBlocks: skips heading blocks of EMPTY sections (References) but
 *     never the paper-title section; drops spans with unknown anchors
 *   - clampRange / renderText: out-of-range spans are clamped (whitespace /
 *     normalization drift tolerance, design §10 #4) instead of throwing
 *
 * Run:  node test/run-render.js
 */

const { clampRange, sortAnchorIds, buildBlocks, renderText } = require('../client/render-body')
const { assert } = require('./verify')

// minimal React stub so renderText can create mark nodes
const reactStub = {
  createElement(type, props, ...children) {
    const flat = []
    for (const c of children) {
      if (Array.isArray(c)) flat.push(...c)
      else if (c !== null && c !== undefined && c !== false) flat.push(c)
    }
    return { type, props: props || {}, children: flat }
  },
}
global.React = reactStub

function fixture() {
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: 2 },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'title', text: 'Abstract', md_offset: 28 },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'Abstract body text.', md_offset: 38 },
    'a-0001-04-01': { page: 1, block: 4, par: 1, type: 'title', text: 'References', md_offset: 62 },
  }
  const sections = [
    { id: 's1', title: 'Title', kind: 'paper_title', anchor_id: 'a-0001-01-01', empty: true },
    { id: 's2', title: 'Abstract', kind: 'section', anchor_id: 'a-0001-02-01', empty: false },
    { id: 's3', title: 'References', kind: 'section', anchor_id: 'a-0001-04-01', empty: true },
  ]
  const spans = [
    { id: 's-001', anchor: 'a-0001-03-01', char_start: 0, char_end: 7, color: 'red', rationale: 'core', status: 'proposed' },
    { id: 's-002', anchor: 'a-0009-99-99', char_start: 0, char_end: 3, color: 'blue', rationale: 'ghost', status: 'proposed' },
  ]
  return { anchors, sections, spans }
}

function main() {
  // ── clampRange ─────────────────────────────────────────────────────────────
  assert(JSON.stringify(clampRange(2, 6, 10)) === '[2,6]', 'in-range span unchanged')
  assert(JSON.stringify(clampRange(20, 30, 10)) === '[10,10]', 'fully-out-of-range span clamps to end')
  assert(JSON.stringify(clampRange(-5, 3, 10)) === '[0,3]', 'negative start clamps to 0')
  assert(JSON.stringify(clampRange(8, 99, 10)) === '[8,10]', 'overflowing end clamps to len')
  assert(JSON.stringify(clampRange(6, 2, 10)) === '[6,6]', 'inverted range degrades to a point')

  // ── buildBlocks: empty-section skip + paper title kept + ghost span dropped ─
  const { anchors, sections, spans } = fixture()
  const blocks = buildBlocks(anchors, spans, sections)
  const ids = blocks.map((b) => b.id)
  assert(ids.length === 3, '3 blocks rendered (Title, Abstract, body)')
  assert(ids[0] === 'a-0001-01-01', 'paper title kept as first block')
  assert(!ids.includes('a-0001-04-01'), 'empty References heading skipped')
  assert(!ids.includes('a-0009-99-99'), 'ghost span anchor never becomes a block')
  const bodyBlock = blocks.find((b) => b.id === 'a-0001-03-01')
  assert(bodyBlock && bodyBlock.spans.length === 1 && bodyBlock.spans[0].id === 's-001', 'ghost span (unknown anchor) dropped from span list')
  assert(blocks.find((b) => b.id === 'a-0001-01-01').isFirstTitle === true, 'paper title flagged as first title (h1)')

  // without sections (dynamic-half fallback) nothing is skipped
  const noSections = buildBlocks(anchors, spans, null)
  assert(noSections.length === 4, 'without sections: no skip (4 blocks)')

  // ── renderText: clamped rendering still emits a mark ───────────────────────
  const text = 'Abstract body text.'
  const out = renderText(text, [{ id: 's-x', char_start: 100, char_end: 200, color: 'red', rationale: 'r', status: 'accepted' }])
  assert(out.length === 1, 'fully out-of-range span renders the plain text')
  assert(typeof out[0] === 'string' && out[0] === text, 'clamped-to-point span yields no mark, full text preserved')

  const out2 = renderText(text, [{ id: 's-y', char_start: 0, char_end: 200, color: 'blue', rationale: 'drift', status: 'proposed' }])
  const mark = out2.find((n) => n && n.type === 'mark')
  assert(mark && mark.children.join('') === text, 'overflowing span clamps to full text and still renders a mark')
  assert(mark.props.title.includes('drift') && mark.props.style.background === '#8fd0f7', 'mark carries rationale + blue color')

  // ── sortAnchorIds reading order ─────────────────────────────────────────────
  const sorted = sortAnchorIds(anchors)
  assert(JSON.stringify(sorted) === JSON.stringify(['a-0001-01-01', 'a-0001-02-01', 'a-0001-03-01', 'a-0001-04-01']), 'anchors in (page, block, par) order')

  console.log(JSON.stringify({
    step: 'render-helpers',
    result: 'PASS',
    phase0: 'empty References heading skipped, paper title kept, ghost spans dropped',
    clamp: 'out-of-range / negative / overflowing ranges clamp instead of throwing',
  }, null, 2))
}

main()
