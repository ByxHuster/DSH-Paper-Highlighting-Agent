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
const { summarizeDiff } = require('./diff')
const { buildExport, normalizeFormat, writeExport } = require('./export')
const {
  profileDir,
  profileExists,
  ensureProfile,
  readProfile,
  writeProfile,
  buildProfileSummary,
  applyProposal,
  readReflections,
  writeReflections,
  listPendingProposals,
} = require('./profile')

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
  return [parsePdfTool(), readHighlightsTool(), writeHighlightsTool(), listSectionsTool(), readSectionTool(), summarizeSectionDiffTool(), readProfileTool(), confirmProposalTool(), exportPaperTool()]
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

/** summarize_section_diff tool definition (Phase 4). */
function summarizeSectionDiffTool() {
  return {
    name: 'summarize_section_diff',
    description:
      'Summarize the review diff for one section (or the whole paper when section is omitted): for each span, ' +
      'classify the proposed→final trajectory from the decisions[] log (accepted / rejected / recolored / ' +
      'rescoped / noted / added / pending), aggregate counts + accept_rate, and return up to 3 sample spans ' +
      'per change kind. Powers the reflect skill — never hand-recount.',
    parameters: {
      paper_id: { type: 'string', required: true, description: 'Paper id (from parse_pdf)' },
      section: { type: 'string', description: 'Section id, e.g. "s3" (from list_sections). Omit for the whole paper.' },
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
      let spans = highlights.spans || []
      let scope = { kind: 'paper', section: null }
      if (args.section !== undefined && args.section !== null && args.section !== '') {
        const sec = sections.find((s) => s.id === args.section)
        if (!sec) {
          return {
            ok: false,
            paper_id: args.paper_id,
            error: `unknown section ${JSON.stringify(args.section)}; available: ${sections.map((s) => s.id).join(', ')}`,
          }
        }
        spans = spans.filter((s) => (sec.anchor_ids || []).includes(s.anchor))
        scope = { kind: 'section', section: { id: sec.id, title: sec.title, anchor_count: (sec.anchor_ids || []).length } }
      }
      const diff = summarizeDiff(spans)
      return Object.assign({ ok: true, paper_id: args.paper_id, scope }, diff)
    },
  }
}

/** read_profile tool definition (v0.3 Phase 0). */
function readProfileTool() {
  return {
    name: 'read_profile',
    description:
      'Read the user highlight profile (design §4.3): the four layers under <root>/highlight-profile/ ' +
      '(colors.yml / rules.json / exemplars.json / stats.json / reflection-notes.md) plus the compact ' +
      'propose-time summary (L1 colors + L2 top-k enabled rules + L3 top-k exemplars + one-line L4 stats) ' +
      'and the count of pending confirmation proposals across papers. When no profile exists yet (cold ' +
      'start), summary falls back to the built-in defaults so propose still works. Read-only.',
    parameters: {
      root: COMMON_ROOT,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: textRender,
    },
    async execute(args) {
      const root = path.resolve(args.root ?? defaultRoot())
      const has = await profileExists(root)
      let profile = null
      let summary = null
      if (has) {
        profile = await readProfile(root)
        summary = buildProfileSummary(profile)
      } else {
        summary = buildProfileSummary(null)
      }
      const pending = await listPendingProposals(root)
      return {
        ok: true,
        has_profile: has,
        profile_dir: profileDir(root),
        profile,
        summary,
        pending_proposals: pending.length,
      }
    },
  }
}

/** confirm_proposal tool definition (v0.3 Phase 0/2). */
function confirmProposalTool() {
  return {
    name: 'confirm_proposal',
    description:
      'Confirm (or reject) a pending profile-update proposal carried by data/<paper_id>/reflections.json ' +
      '(produced by the paper-hl-reflect skill). decisions: { accept: "all" | string[], reject: "all" | ' +
      'string[] } where ids are proposal-relative "rule-<i>" / "exemplar-<i>" (or a rule\'s own id). ' +
      'The HOST merges accepted items into the four-layer profile (low-confidence rules land disabled as ' +
      'candidates), records reflections.confirmation (append-only, one-shot — a second confirm is rejected), ' +
      'and returns the applied summary. The agent never writes rules directly (design §6 防污染).',
    parameters: {
      paper_id: { type: 'string', required: true, description: 'Paper id whose reflections.json proposal is being confirmed' },
      decisions: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description: '{ accept: "all" | string[], reject: "all" | string[] } — per-item or blanket confirmation',
      },
      root: COMMON_ROOT,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: textRender,
    },
    async execute(args) {
      const root = path.resolve(args.root ?? defaultRoot())
      const ref = await readReflections(root, args.paper_id)
      if (!ref) {
        return { ok: false, paper_id: args.paper_id, error: 'no reflections.json (no pending proposal) for this paper' }
      }
      if (ref.confirmation != null) {
        return { ok: false, paper_id: args.paper_id, error: 'proposal already confirmed (confirmation recorded, append-only)' }
      }
      const has = await profileExists(root)
      if (!has) await ensureProfile(root) // confirm implies cold-start defaults when needed
      const profile = await readProfile(root)
      let highlights = null
      try {
        highlights = await readHighlights(root, args.paper_id)
      } catch {
        highlights = null
      }
      const decisions = args.decisions || {}
      const result = applyProposal(profile, ref, decisions, highlights)
      await writeProfile(root, result.profile)
      const accepted = result.applied.rules + result.applied.exemplars > 0
      ref.confirmation = { accepted, at: new Date().toISOString(), decisions }
      await writeReflections(root, args.paper_id, ref)
      return {
        ok: true,
        paper_id: args.paper_id,
        applied: result.applied,
        confirmation: ref.confirmation,
      }
    },
  }
}

/** export_paper tool definition (v0.4 Phase 1, D7). */
function exportPaperTool() {
  return {
    name: 'export_paper',
    description:
      'Export the reviewed highlights of data/<paper_id>/paper.highlights.json as a self-contained ' +
      'HTML (<mark> + legend, inline CSS, no external resources) or Markdown document (D2/D3). ' +
      'Exported spans default to accepted + user_added (rejected never); include_pending=true also ' +
      'keeps proposed. format: html|md (default html). output: "inline" returns the content string ' +
      '(default) | "file" writes data/<paper_id>/export/<paper_id>.<ext> and returns the path. ' +
      'Colors come from the L1 profile (colors.yml) when present, built-in five otherwise.',
    parameters: {
      paper_id: { type: 'string', required: true, description: 'Paper id (from parse_pdf)' },
      format: { type: 'string', description: 'Export format: html|md (default html)' },
      include_pending: { type: 'boolean', description: 'Also export proposed (pending) spans (default false)' },
      output: { type: 'string', description: '"inline" returns content (default) | "file" writes data/<paper_id>/export/<paper_id>.<ext>' },
      root: COMMON_ROOT,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: textRender,
    },
    async execute(args) {
      const root = path.resolve(args.root ?? defaultRoot())
      let format
      try {
        format = normalizeFormat(args.format)
      } catch (err) {
        return { ok: false, paper_id: args.paper_id, error: String(err && err.message ? err.message : err) }
      }
      const includePending = args.include_pending === true || args.include_pending === '1' || args.include_pending === 'true'
      let highlights
      try {
        highlights = await readHighlights(root, args.paper_id)
      } catch (err) {
        return { ok: false, paper_id: args.paper_id, error: String(err && err.message ? err.message : err) }
      }
      const has = await profileExists(root)
      const colors = has ? (await readProfile(root)).colors : null
      const exported = buildExport({
        format,
        highlights,
        colors,
        include_pending: includePending,
        exported_at: new Date().toISOString(),
      })
      const base = {
        ok: true,
        paper_id: args.paper_id,
        format: exported.format,
        include_pending: includePending,
        title: exported.title,
        stats: exported.stats,
        output: 'inline',
        content: exported.content,
        file: null,
      }
      if (args.output === 'file') {
        const file = await writeExport(root, args.paper_id, format, exported.content)
        return {
          ...base,
          output: 'file',
          content: null,
          content_chars: exported.content.length,
          file,
        }
      }
      return base
    },
  }
}

module.exports = { defaultRoot, parsePdfTool, readHighlightsTool, writeHighlightsTool, listSectionsTool, readSectionTool, summarizeSectionDiffTool, readProfileTool, confirmProposalTool, exportPaperTool, allTools }
