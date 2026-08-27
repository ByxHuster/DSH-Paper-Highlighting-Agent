'use strict'

/**
 * paper-highlight · export layer unit tests (v0.4 Phase 0)
 *
 * Pure-function matrix for host/export.js:
 *   - buildExportSpans: accepted/user_added default, include_pending adds
 *     proposed, rejected never; range clamping; unknown-anchor/empty skip
 *   - resolveColors: null/empty → built-in five; partial → label/color fill;
 *     unknown-only → #cccccc + name fallback
 *   - renderHtml: self-contained (no external http(s) resources, no JS),
 *     <mark> count == exported marks, legend items == palette keys,
 *     hl-<color> classes present, HTML escaping of special chars
 *   - renderMarkdown: # title, <mark> count, legend block, raw text preserved
 *   - buildExport / normalizeFormat: format routing, stats, unknown format throws
 *
 * Run:  node test/run-export.js
 */

const { assert } = require('./verify')
const {
  buildExportSpans,
  resolveColors,
  legendHtml,
  legendMd,
  renderHtml,
  renderMarkdown,
  buildExport,
  normalizeFormat,
  DEFAULT_COLORS,
} = require('../host/export')

/** Minimal highlights document (anchors valid per schema; md_offset is not used by export). */
function makeDoc(spans) {
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Deep Learning', md_offset: 0 },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'text', text: 'The model improves performance on tasks.', md_offset: 15 },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'A limitation is the training cost.', md_offset: 61 },
  }
  return {
    paper: { id: 'p-test', title: 'Deep Learning' },
    anchors,
    plan: { summary: '', sections: [] },
    spans,
    duplicates: [],
  }
}

function sp(id, anchor, start, end, color, status, rationale) {
  return { id, anchor, char_start: start, char_end: end, color, rationale: rationale || '', status, decisions: [] }
}

function marksOf(htmlOrMd) {
  return (htmlOrMd.match(/<mark/g) || []).length
}

function legendItemsOf(htmlOrMd) {
  return (htmlOrMd.match(/class="phl-legend-item"/g) || []).length
}

function main() {
  const iso = '2026-08-27T00:00:00.000Z'

  // ── buildExportSpans: default filter (D3) ─────────────────────────────────
  const doc = makeDoc([
    sp('s-001', 'a-0001-02-01', 0, 9, 'red', 'accepted', 'core claim'),
    sp('s-002', 'a-0001-03-01', 2, 12, 'blue', 'user_added', ''),
    sp('s-003', 'a-0001-03-01', 0, 6, 'yellow', 'rejected', 'fluff'),
    sp('s-004', 'a-0001-02-01', 20, 30, 'purple', 'proposed', 'pending'),
  ])
  const def = buildExportSpans(doc)
  assert(def.length === 2, 'buildExportSpans: default keeps accepted + user_added (2)')
  assert(def.map((s) => s.id).join(',') === 's-001,s-002', 'buildExportSpans: ids s-001,s-002')
  assert(def[0].text === 'The model' && def[1].text === 'limitation', 'buildExportSpans: sliced highlight text')
  assert(def.every((s) => s.status !== 'rejected' && s.status !== 'proposed'), 'buildExportSpans: no rejected/proposed by default')

  const pend = buildExportSpans(doc, { include_pending: true })
  assert(pend.length === 3, 'buildExportSpans: include_pending adds proposed (3)')
  assert(pend.map((s) => s.id).includes('s-004'), 'buildExportSpans: proposed included with include_pending')
  assert(!pend.some((s) => s.status === 'rejected'), 'buildExportSpans: rejected never included')

  // clamping + skip empty/unknown anchor
  const clamped = buildExportSpans(makeDoc([
    { ...sp('s-c1', 'a-0001-02-01', -5, 999, 'red', 'accepted'), rationale: '' },
    { ...sp('s-c2', 'a-0001-02-01', 10, 10, 'green', 'accepted') },
    sp('s-c3', 'a-9999-99-99', 0, 3, 'yellow', 'accepted'),
  ]))
  assert(clamped.length === 1, 'buildExportSpans: empty-range and unknown-anchor spans skipped')
  assert(clamped[0].char_start === 0 && clamped[0].char_end === 40, 'buildExportSpans: range clamped to anchor text (0..40)')
  assert(clamped[0].text === 'The model improves performance on tasks.', 'buildExportSpans: clamped text is the full anchor text')

  // ── resolveColors ──────────────────────────────────────────────────────────
  const five = resolveColors(null)
  assert(Object.keys(five).length === 5, 'resolveColors: null → built-in five')
  assert(five.red.color === '#ff9c94' && five.red.label === '核心洞见/贡献', 'resolveColors: built-in red semantics')
  const partial = resolveColors({ red: { color: '#ff0000' }, teal: { color: '#7fe0d0', label: '新颜色' } })
  assert(partial.red.color === '#ff0000' && partial.red.label === '核心洞见/贡献', 'resolveColors: partial keeps built-in label')
  assert(partial.teal.label === '新颜色', 'resolveColors: custom color kept')
  const unknownOnly = resolveColors({ weird: {} })
  assert(unknownOnly.weird.color === '#cccccc' && unknownOnly.weird.label === 'weird', 'resolveColors: unknown color falls back to #cccccc + name')

  // ── renderHtml: self-contained + mark/legend counts ───────────────────────
  const html = renderHtml({ highlights: doc, exported_at: iso })
  assert(html.startsWith('<!DOCTYPE html>') && html.includes('<html lang="zh">'), 'renderHtml: document shell')
  assert(html.includes('<title>Deep Learning</title>'), 'renderHtml: title in head')
  assert(html.includes('paper_id: p-test') && html.includes('高亮 2 处'), 'renderHtml: meta header (paper_id + export stats)')
  assert(marksOf(html) === 2, 'renderHtml: <mark> count == exported marks (2)')
  assert(!/https?:\/\//.test(html), 'renderHtml: self-contained — no external http(s) resource')
  assert(!/<script/i.test(html), 'renderHtml: self-contained — no JS')
  assert(html.includes('mark.hl-red { background-color: #ff9c94; }'), 'renderHtml: hl-red CSS class present')
  assert(html.includes('mark.hl-blue { background-color: #8fd0f7; }'), 'renderHtml: hl-blue CSS class present')
  const legendItems = legendItemsOf(html)
  assert(legendItems === Object.keys(DEFAULT_COLORS).length, 'renderHtml: legend items == built-in color key count (5)')
  assert(html.includes('title="core claim"'), 'renderHtml: mark carries rationale as title')
  assert(!html.includes('rejected') && !html.includes('fluff'), 'renderHtml: rejected span text absent')

  // custom palette drives legend + CSS
  const htmlCustom = renderHtml({
    highlights: doc,
    colors: { red: { color: '#ff0000', label: '红核心' }, yellow: { color: '#fff000', label: '黄定义' } },
    exported_at: iso,
  })
  assert(legendItemsOf(htmlCustom) === 2, 'renderHtml: custom palette → 2 legend items')
  assert(htmlCustom.includes('mark.hl-red { background-color: #ff0000; }'), 'renderHtml: custom red color in CSS')
  assert(htmlCustom.includes('红核心'), 'renderHtml: custom label rendered in legend')

  // HTML escaping of special chars in text
  const escDoc = makeDoc([{ ...sp('s-e1', 'a-0001-02-01', 0, 9, 'red', 'accepted'), rationale: 'a<b>&c' }])
  const escHtml = renderHtml({ highlights: escDoc, exported_at: iso })
  assert(escHtml.includes('title="a&lt;b&gt;&amp;c"'), 'renderHtml: rationale HTML-escaped')
  assert(/<mark[^>]*>The model<\/mark>/.test(escHtml), 'renderHtml: mark wraps escaped text')

  // ── renderMarkdown ─────────────────────────────────────────────────────────
  const md = renderMarkdown({ highlights: doc, exported_at: iso })
  assert(md.startsWith('# Deep Learning'), 'renderMarkdown: H1 title')
  assert(md.includes('> paper_id: p-test') && md.includes('高亮 2 处'), 'renderMarkdown: meta quote line')
  assert(marksOf(md) === 2, 'renderMarkdown: <mark> count == exported marks (2)')
  assert(md.includes('<mark class="hl-red">The model</mark>'), 'renderMarkdown: inline mark with color class')
  assert(md.includes('## 图例') && md.includes('- **red** · 核心洞见/贡献'), 'renderMarkdown: legend block')
  assert(md.includes('A <mark class="hl-blue">limitation</mark> is the training cost.'), 'renderMarkdown: raw paragraph text preserved around inline mark')

  // ── buildExport / normalizeFormat ──────────────────────────────────────────
  const be = buildExport({ format: 'html', highlights: doc, exported_at: iso })
  assert(be.ok === true && be.format === 'html' && be.paper_id === 'p-test' && be.title === 'Deep Learning', 'buildExport: html routing')
  assert(be.stats.exported_marks === 2 && be.stats.chars === 9 + 10, 'buildExport: stats (exported_marks + chars)')
  assert(be.content === html, 'buildExport: html content identical to renderHtml')
  const beMd = buildExport({ format: 'md', highlights: doc, exported_at: iso })
  assert(beMd.format === 'md' && beMd.content === md, 'buildExport: md routing')
  const bePend = buildExport({ format: 'html', highlights: doc, include_pending: true, exported_at: iso })
  assert(bePend.stats.exported_marks === 3, 'buildExport: include_pending flows into stats')
  assert(normalizeFormat('HTML') === 'html' && normalizeFormat(undefined) === 'html' && normalizeFormat('md') === 'md', 'normalizeFormat: valid formats')
  let threw = false
  try {
    normalizeFormat('pdf')
  } catch (err) {
    threw = true
    assert(/unsupported export format/.test(err.message), `normalizeFormat: unknown format error: ${err.message}`)
  }
  assert(threw, 'normalizeFormat: unknown format throws')

  console.log(JSON.stringify({
    step: 'export',
    result: 'PASS',
    buildExportSpans: 'default accepted+user_added / include_pending adds proposed / rejected never / clamp + skip',
    resolveColors: 'null→5 built-in, partial fills, unknown→#cccccc+name',
    renderHtml: 'self-contained (no external http(s)/JS), <mark> count + legend items + hl-<color> CSS + escaping',
    renderMarkdown: '# title + meta + inline <mark> + legend + raw text preserved',
    buildExport: 'format routing (html/md), stats, include_pending',
  }, null, 2))
}

main()
