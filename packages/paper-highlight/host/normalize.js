'use strict'

/**
 * paper-highlight · MinerU zip → paper.md + anchors.json + meta.json (design §4.1)
 *
 * Source of truth is the MinerU middle JSON (page/block/line structure). We
 * rebuild paper.md ourselves from the kept blocks so that every anchor's text
 * appears in paper.md verbatim at a recorded md_offset — the anchor contract
 * holds by construction (design §3.2: anchors never point at the DOM).
 *
 * v0.1 rules (documented simplifications, refined in v0.2+):
 *   - keep block types: text / title / content / formula; skip image, table,
 *     captions, headers/footers, and anything unrecognized
 *   - v0.6.2: display-formula blocks (interline_equation / formula) are KEPT
 *     as ordinary anchors (type preserved) — their LaTeX source renders through
 *     the client's KaTeX engine (design §4.1, D3); MinerU emits these with
 *     enable_formula on (MINERU_FORMULA !== '0'), previously discarded
 *   - header/footer heuristic: text blocks whose bbox lies within the top or
 *     bottom `marginRatio` of the page are skipped (counted for sampling)
 *   - one paragraph (= one anchor) per kept block
 *   - title blocks render as headings (first title → h1, rest → h2)
 */

const fsp = require('node:fs/promises')
const path = require('node:path')
const { unzipSync } = require('fflate')

const { anchorId, validateAnchors } = require('./schema')

// v0.6.3: keep display formulas (v0.6.2) AND tables + figure/table captions.
// Tables arrive as full HTML (MinerU table recognition); captions are plain
// text. Image/chart *bodies* stay skipped (binary — a separate milestone).
const KEEP_TYPES = new Set([
  'text', 'title', 'content',
  'interline_equation', 'formula',
  'table', 'table_body', 'table_caption',
  'image_caption', 'chart_caption',
])
const SKIP_TYPES = new Set([
  'image', 'figure', 'figure_caption', 'chart',
  'image_body', 'chart_body', 'table_footnote', 'formula_caption',
  'page_header', 'page_footer', 'page_margin', 'abandon',
  'footnote', 'reference', 'algorithm',
  // observed in real MinerU v4 output (layout.json):
  'ref_text', 'aside_text', 'page_number', 'page_footnote',
])

/** Collapse whitespace runs to single spaces and trim. */
function cleanText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

/** Tolerant span text extraction. */
function spanText(span) {
  const t = span.text ?? span.content ?? span.txt ?? ''
  return cleanText(t)
}

/** Tolerant line text extraction: join span texts, collapse whitespace. */
function lineText(line) {
  const spans = Array.isArray(line.spans) ? line.spans : []
  const parts = spans.map(spanText).filter(Boolean)
  if (parts.length > 0) return parts.join(' ').replace(/\s+/g, ' ').trim()
  const direct = line.text ?? line.content ?? ''
  return cleanText(direct)
}

/** First span-level `html` found (MinerU table recognition output). */
function collectHtml(lines) {
  for (const line of Array.isArray(lines) ? lines : []) {
    for (const span of Array.isArray(line.spans) ? line.spans : []) {
      if (typeof span.html === 'string' && span.html.trim().length > 0) return span.html.trim()
    }
  }
  return null
}

/**
 * v0.6.3: degrade a MinerU table HTML to a readable one-line-per-row plain
 * text (cells joined with " | ") — this is what lands in paper.md / anchors
 * (md_offset contract, propose readability); the raw HTML is kept on the
 * anchor as `html` for the client's real-table rendering.
 */
function htmlToPlain(html) {
  return String(html || '')
    .replace(/<table[^>]*>/gi, '')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '')
    .replace(/<t[dh][^>]*>/gi, '')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]*\|[ \t]*/g, ' | ')
    .split('\n')
    .map((l) => l.replace(/(^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$)/g, '').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Tolerant block bbox. */
function blockBbox(block) {
  const b = Array.isArray(block.bbox) && block.bbox.length >= 4 ? block.bbox : null
  if (b) return { x0: b[0], y0: b[1], x1: b[2], y1: b[3] }
  return null
}

function parseMiddleJson(entries) {
  const jsonNames = Object.keys(entries).filter((n) => /\.json$/i.test(n))
  if (jsonNames.length === 0) throw new Error('MinerU zip contains no .json file')
  // Prefer middle.json (v3) or layout.json (v4), else the largest json.
  const preferred = jsonNames.find((n) => /middle\.json$/i.test(n)) ?? jsonNames.find((n) => /^layout\.json$/i.test(n))
  const name = preferred ?? jsonNames.sort((a, b) => entries[b].length - entries[a].length)[0]
  const text = Buffer.from(entries[name]).toString('utf8')
  const data = JSON.parse(text)
  return { name, data }
}

/**
 * Walk the middle JSON into a flat list of { page, blockIdx, type, bbox, lines[] }
 * in reading order. Real MinerU v4 layout.json pages expose `para_blocks`
 * (preferred paragraph-merged view) and `preproc_blocks` (raw layout blocks);
 * older shapes use `pdf_info`/`pages` with `blocks`. discarded_blocks
 * (aside_text/page_number/footnotes) are intentionally not walked.
 *
 * v0.1 simplification: MinerU's emitted block order IS the reading order
 * (it is column-aware; a naive bbox y/x sort mis-orders multi-column pages,
 * e.g. the two-column author block on the title page). The real-data test
 * guards the "id order == paper.md order" contract for future papers.
 */
function walkPages(middle) {
  const pages =
    Array.isArray(middle.pdf_info) ? middle.pdf_info :
    Array.isArray(middle.pages) ? middle.pages :
    Array.isArray(middle) ? middle : []
  const out = []
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi] ?? {}
    const pageIdx = Number.isInteger(page.page_idx) ? page.page_idx : pi
    const pageH = Array.isArray(page.page_size) && page.page_size[1] ? page.page_size[1] : 1
    const blocks = Array.isArray(page.para_blocks) ? page.para_blocks
      : Array.isArray(page.preproc_blocks) ? page.preproc_blocks
      : Array.isArray(page.blocks) ? page.blocks
      : []
    // v0.6.3: MinerU wraps image/table/chart content in container blocks whose
    // payload lives in `blocks[]` (image_body/table_body/captions). Expand the
    // containers into their sub-blocks (reading order), flattening with a
    // per-page counter so every kept item gets a unique block number.
    let flat = 0
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi]
      const bbox = blockBbox(block)
      if (bbox === null) continue
      const type = typeof block.type === 'string' ? block.type.toLowerCase() : 'text'
      if (Array.isArray(block.blocks) && block.blocks.length > 0) {
        for (const sub of block.blocks) {
          const subBbox = blockBbox(sub)
          if (subBbox === null) continue
          const subType = typeof sub.type === 'string' ? sub.type.toLowerCase() : 'text'
          out.push({ pageIdx, pageH, bi: flat++, type: subType, bbox: subBbox, lines: Array.isArray(sub.lines) ? sub.lines : [] })
        }
        continue
      }
      out.push({ pageIdx, pageH, bi: flat++, type, bbox, lines: Array.isArray(block.lines) ? block.lines : [] })
    }
  }
  return out
}

/**
 * Normalize a downloaded MinerU zip into paper artifacts.
 * @param {object} opts { zipPath, paperId, title, sourcePdf, mineruTask, marginRatio=0.05 }
 * @returns {Promise<{paperMd: string, anchors: object, meta: object}>}
 */
async function normalizeMineruZip(opts) {
  const marginRatio = opts.marginRatio ?? 0.05
  const zipBuf = await fsp.readFile(opts.zipPath)
  const entries = unzipSync(new Uint8Array(zipBuf))
  const { name: jsonName, data: middle } = parseMiddleJson(entries)

  const blocks = walkPages(middle)

  const paragraphs = [] // { page, block, par, type, text, mdOffset }
  const skippedByType = {}
  let skippedHeaderFooter = 0
  let md = ''
  let firstTitleDone = false

  for (const b of blocks) {
    const { pageIdx, pageH, bi, type, bbox, lines } = b
    let reason = null
    if (KEEP_TYPES.has(type)) {
      // v0.6.2: display formulas are never header/footer noise — keep them
      // regardless of bbox; the heuristic applies only to text-ish blocks.
      if (type !== 'interline_equation' && type !== 'formula') {
        const top = bbox.y0 / pageH
        const bottom = 1 - bbox.y1 / pageH
        if (top < marginRatio || bottom < marginRatio) reason = 'header_footer'
      }
    } else if (SKIP_TYPES.has(type)) {
      reason = type
    } else {
      reason = `unknown:${type}`
    }
    if (reason) {
      skippedByType[reason] = (skippedByType[reason] ?? 0) + 1
      if (reason === 'header_footer') skippedHeaderFooter++
      continue
    }

    let text = lines.map(lineText).filter(Boolean).join(' ')
    // v0.6.3: table blocks — MinerU emits full HTML (table recognition); the
    // anchor text is the readable plain-text degradation (md_offset contract /
    // propose readability), the raw HTML rides along as `html` for the
    // client's real-table rendering.
    let html = null
    if (type === 'table' || type === 'table_body') {
      html = collectHtml(lines)
      if (html) {
        const plain = htmlToPlain(html)
        if (plain.length > 0) text = plain
      }
    }
    if (!text) {
      skippedByType['empty'] = (skippedByType['empty'] ?? 0) + 1
      continue
    }

    let rendered
    if (type === 'title') {
      const level = firstTitleDone ? 2 : 1
      firstTitleDone = true
      rendered = `${'#'.repeat(level)} ${text}`
    } else {
      rendered = text
    }

    // md_offset points at the anchor text itself, skipping the heading prefix.
    const prefixLen = rendered.length - text.length
    const mdOffset = md.length + prefixLen
    paragraphs.push({
      page: pageIdx + 1,
      block: bi + 1,
      par: 1,
      type,
      text,
      mdOffset,
      rendered,
      ...(html ? { html } : {}),
    })
    md += rendered + '\n\n'
  }

  const anchors = {}
  for (const p of paragraphs) {
    anchors[anchorId(p.page, p.block, p.par)] = {
      page: p.page,
      block: p.block,
      par: p.par,
      type: p.type,
      text: p.text,
      md_offset: p.mdOffset,
      ...(p.html ? { html: p.html } : {}),
    }
  }
  validateAnchors(anchors)

  const paperMd = md.trimEnd() + '\n'
  const meta = {
    id: opts.paperId,
    title: opts.title ?? '',
    source_pdf: opts.sourcePdf ?? '',
    mineru_task: opts.mineruTask ?? '',
    middle_json: jsonName,
    created_at: new Date().toISOString(),
    stats: {
      pages: new Set(paragraphs.map((p) => p.page)).size,
      kept_blocks: paragraphs.length,
      kept_chars: paragraphs.reduce((n, p) => n + p.text.length, 0),
      skipped: { by_type: skippedByType, header_footer: skippedHeaderFooter },
    },
  }
  return { paperMd, anchors, meta }
}

module.exports = {
  KEEP_TYPES,
  SKIP_TYPES,
  cleanText,
  lineText,
  collectHtml,
  htmlToPlain,
  walkPages,
  normalizeMineruZip,
}
