'use strict'

/**
 * paper-highlight · export (v0.4 Phase 0)
 *
 * Pure export renderers: highlights + anchors + L1 colors → self-contained
 * highlighted HTML / Markdown. Locked decisions (v0.4 D2 / D3):
 *   - The body is REBUILT from anchors in reading order (the same source the
 *     GUI uses — client/render-body.js renderText/buildBlockSegments), so the
 *     export is exactly what the user saw in the browser (所见即所得). We do
 *     NOT inject <mark> into paper.md: that depends on md_offset /
 *     normalization consistency, and the GUI never renders raw Markdown
 *     anyway (the alternative was rejected in the v0.4 plan).
 *   - HTML output is self-contained: inline CSS, no external resources, no JS.
 *   - Legend + mark colors are driven by the L1 profile colors (colors.yml);
 *     missing / empty / partial maps fall back to the built-in five (aligned
 *     with client colorLegend fallback).
 *   - Export span set: accepted + user_added by default; proposed only when
 *     include_pending=true; rejected never (aligned with GUI excludeRejected).
 *
 * Zero external dependencies (node builtins + ./store atomic write) so it
 * resolves cleanly through the profile junction tree.
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const { paperDir, atomicWriteText } = require('./store')

const DEFAULT_COLORS = {
  red: { color: '#ff9c94', label: '核心洞见/贡献' },
  yellow: { color: '#fff3a0', label: '关键定义/方法' },
  blue: { color: '#8fd0f7', label: '局限/风险' },
  green: { color: '#b0e3a8', label: '可借鉴/启发' },
  purple: { color: '#d9b8f2', label: '待深挖/存疑' },
}

/** Reading order comparator (page, block, par) — same as sections.js / client. */
function cmpAnchor(a, b) {
  return (a.page || 0) - (b.page || 0) || (a.block || 0) - (b.block || 0) || (a.par || 0) - (b.par || 0)
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Resolve the L1 color map (name → {color,label}); null/empty/partial → built-in five. */
function resolveColors(colors) {
  const src = colors && typeof colors === 'object' && !Array.isArray(colors) ? colors : null
  const names = src && Object.keys(src).length ? Object.keys(src) : Object.keys(DEFAULT_COLORS)
  const out = {}
  for (const name of names) {
    const c = src && src[name]
    out[name] = {
      color: (c && c.color) || (DEFAULT_COLORS[name] && DEFAULT_COLORS[name].color) || '#cccccc',
      label: (c && c.label) || (DEFAULT_COLORS[name] && DEFAULT_COLORS[name].label) || name,
    }
  }
  return out
}

/**
 * Filter + normalize exportable spans (D3).
 * Default keeps accepted + user_added; include_pending also keeps proposed;
 * rejected is never exported. Ranges are clamped to the anchor text; spans
 * with empty ranges or unknown anchors are skipped.
 * @returns {Array<{id, anchor, char_start, char_end, color, rationale, status, text}>}
 */
function buildExportSpans(highlights, opts = {}) {
  const includePending = !!(opts && opts.include_pending)
  const anchors = (highlights && highlights.anchors) || {}
  const spans = highlights && Array.isArray(highlights.spans) ? highlights.spans : []
  const out = []
  for (const s of spans) {
    if (!s || typeof s !== 'object') continue
    const status = s.status || 'proposed'
    if (status === 'rejected') continue
    if (!includePending && status !== 'accepted' && status !== 'user_added') continue
    const a = anchors[s.anchor]
    if (!a || typeof a.text !== 'string') continue
    const len = a.text.length
    const start = Math.max(0, Math.min(Number.isInteger(s.char_start) ? s.char_start : 0, len))
    const end = Math.max(start, Math.min(Number.isInteger(s.char_end) ? s.char_end : 0, len))
    if (end <= start) continue
    out.push({
      id: s.id,
      anchor: s.anchor,
      char_start: start,
      char_end: end,
      color: typeof s.color === 'string' && s.color ? s.color : 'yellow',
      rationale: typeof s.rationale === 'string' ? s.rationale : '',
      status,
      text: a.text.slice(start, end),
    })
  }
  return out
}

/** Group exportable spans by anchor; per-anchor sort by char_start. */
function spansByAnchor(spans) {
  const map = {}
  for (const s of spans) {
    const list = map[s.anchor] || (map[s.anchor] = [])
    list.push(s)
  }
  for (const key of Object.keys(map)) map[key].sort((a, b) => a.char_start - b.char_start)
  return map
}

/** Split one anchor's text into [{text, span|null}] segments (plain vs highlighted). */
function anchorSegments(text, spans) {
  const segs = []
  let pos = 0
  for (const s of spans || []) {
    const start = Math.max(0, Math.min(s.char_start, text.length))
    const end = Math.max(start, Math.min(s.char_end, text.length))
    if (start > pos) segs.push({ text: text.slice(pos, start), span: null })
    if (end > start) segs.push({ text: text.slice(start, end), span: s })
    pos = Math.max(pos, end)
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), span: null })
  return segs
}

/** Export statistics: exported mark count + total highlighted chars. */
function computeExportStats(spans) {
  return {
    exported_marks: spans.length,
    chars: spans.reduce((n, s) => n + s.text.length, 0),
  }
}

/** Legend HTML block driven by the resolved L1 palette. */
function legendHtml(palette) {
  const items = Object.entries(palette).map(([name, c]) => {
    return `<span class="phl-legend-item"><span class="phl-legend-swatch" style="background:${c.color}"></span>${name} · ${escapeHtml(c.label)}</span>`
  })
  return `<section class="phl-legend">\n${items.join('\n')}\n</section>`
}

/** Legend Markdown block driven by the resolved L1 palette. */
function legendMd(palette) {
  const lines = ['## 图例', '']
  for (const [name, c] of Object.entries(palette)) {
    lines.push(`- **${name}** · ${c.label}`)
  }
  lines.push('', '---', '')
  return lines.join('\n')
}

/** Render the body paragraphs (anchors in reading order) as HTML with <mark>. */
function renderBodyHtml(anchors, spans, palette) {
  const byAnchor = spansByAnchor(spans)
  const ids = Object.keys(anchors || {}).sort((x, y) => cmpAnchor(anchors[x], anchors[y]))
  const paras = []
  for (const id of ids) {
    const text = (anchors[id] && anchors[id].text) || ''
    const segs = anchorSegments(text, byAnchor[id] || [])
    let html = ''
    for (const seg of segs) {
      if (seg.span) {
        const cls = seg.span.color && palette[seg.span.color] ? `hl-${seg.span.color}` : 'hl-unknown'
        const title = seg.span.rationale ? ` title="${escapeHtml(seg.span.rationale)}"` : ''
        html += `<mark class="${cls}"${title}>${escapeHtml(seg.text)}</mark>`
      } else {
        html += escapeHtml(seg.text)
      }
    }
    paras.push(`<p>${html}</p>`)
  }
  return paras.join('\n')
}

/** Inline CSS for the self-contained HTML (mark colors driven by the palette). */
function styleHtml(palette) {
  const markRules = Object.entries(palette)
    .map(([name, c]) => `  mark.hl-${name} { background-color: ${c.color}; }`)
    .join('\n')
  return [
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; max-width: 880px; margin: 0 auto; padding: 28px 24px 96px; color: #1a1a1a; line-height: 1.75; }',
    '.phl-export-header h1 { font-size: 1.55em; margin: 0 0 6px; line-height: 1.35; }',
    '.phl-export-meta { color: #666; font-size: .85em; margin: 0 0 18px; }',
    '.phl-legend { display: flex; flex-wrap: wrap; gap: 12px 18px; padding: 12px 16px; border: 1px solid #e3e3e3; border-radius: 8px; margin: 0 0 26px; background: #fafafa; }',
    '.phl-legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: .85em; }',
    '.phl-legend-swatch { width: 14px; height: 14px; border-radius: 3px; display: inline-block; flex: none; }',
    '.phl-export-body p { margin: 0 0 12px; }',
    'mark.hl-unknown { background-color: #e6e6e6; border-radius: 2px; padding: 0 1px; }',
    markRules,
  ].join('\n')
}

/**
 * Self-contained highlighted HTML document (D2).
 * @param {object} opts { highlights, colors?, include_pending?, exported_at? }
 */
function renderHtml(opts = {}) {
  const highlights = opts.highlights || {}
  const spans = buildExportSpans(highlights, { include_pending: opts.include_pending })
  const palette = resolveColors(opts.colors)
  const stats = computeExportStats(spans)
  const paper = highlights.paper || {}
  const title = paper.title || ''
  const pid = paper.id || ''
  const at = opts.exported_at || new Date().toISOString()
  const body = renderBodyHtml(highlights.anchors, spans, palette)
  return [
    '<!DOCTYPE html>',
    '<html lang="zh">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title || pid || '论文高亮')}</title>`,
    `<style>\n${styleHtml(palette)}\n</style>`,
    '</head>',
    '<body>',
    '<header class="phl-export-header">',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="phl-export-meta">paper_id: ${escapeHtml(pid)} · 导出时间 ${escapeHtml(at)} · 高亮 ${stats.exported_marks} 处 / ${stats.chars} 字符</p>`,
    '</header>',
    legendHtml(palette),
    `<main class="phl-export-body">\n${body}\n</main>`,
    '</body>',
    '</html>',
  ].join('\n')
}

/** Markdown document with inline <mark> highlights (GFM / VS Code preview compatible). */
function renderMarkdown(opts = {}) {
  const highlights = opts.highlights || {}
  const spans = buildExportSpans(highlights, { include_pending: opts.include_pending })
  const palette = resolveColors(opts.colors)
  const stats = computeExportStats(spans)
  const paper = highlights.paper || {}
  const title = paper.title || ''
  const pid = paper.id || ''
  const at = opts.exported_at || new Date().toISOString()
  const byAnchor = spansByAnchor(spans)
  const ids = Object.keys(highlights.anchors || {}).sort((x, y) => cmpAnchor(highlights.anchors[x], highlights.anchors[y]))
  const paras = []
  for (const id of ids) {
    const text = (highlights.anchors[id] && highlights.anchors[id].text) || ''
    const segs = anchorSegments(text, byAnchor[id] || [])
    let md = ''
    for (const seg of segs) {
      if (seg.span) {
        const cls = seg.span.color && palette[seg.span.color] ? `hl-${seg.span.color}` : 'hl-unknown'
        md += `<mark class="${cls}">${seg.text}</mark>`
      } else {
        md += seg.text
      }
    }
    paras.push(md)
  }
  const lines = [`# ${title}`, '', `> paper_id: ${pid} · 导出时间 ${at} · 高亮 ${stats.exported_marks} 处`, '']
  return lines.concat(legendMd(palette), paras.join('\n\n'), '').join('\n')
}

/** Normalize + validate the export format (html|md). Throws on anything else. */
function normalizeFormat(format) {
  const f = String(format || 'html').toLowerCase()
  if (f !== 'html' && f !== 'md') throw new Error(`unsupported export format: ${JSON.stringify(format)} (html|md)`)
  return f
}

/**
 * Build the export content for a paper from its highlights doc + optional
 * profile colors. Pure apart from the timestamp default.
 * @returns {{ok, format, content, paper_id, title, stats}}
 */
function buildExport({ format, highlights, colors, include_pending = false, exported_at }) {
  const f = normalizeFormat(format)
  const opts = { highlights, colors, include_pending, exported_at }
  const content = f === 'md' ? renderMarkdown(opts) : renderHtml(opts)
  const spans = buildExportSpans(highlights, { include_pending })
  const paper = (highlights && highlights.paper) || {}
  return {
    ok: true,
    format: f,
    content,
    paper_id: paper.id || '',
    title: paper.title || '',
    stats: computeExportStats(spans),
  }
}

/** data/<paper_id>/export/ directory for written export files (D1). */
function exportDir(root, paperId) {
  return path.join(paperDir(root, paperId), 'export')
}

/** <paper_id>.<ext> filename for a written export file. */
function exportFileName(paperId, format) {
  const ext = format === 'md' ? 'md' : 'html'
  return `${paperId}.${ext}`
}

/** Write rendered content to data/<paper_id>/export/<paper_id>.<ext> (atomic). */
async function writeExport(root, paperId, format, content) {
  const dir = exportDir(root, paperId)
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, exportFileName(paperId, format))
  await atomicWriteText(file, content)
  return file
}

module.exports = {
  DEFAULT_COLORS,
  cmpAnchor,
  escapeHtml,
  resolveColors,
  buildExportSpans,
  spansByAnchor,
  anchorSegments,
  computeExportStats,
  legendHtml,
  legendMd,
  renderBodyHtml,
  styleHtml,
  renderHtml,
  renderMarkdown,
  normalizeFormat,
  buildExport,
  exportDir,
  exportFileName,
  writeExport,
}
