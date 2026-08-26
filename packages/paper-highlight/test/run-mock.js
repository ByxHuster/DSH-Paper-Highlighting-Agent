'use strict'

/**
 * Offline mock verification of the v0.1 data pipeline:
 *   mock MinerU zip → normalizeMineruZip → writePaper → highlights round-trip.
 * Run:  node test/run-mock.js   (needs fflate resolvable, e.g. NODE_PATH=<profile node_modules>)
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const { buildMockZip } = require('./fixtures/make-mock-zip')
const { normalizeMineruZip } = require('../host/normalize')
const { writePaper, readAnchors } = require('../host/store')
const { assert, verifyNormalized, verifyHighlightsRoundTrip } = require('./verify')

const EXPECTED_ANCHORS = ['a-0001-01-01', 'a-0001-02-01', 'a-0002-02-01', 'a-0002-04-01']

const EXPECTED_MD = [
  '# Distributed Representations of Words and Phrases and their Compositionality',
  'We present several improvements over the Skip-gram model including subsampling of frequent words and negative sampling.',
  'The main contribution of this paper is a method that learns high-quality vector representations of words from large amounts of text.',
  'Future work includes training on even larger corpora.',
].join('\n\n') + '\n'

async function main() {
  const root = path.join(__dirname, '.tmp', 'root')
  await fsp.rm(root, { recursive: true, force: true })

  const zipPath = path.join(__dirname, 'fixtures', 'mock-mineru.zip')
  await buildMockZip(zipPath)
  const paperId = 'p-mock'

  // ---- normalize ----
  const { paperMd, anchors, meta } = await normalizeMineruZip({
    zipPath,
    paperId,
    title: 'Mock Paper Title',
    sourcePdf: 'mock.pdf',
    mineruTask: 'task-mock',
  })

  assert(Object.keys(anchors).length === EXPECTED_ANCHORS.length, `expected ${EXPECTED_ANCHORS.length} anchors, got ${Object.keys(anchors).length}`)
  for (const id of EXPECTED_ANCHORS) {
    assert(anchors[id] !== undefined, `missing expected anchor ${id}`)
  }
  assert(paperMd === EXPECTED_MD, `paper.md mismatch:\n--- got ---\n${paperMd}\n--- want ---\n${EXPECTED_MD}`)

  assert(meta.stats.skipped.by_type.image === 1, 'image block should be skipped')
  assert(meta.stats.skipped.by_type.table === 1, 'table block should be skipped')
  assert(meta.stats.skipped.by_type.formula === 1, 'formula block should be skipped')
  assert(meta.stats.skipped.header_footer === 2, 'header/footer blocks should be skipped')
  assert(meta.stats.kept_blocks === 4, `kept_blocks should be 4, got ${meta.stats.kept_blocks}`)
  assert(meta.stats.pages === 2, `pages should be 2, got ${meta.stats.pages}`)

  const { anchorCount } = verifyNormalized({ paperMd, anchors, meta })
  assert(anchorCount === EXPECTED_ANCHORS.length, 'anchor count after core verification')

  // ---- store + highlights round-trip ----
  await writePaper(root, paperId, { paperMd, anchors, meta })
  const rt = verifyHighlightsRoundTrip({
    root,
    paperId,
    makeSpans: (anchors, firstId, secondId) => [
      {
        id: 's-001', anchor: firstId, char_start: 0, char_end: 10, color: 'red',
        rationale: 'core claim', status: 'proposed',
        decisions: [{ action: 'proposed', by: 'agent', at: new Date().toISOString() }],
      },
      {
        id: 's-002', anchor: secondId, char_start: 5, char_end: 20, color: 'yellow',
        rationale: 'definition', status: 'accepted',
        decisions: [{ action: 'proposed', by: 'agent', at: new Date().toISOString() }],
      },
    ],
  })

  const anchorsOnDisk = await readAnchors(root, paperId)
  assert(anchorsOnDisk['a-0001-02-01'].text.includes('Skip-gram'), 'anchor text sanity on disk')

  const report = {
    step: 'mock',
    paperId,
    zip: zipPath,
    result: 'PASS',
    normalize: {
      anchors: EXPECTED_ANCHORS.length,
      kept_blocks: meta.stats.kept_blocks,
      pages: meta.stats.pages,
      skipped: meta.stats.skipped,
      paper_md_exact_match: true,
      md_offset_integrity: 'all anchors verified',
    },
    store: {
      files: ['paper.md', 'anchors.json', 'meta.json', 'paper.highlights.json'],
      highlights_round_trip: rt,
      negative_span_rejected: true,
    },
  }
  console.log(JSON.stringify(report, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
