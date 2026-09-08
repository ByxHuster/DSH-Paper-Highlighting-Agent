'use strict'

/**
 * Build a synthetic MinerU result zip for offline pipeline tests.
 * Mimics the v4 middle.json shape (pdf_info → pages → blocks → lines → spans)
 * including block types that normalize.js must skip.
 */

const fsp = require('node:fs/promises')
const path = require('node:path')
const { zipSync, strToU8 } = require('fflate')

// Fixed mtime makes buildMockZip deterministic: regenerating the committed
// fixture produces identical bytes, so running run-mock/run-tools no longer
// dirties git (fflate's default = current time → spurious diffs each run).
const FIXED_MTIME = new Date('2025-01-01T00:00:00Z')

const PAGE_W = 612
const PAGE_H = 792

function page(pageIdx, blocks) {
  return {
    page_idx: pageIdx,
    page_size: [PAGE_W, PAGE_H],
    blocks,
  }
}

function block(type, bbox, lines) {
  return { type, bbox, lines }
}

function line(spans) {
  return { bbox: [0, 0, 0, 0], spans: spans.map((t) => ({ type: 'text', bbox: [0, 0, 0, 0], text: t })) }
}

/** v0.6.4: image span carrying a zip-relative raster reference. */
function lineImg(imagePath) {
  return { bbox: [0, 0, 0, 0], spans: [{ type: 'image', bbox: [0, 0, 0, 0], image_path: imagePath }] }
}

/** v0.6.4: nested container (image/table/chart → body/caption sub-blocks). */
function container(type, bbox, blocks) {
  return { type, bbox, blocks }
}

function middleJson() {
  return {
    pdf_info: [
      page(0, [
        // page 1
        block('title', [72, 60, 540, 90], [
          line(['Distributed Representations of Words and Phrases and their Compositionality']),
        ]),
        block('text', [72, 120, 540, 200], [
          line(['We present several improvements over the Skip-gram model']),
          line(['including subsampling of frequent words and negative sampling.']),
        ]),
        // v0.6.4: nested image container — body (raster ref) + caption.
        container('image', [72, 220, 300, 340], [
          block('image_body', [72, 220, 300, 340], [lineImg('mock-fig.jpg')]),
          block('image_caption', [72, 350, 540, 370], [line(['Figure 1: mock figure'])]),
        ]),
        block('table', [320, 220, 540, 300], [line(['table row one']), line(['table row two'])]),
        block('formula', [72, 360, 300, 380], [line(['E = argmax log p(w|context)'])]),
      ]),
      page(1, [
        // page 2
        block('text', [72, 30, 540, 50], [line(['Running header: Advances in Neural Information Processing Systems'])]),
        block('text', [72, 100, 540, 160], [
          line(['The main contribution of this paper is a method that learns high-quality']),
          line(['vector representations of words from large amounts of text.']),
        ]),
        block('text', [72, 760, 540, 780], [line(['Running footer: 26th Conference on Neural Information Processing Systems'])]),
        block('text', [72, 300, 540, 340], [line(['Future work includes training on even larger corpora.'])]),
      ]),
    ],
  }
}

async function buildMockZip(zipPath) {
  const middle = middleJson()
  // fflate zipSync top level is a name → file map; each value may be a
  // [data, opts] tuple. Pinned mtime → deterministic output.
  const files = {
    'mock-paper.middle.json': [strToU8(JSON.stringify(middle, null, 1)), { mtime: FIXED_MTIME }],
    'mock-paper.md': [strToU8('# Mock paper markdown (not used by normalize)\n\nBody.\n'), { mtime: FIXED_MTIME }],
    'images/': [strToU8(''), { mtime: FIXED_MTIME }],
    // v0.6.4: a fake JPEG raster referenced by the nested image_body above.
    'images/mock-fig.jpg': [strToU8('FAKEJPEG-DATA'), { mtime: FIXED_MTIME }],
  }
  const zipped = zipSync(files, { level: 6 })
  await fsp.mkdir(path.dirname(zipPath), { recursive: true })
  await fsp.writeFile(zipPath, zipped)
  return zipPath
}

module.exports = { buildMockZip, middleJson }
