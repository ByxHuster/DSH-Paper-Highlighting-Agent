'use strict'

/**
 * paper-highlight · agent tool definitions (design §3.1 / v0.1 scope)
 *
 * Three model-facing tools over the pipeline + store:
 *   parse_pdf        MinerU 解析 → data/<paper_id>/ 归一化产物
 *   read_highlights  读取 paper.highlights.json
 *   write_highlights 校验并写入 paper.highlights.json
 *
 * ToolDefinition options are passed through `defineTool` by the ESM plugin
 * wrapper (host/tools-plugin.mjs). Pure CJS here so the logic is testable
 * without the harness.
 */

const path = require('node:path')

const { processPdf, paperIdFromPdfPath } = require('./pipeline')
const { readHighlights, writeHighlights, readPaperMd, readAnchors, readMeta, paperDir } = require('./store')
const { buildSections } = require('./sections')

/** Default data root: the process cwd (dsh launched from the workspace root). */
function defaultRoot() {
  return process.cwd()
}

function textRender(_args, value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

const COMMON_ROOT = { type: 'string', description: 'Workspace root holding the data/ directory (default: process cwd)' }

/** parse_pdf tool definition. */
function parsePdfTool() {
  return {
    name: 'parse_pdf',
    description:
      'Parse a local conference-paper PDF with the MinerU cloud API and normalize it into ' +
      'data/<paper_id>/{paper.md, anchors.json, meta.json, paper.highlights.json}. ' +
      'Requires MINERU_API to be configured. Returns the paper id and normalization stats.',
    parameters: {
      pdf_path: { type: 'string', required: true, description: 'Absolute path to the PDF file' },
      paper_id: { type: 'string', description: 'Stable paper id (default: derived from the PDF filename)' },
      title: { type: 'string', description: 'Paper title recorded in meta.json' },
      root: COMMON_ROOT,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: textRender,
    },
    async execute(args) {
      const root = path.resolve(args.root ?? defaultRoot())
      const result = await processPdf({
        pdfPath: path.resolve(args.pdf_path),
        root,
        paperId: args.paper_id,
        title: args.title,
      })
      // NB: tool output must be lossless JSON (dsh-tools rejects undefined /
      // NaN / BigInt values with ToolOutputError INVALID_TOOL_OUTPUT). The
      // pipeline returns `batchId` (no `taskId` property) — map it explicitly.
      return {
        ok: true,
        paper_id: result.paperId,
        task_id: result.batchId ?? null,
        data_dir: result.dir,
        anchor_count: Object.keys(result.anchors).length,
        paper_md_chars: result.paperMd.length,
        stats: result.meta.stats,
        files: ['paper.md', 'anchors.json', 'meta.json', 'paper.highlights.json'],
      }
    },
  }
}

/** read_highlights tool definition. */
function readHighlightsTool() {
  return {
    name: 'read_highlights',
    description:
      'Read data/<paper_id>/paper.highlights.json (design §4.2): paper meta, the anchors map, ' +
      'the section plan, all spans with status/decisions, and duplicates. ' +
      'Use read_file on paper.md / anchors.json when the raw text is needed.',
    parameters: {
      paper_id: { type: 'string', required: true, description: 'Paper id (from parse_pdf)' },
      root: COMMON_ROOT,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: textRender,
    },
    async execute(args) {
      const root = path.resolve(args.root ?? defaultRoot())
      const highlights = await readHighlights(root, args.paper_id)
      return {
        ok: true,
        paper_id: args.paper_id,
        data_dir: paperDir(root, args.paper_id),
        spans: highlights.spans.length,
        highlights,
      }
    },
  }
}

/** write_highlights tool definition. */
function writeHighlightsTool() {
  return {
    name: 'write_highlights',
    description:
      'Validate and write data/<paper_id>/paper.highlights.json. The document must satisfy the ' +
      '§4.2 schema: spans reference existing anchors with 0-based half-open char ranges into the ' +
      'anchor text, status in proposed|accepted|rejected|user_added, decisions append-only. ' +
      'Pass the full document (start from read_highlights output).',
    parameters: {
      paper_id: { type: 'string', required: true, description: 'Paper id (from parse_pdf)' },
      highlights: { type: 'object', additionalProperties: true, required: true, description: 'The complete highlights document to persist' },
      root: COMMON_ROOT,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: textRender,
    },
    async execute(args) {
      const root = path.resolve(args.root ?? defaultRoot())
      const written = await writeHighlights(root, args.paper_id, args.highlights)
      return {
        ok: true,
        paper_id: args.paper_id,
        spans: written.spans.length,
        written_at: new Date().toISOString(),
      }
    },
  }
}

/** All tool definitions in registration order. */
function allTools() {
  return [parsePdfTool(), readHighlightsTool(), writeHighlightsTool(), listSectionsTool(), readSectionTool()]
}

/** Shared read of highlights + paperMd + anchors for the section tools. */
async function readPaperContext(root, paperId) {
  const [highlights, paperMd, anchors] = await Promise.all([
    readHighlights(root, paperId),
    readPaperMd(root, paperId),
    readAnchors(root, paperId),
  ])
  return { highlights, paperMd, anchors }
}

/** list_sections tool definition (Phase 3). */
function listSectionsTool() {
  return {
    name: 'list_sections',
    description:
      'List the paper section index (design §4.2 plan / sections.js): every section with id, title, level, ' +
      'kind (paper_title|section), empty flag, anchor/span counts, and the merged plan entry ' +
      '(status/skip/expected_colors/density_hint). Use read_section to fetch one section body text.',
    parameters: {
      paper_id: { type: 'string', required: true, description: 'Paper id (from parse_pdf)' },
      root: COMMON_ROOT,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: textRender,
    },
    async execute(args) {
      const root = path.resolve(args.root ?? defaultRoot())
      const { highlights, paperMd, anchors } = await readPaperContext(root, args.paper_id)
      const sections = buildSections({ paperMd, anchors })
      const planById = new Map((highlights.plan.sections || []).map((s) => [s.id, s]))
      const spanCountByAnchor = {}
      for (const s of highlights.spans) spanCountByAnchor[s.anchor] = (spanCountByAnchor[s.anchor] || 0) + 1
      const list = sections.map((sec) => {
        const plan = planById.get(sec.id)
        const spanCount = (sec.anchor_ids || []).reduce((n, a) => n + (spanCountByAnchor[a] || 0), 0)
        return {
          id: sec.id,
          title: sec.title,
          level: sec.level,
          kind: sec.kind,
          empty: sec.empty,
          anchor_id: sec.anchor_id,
          anchor_count: (sec.anchor_ids || []).length,
          span_count: spanCount,
          status: (plan && plan.status) || 'pending',
          skip: (plan && plan.skip) || false,
          expected_colors: (plan && plan.expected_colors) || [],
          density_hint: (plan && plan.density_hint) || '',
          section: (plan && plan.section) || sec.title,
        }
      })
      return {
        ok: true,
        paper_id: args.paper_id,
        total: list.length,
        reviewable: list.filter((s) => s.kind !== 'paper_title' && !s.empty).length,
        sections: list,
      }
    },
  }
}

/** read_section tool definition (Phase 3). */
function readSectionTool() {
  return {
    name: 'read_section',
    description:
      'Read one paper section by id (e.g. "s3", from list_sections): the section body text (anchor texts ' +
      'concatenated in reading order), its plan entry, and the spans already inside it. This is the propose ' +
      'input. Unknown section ids return ok:false with the available ids.',
    parameters: {
      paper_id: { type: 'string', required: true, description: 'Paper id (from parse_pdf)' },
      section: { type: 'string', required: true, description: 'Section id, e.g. "s3" (from list_sections)' },
      root: COMMON_ROOT,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: textRender,
    },
    async execute(args) {
      const root = path.resolve(args.root ?? defaultRoot())
      const { highlights, paperMd, anchors } = await readPaperContext(root, args.paper_id)
      const sections = buildSections({ paperMd, anchors })
      const sec = sections.find((s) => s.id === args.section)
      if (!sec) {
        return {
          ok: false,
          paper_id: args.paper_id,
          error: `unknown section ${JSON.stringify(args.section)}; available: ${sections.map((s) => s.id).join(', ')}`,
        }
      }
      const text = (sec.anchor_ids || []).map((aid) => anchors[aid].text).join('\n')
      const plan = (highlights.plan.sections || []).find((p) => p.id === sec.id) || null
      const spans = highlights.spans
        .filter((s) => (sec.anchor_ids || []).includes(s.anchor))
        .map((s) => ({
          id: s.id,
          anchor: s.anchor,
          char_start: s.char_start,
          char_end: s.char_end,
          color: s.color,
          rationale: s.rationale,
          status: s.status,
          note: s.note || null,
        }))
      return {
        ok: true,
        paper_id: args.paper_id,
        section: {
          id: sec.id,
          title: sec.title,
          level: sec.level,
          kind: sec.kind,
          empty: sec.empty,
          anchor_id: sec.anchor_id,
          anchor_count: (sec.anchor_ids || []).length,
        },
        char_count: text.length,
        text,
        plan,
        spans,
      }
    },
  }
}

module.exports = { defaultRoot, parsePdfTool, readHighlightsTool, writeHighlightsTool, listSectionsTool, readSectionTool, allTools }
