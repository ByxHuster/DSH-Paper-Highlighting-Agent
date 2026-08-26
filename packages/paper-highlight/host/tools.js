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
  return [parsePdfTool(), readHighlightsTool(), writeHighlightsTool()]
}

module.exports = { defaultRoot, parsePdfTool, readHighlightsTool, writeHighlightsTool, allTools }
