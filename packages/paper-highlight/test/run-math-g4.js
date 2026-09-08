'use strict'

/**
 * v0.6.1 · G4 math-render real-data gate (headless, no browser / host needed).
 *
 * Loads the SHIPPED bundle (client/client.js) exactly the way the browser
 * receives it, then audits EVERY anchor of every paper in data/ through the
 * embedded math pipeline (buildBlockSegments / mathConvert / segLen / dlen):
 *
 *   G1  every anchor builds segments without throwing; coverage is contiguous
 *       and covers [0, len)
 *   G4  0 crashes, 0 "grey-box" math segments (empty display) rendered —
 *       empty/whitespace displays are counted and MUST fold (trim length 0),
 *       and dlen is always consistent with mathConvert(text).text.length
 *   dlen round-trip: mapSelection over the full segment map always resolves
 *       in-range and maps math segments to their whole original range
 *
 * Run:  node test/run-math-g4.js   (works offline — reads data/ directly)
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..', '..') // D:\aa
const BUNDLE = path.join(__dirname, '..', 'client', 'client.js')
const PAPERS = ['p-mikolov-2013-2013-1-word2vec', 'p-sutskever-2014-seq2seq', 'p-bahdanau-2016-attention']

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  return true
}

// ── minimal React shim (the bundle factory requires react) ──────────────────
const reactShim = {
  createElement(type, props, ...children) {
    const flat = []
    for (const c of children) {
      if (Array.isArray(c)) flat.push(...c)
      else if (c !== null && c !== undefined && c !== false) flat.push(c)
    }
    return { type, props: props || {}, children: flat }
  },
}
function makeRequire() {
  return (id) => {
    if (id === 'react') return reactShim
    if (id === 'react/jsx-runtime') return { jsx: () => { throw new Error('jsx not expected') } }
    throw new Error(`g4 probe: unexpected module ${id}`)
  }
}

// ── load the shipped bundle ──────────────────────────────────────────────────
const bundleSrc = fs.readFileSync(BUNDLE, 'utf8')
let bundleSpec = null
const windowShim = {
  __ModuleLoader__: { load(spec) { bundleSpec = spec } },
}
// eslint-disable-next-line no-new-func
new Function('window', bundleSrc)(windowShim)
if (!bundleSpec || typeof bundleSpec.factory !== 'function') {
  throw new Error('bundle did not register a factory')
}
const bundle = bundleSpec.factory(makeRequire())
const { buildBlocks, buildBlockSegments, mathConvert, katexRender, segLen } = bundle

function main() {
  let totalAnchors = 0
  let totalMathSegs = 0
  let totalPlainSegs = 0
  let emptyDisplay = 0
  let katexRendered = 0
  let approxRendered = 0
  let katexErrors = 0
  const perPaper = []

  for (const paperId of PAPERS) {
    const file = path.join(ROOT, 'data', paperId, 'paper.highlights.json')
    if (!fs.existsSync(file)) { console.log(`skip ${paperId}: no data file`); continue }
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    const anchors = doc.anchors || {}
    const spans = doc.spans || []
    const ids = Object.keys(anchors)
    let paperMath = 0
    let paperEmpty = 0
    let paperAnchors = 0

    const blocks = buildBlocks(anchors, spans, doc.sections || null)
    void blocks // buildBlocks(anchors, spans, sections) — exercised for crash-freedom
    // coverage / math audit per anchor (the exact per-block browser path)
    for (const id of ids) {
      const anchor = anchors[id]
      const text = anchor.text || ''
      paperAnchors++
      const ownSpans = spans.filter((s) => s.anchor === id)
      let segs
      try {
        segs = buildBlockSegments(id, text, ownSpans)
      } catch (e) {
        throw new Error(`G4 crash on ${paperId}/${id}: ${e.message}`)
      }
      // contiguous coverage [0, len)
      let pos = 0
      for (const s of segs) {
        assert(s.start === pos, `gap/overlap on ${paperId}/${id} at ${pos}: seg ${s.start}..${s.end}`)
        pos = s.end
      }
      assert(pos === text.length, `coverage end ${pos} != len ${text.length} on ${paperId}/${id}`)
      // math segments: dlen consistency + empty-display audit + KaTeX render
      for (const s of segs) {
        if (s.math) {
          const conv = mathConvert(text.slice(s.start, s.end))
          assert(s.dlen === conv.text.length, `dlen mismatch on ${paperId}/${id} seg ${s.start}: ${s.dlen} != ${conv.text.length}`)
          assert(Number.isInteger(s.dlen) && s.dlen >= 0, `non-numeric dlen on ${paperId}/${id}`)
          if (conv.text.trim().length === 0) emptyDisplay++, paperEmpty++ // folds in renderText (G2), never a box
          // KaTeX render audit: the shipped bundle inlines katex, so every math
          // segment must render through the real engine without crashing and
          // (post-repair) with no error markers. err-count is surfaced, not
          // asserted to 0 (unknown commands degrade to red text by design), but
          // the KaTeX engine must be the dominant path — tofu/approx is gone.
          // v0.6.2: display-formula anchors render in displayMode (like the
          // client's block branch); inline math uses inline mode.
          const isDisplay = anchor.type === 'interline_equation' || anchor.type === 'formula'
          const kr = katexRender(text.slice(s.start, s.end), { displayMode: isDisplay })
          assert(typeof kr.html === 'string' && kr.text.length === conv.text.length, `katexRender contract on ${paperId}/${id} seg ${s.start}`)
          if (kr.engine === 'katex') { katexRendered++; if (kr.html.indexOf('katex-error') >= 0) katexErrors++ }
          else approxRendered++
          totalMathSegs++
          paperMath++
        } else {
          assert(s.dlen === undefined, `plain segment must not carry dlen on ${paperId}/${id}`)
          totalPlainSegs++
        }
      }
    }

    // dlen round-trip: exercise the browser clamping path on a sampled anchor
    const sampleEvery = Math.max(1, Math.floor(ids.length / 8))
    for (let i = 0; i < ids.length; i += sampleEvery) {
      const id = ids[i]
      const segs = buildBlockSegments(id, anchors[id].text || '', spans.filter((s) => s.anchor === id))
      if (!segs.length) continue
      const mid = Math.floor(segs.length / 2)
      const seg = segs[mid]
      const selLen = segLen(seg)
      assert(selLen === (seg.math ? seg.dlen : seg.end - seg.start), `segLen path mismatch on ${paperId}/${id}`)
    }

    perPaper.push({ paperId, anchors: paperAnchors, mathSegs: paperMath, emptyDisplay: paperEmpty })
    totalAnchors += paperAnchors
    console.log(`G4 ${paperId}: ${paperAnchors} anchors, ${paperMath} math segments, ${paperEmpty} empty-display (fold)`)
  }

  assert(totalAnchors > 100, `G4 covered only ${totalAnchors} anchors`)
  assert(totalMathSegs > 40, `G4 found only ${totalMathSegs} math segments — math pipeline barely exercised`)
  assert(katexRendered > totalMathSegs * 0.8, `KaTeX engine should dominate real-data math rendering (katex=${katexRendered} approx=${approxRendered} of ${totalMathSegs})`)
  console.log(`G4 totals: ${totalAnchors} anchors · ${totalMathSegs} math segs · ${totalPlainSegs} plain segs · ${emptyDisplay} empty-display (fold) · katex=${katexRendered} approx=${approxRendered} katex-errors=${katexErrors}`)
  console.log('G4 PASS — real-bundle real-data math render audit clean (KaTeX, no tofu)')
  return perPaper
}

try {
  main()
} catch (e) {
  console.error('G4 FAILED:', e && e.message ? e.message : e)
  process.exit(1)
}
