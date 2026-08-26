'use strict'

/**
 * Real end-to-end verification: MinerU cloud API → normalize → store.
 * Requires MINERU_API (or MinerU_API) in the environment and network access.
 *
 * Run:  node test/run-real.js [path-to-pdf]
 */

const path = require('node:path')

const { processPdf } = require('../host/pipeline')
const { resolveMineruConfig } = require('../host/mineru')
const { writeHighlights } = require('../host/store')
const { newHighlightsSkeleton } = require('../host/schema')
const { verifyNormalized, verifyHighlightsRoundTrip } = require('./verify')
const { assert } = require('./verify')

const DEFAULT_PDF = path.join(__dirname, '..', '..', '..', 'Mikolov 等 - 2013 - 2013.1 Word2Vec.pdf')
const ROOT = path.join(__dirname, '..', '..', '..') // D:\aa

async function main() {
  const pdfPath = process.argv[2] || DEFAULT_PDF
  const cfg = resolveMineruConfig() // throws NO_API_KEY when missing
  console.log(JSON.stringify({ step: 'real', pdfPath, baseUrl: cfg.baseUrl, uploadMode: cfg.uploadMode, isOcr: cfg.isOcr }, null, 2))

  const started = Date.now()
  const { batchId, zipPath, workDir, dir, paperId, paperMd, anchors, meta } = await processPdf({
    pdfPath,
    root: ROOT,
    mineruConfig: cfg,
    onProgress: (d) => console.log(`  poll: state=${d.state} pages=${d.extract_progress ? d.extract_progress.extracted_pages + '/' + d.extract_progress.total_pages : '?'}`),
  })

  const { anchorCount } = verifyNormalized({ paperMd, anchors, meta })
  assert(anchorCount > 10, `real parse produced only ${anchorCount} anchors`)

  const rt = verifyHighlightsRoundTrip({
    root: ROOT,
    paperId,
    makeSpans: (anchors, firstId, secondId) => [
      {
        id: 's-001', anchor: firstId, char_start: 0, char_end: Math.min(40, anchors[firstId].text.length),
        color: 'red', rationale: 'verification span 1', status: 'proposed',
        decisions: [{ action: 'proposed', by: 'agent', at: new Date().toISOString() }],
      },
      {
        id: 's-002', anchor: secondId, char_start: 0, char_end: Math.min(30, anchors[secondId].text.length),
        color: 'yellow', rationale: 'verification span 2', status: 'accepted',
        decisions: [{ action: 'proposed', by: 'agent', at: new Date().toISOString() }],
      },
    ],
  })

  // Leave a clean highlights skeleton behind (verification spans were only a test).
  const clean = newHighlightsSkeleton({ id: paperId, title: meta.title, sourcePdf: meta.source_pdf, mineruTask: batchId })
  clean.anchors = anchors
  await writeHighlights(ROOT, paperId, clean)

  const report = {
    step: 'real',
    result: 'PASS',
    paperId,
    batchId,
    elapsedMs: Date.now() - started,
    dir,
    zipPath,
    stats: meta.stats,
    paper_md_chars: paperMd.length,
    anchor_count: anchorCount,
    first_anchor: anchors[Object.keys(anchors)[0]],
    highlights_round_trip: rt,
    final_highlights_state: 'clean skeleton (no spans)',
  }
  console.log(JSON.stringify(report, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('REAL TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
