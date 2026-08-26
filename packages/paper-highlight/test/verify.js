'use strict'

/**
 * Shared verification helpers for the pipeline tests.
 */

const { validateAnchors, validateHighlights } = require('../host/schema')

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}

/** Core anchor-contract checks: every anchor's text appears in paper.md at md_offset. */
function verifyNormalized({ paperMd, anchors, meta }) {
  assert(typeof paperMd === 'string' && paperMd.length > 0, 'paper.md must be non-empty')
  assert(typeof anchors === 'object' && anchors !== null, 'anchors must be an object')
  validateAnchors(anchors) // throws on problem
  const ids = Object.keys(anchors)
  assert(ids.length > 0, 'anchors must not be empty')
  for (const id of ids) {
    const a = anchors[id]
    const slice = paperMd.slice(a.md_offset, a.md_offset + a.text.length)
    assert(slice === a.text, `anchor ${id} md_offset integrity: paper.md slice != anchor.text (${JSON.stringify(slice.slice(0, 60))} vs ${JSON.stringify(a.text.slice(0, 60))})`)
  }
  // anchors sorted by (page, block, par) must match reading order of paper.md offsets
  const sorted = [...ids].sort((x, y) => {
    const a = anchors[x]
    const b = anchors[y]
    return a.page - b.page || a.block - b.block || a.par - b.par
  })
  for (let i = 1; i < sorted.length; i++) {
    assert(
      anchors[sorted[i - 1]].md_offset < anchors[sorted[i]].md_offset,
      `anchors must be in reading order (${sorted[i - 1]} vs ${sorted[i]})`,
    )
  }
  assert(meta && typeof meta.id === 'string' && meta.id.length > 0, 'meta.id missing')
  assert(typeof meta.title === 'string', 'meta.title missing')
  assert(typeof meta.source_pdf === 'string', 'meta.source_pdf missing')
  assert(typeof meta.mineru_task === 'string', 'meta.mineru_task missing')
  assert(meta.stats && Number.isInteger(meta.stats.kept_blocks) && meta.stats.kept_blocks > 0, 'meta.stats.kept_blocks missing')
  return { anchorCount: ids.length }
}

/** Highlights round-trip checks: write → read → validate, plus a negative case. */
function verifyHighlightsRoundTrip({ root, paperId, makeSpans }) {
  const { readHighlights, writeHighlights, readPaperMd, readAnchors, readMeta } = require('../host/store')
  const { validateHighlights, newHighlightsSkeleton } = require('../host/schema')
  const anchors = readAnchorsSync(root, paperId)
  const firstId = Object.keys(anchors)[0]
  const secondId = Object.keys(anchors)[1]

  // fresh skeleton round trip
  const skeleton = newHighlightsSkeleton({ id: paperId, title: 't', sourcePdf: 's', mineruTask: 'm' })
  skeleton.anchors = anchors
  writeHighlightsSync(root, paperId, skeleton)
  const reread = readHighlightsSync(root, paperId)
  assert(reread.paper.id === paperId, 'skeleton round-trip: id mismatch')
  assert(validateHighlights(reread) === true, 'skeleton round-trip: validation failed')

  // spans
  const spans = makeSpans(anchors, firstId, secondId)
  const doc = { ...skeleton, spans }
  writeHighlightsSync(root, paperId, doc)
  const back = readHighlightsSync(root, paperId)
  assert(back.spans.length === spans.length, 'spans count mismatch after round-trip')
  assert(JSON.stringify(back.spans) === JSON.stringify(spans), 'spans content mismatch after round-trip')

  // negative: out-of-range span must throw
  const bad = {
    ...doc,
    spans: [{ id: 's-bad', anchor: firstId, char_start: -1, char_end: 5, color: 'red', rationale: 'x', status: 'proposed', decisions: [] }],
  }
  let threw = false
  try {
    writeHighlightsSync(root, paperId, bad)
  } catch (err) {
    threw = true
    assert(/out of bounds|char_start/.test(err.message), `negative case error message: ${err.message}`)
  }
  assert(threw, 'out-of-range span should have been rejected')
  return { firstId, secondId, spanCount: spans.length }
}

// sync helpers (small files, fine for tests)
const fs = require('node:fs')
const path = require('node:path')
const { paperFile } = require('../host/store')

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readAnchorsSync(root, paperId) {
  return readJson(paperFile(root, paperId, 'anchors.json'))
}
function readHighlightsSync(root, paperId) {
  const h = readJson(paperFile(root, paperId, 'paper.highlights.json'))
  validateHighlights(h)
  return h
}
function writeHighlightsSync(root, paperId, doc) {
  validateHighlights(doc)
  fs.writeFileSync(paperFile(root, paperId, 'paper.highlights.json'), JSON.stringify(doc, null, 2), 'utf8')
}
function readPaperMdSync(root, paperId) {
  return fs.readFileSync(paperFile(root, paperId, 'paper.md'), 'utf8')
}

module.exports = {
  assert,
  verifyNormalized,
  verifyHighlightsRoundTrip,
  readPaperMdSync,
}
