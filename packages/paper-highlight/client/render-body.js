'use strict'

/**
 * paper-highlight · shared client render body (single source of truth)
 *
 * The pure render helpers (clampRange / sortAnchorIds / buildBlocks /
 * renderText) are defined ONCE at module level and embedded verbatim into the
 * shipped artifacts via toString(), so the browser code and the unit tests
 * always exercise the exact same source:
 *
 *   1. dynamic/client-half.js  — the browser half of the Step-3 dynamic
 *      dual-half plugin; `callData` is backed by `host.call('paper.read', …)`.
 *   2. client/client.js        — the durable `__ModuleLoader__` bundle; the
 *      same statements run with `callData` backed by `fetch('/paper-hl/…')`
 *      (the Step-4 host webserver route).
 *
 * BODY is the embedded statement block. Closure contract: the embedding code
 * must provide `React`, `callData` (an async (args) => JSON function answering
 * {ok, paperId, paperMd, anchors, highlights, sections, papers} |
 * {ok:false, error}), and `styles` ({insert(css)}). The block defines
 * `const inject = [...]`, `function apply(ctx)`, plus the helpers, and ends
 * with nothing exported — wrappers assign exports themselves.
 *
 * The embedded helpers never use backticks / template literals / `${`, so
 * interpolating them into BODY stays safe.
 */

const COLOR_MAP = {
  yellow: '#fff3a0',
  red: '#ff9c94',
  blue: '#8fd0f7',
  green: '#b0e3a8',
  purple: '#d9b8f2',
}
const COLOR_LABELS = {
  yellow: '关键定义/方法',
  red: '核心洞见/贡献',
  blue: '局限/风险',
  green: '可借鉴/启发',
  purple: '待深挖/存疑',
}

/**
 * v0.3 Phase 1 · colors.yml-driven palette (design §4.3 L1).
 *
 * Resolve the profile color map (name → { color, label }) into a flat legend
 * list [{name, color, label}]. Null / empty / partial maps fall back to the
 * built-in five colors (COLOR_MAP / COLOR_LABELS), so the UI keeps working
 * before onboarding and when a custom color lacks a label. This single pure
 * function drives the legend, the recolor swatches and the add-popup palette.
 */
function colorLegend(colors) {
  const src = colors && typeof colors === 'object' ? colors : null
  let names = src ? Object.keys(src) : []
  if (names.length === 0) names = Object.keys(COLOR_MAP)
  const list = []
  for (const name of names) {
    const c = src && src[name]
    list.push({
      name,
      color: (c && c.color) || COLOR_MAP[name] || '#cccccc',
      label: (c && c.label) || COLOR_LABELS[name] || name,
    })
  }
  return list
}

/**
 * v0.3 Phase 3 · profile edit panel model (design §4.3).
 *
 * Turn the host profile object into the panel's draft shape:
 *   { colors: [{name,color,label}], rules: [...], exemplars: [...],
 *     stats: {overall, papers}, notes }
 * profile=null (host without the profile route / offline) falls back to the
 * built-in five colors + empty layers so the panel still opens.
 */
function profilePanelModel(profile) {
  const colors = profilePanelColors(profile)
  const rules = profile && Array.isArray(profile.rules) ? profile.rules : []
  const exemplars = profile && Array.isArray(profile.exemplars) ? profile.exemplars : []
  const stats = profile && profile.stats && typeof profile.stats === 'object' ? profile.stats : { papers: [], overall: null }
  const notes = profile && typeof profile.reflection_notes === 'string' ? profile.reflection_notes : ''
  return { colors, rules, exemplars, stats, notes }
}

/** colors layer of the panel model: flat [{name,color,label}] rows. */
function profilePanelColors(profile) {
  return colorLegend(profile && profile.colors ? profile.colors : null)
}

/**
 * Build the POST /paper-hl/profile/save payload from the panel drafts.
 * Only fields present in the draft are included; colors is re-encoded from the
 * flat row list back into the {name: {color, label}} map the host expects.
 */
function profileSavePayload(drafts) {
  const out = {}
  if (drafts && Array.isArray(drafts.colors)) {
    const colors = {}
    for (const row of drafts.colors) {
      if (row && row.name) colors[row.name] = { color: row.color || '', label: row.label || row.name }
    }
    out.colors = colors
  }
  if (drafts && Array.isArray(drafts.rules)) out.rules = drafts.rules
  if (drafts && Array.isArray(drafts.exemplars)) out.exemplars = drafts.exemplars
  if (drafts && typeof drafts.notes === 'string') out.reflection_notes = drafts.notes
  return out
}

/**
 * v0.3 Phase 2 · pending-proposal panel helpers.
 *
 * proposalCardModel flattens one pending-proposal ENTRY from /paper-hl/profile
 * pending_proposals[] (shape { paper_id, updated_at, proposal: profile_proposal })
 * into the panel card shape:
 *   { paper_id, rules: [{id:'rule-<i>', text, confidence, from}],
 *     exemplars: [{id:'exemplar-<i>', summary}], stats_text }
 * buildApplyDecisions turns the per-item accept/reject id lists into the
 * decisions payload for POST /paper-hl/profile/apply (empty lists omitted;
 * 'all' shortcuts are sent directly by the panel buttons).
 */
function proposalCardModel(entry) {
  const inner = entry && entry.proposal ? entry.proposal : entry
  const rules = inner && Array.isArray(inner.rules) ? inner.rules : []
  const exemplars = inner && Array.isArray(inner.exemplars) ? inner.exemplars : []
  const stats = inner && inner.stats ? inner.stats : null
  const statsText = stats && typeof stats.sections_reviewed === 'number'
    ? ('已审节 ' + stats.sections_reviewed + ' · 接受率 ' + Math.round((stats.overall_accept_rate || 0) * 100) + '%' + (stats.recolor_events ? ' · 改色 ' + stats.recolor_events : ''))
    : '（无统计雏形）'
  return {
    paper_id: (entry && entry.paper_id) || (inner && inner.paper_id) || '',
    rules: rules.map((r, i) => ({
      id: 'rule-' + i,
      text: (r && r.rule) || '',
      confidence: (r && r.confidence) || null,
      from: (r && r.from) || null,
    })),
    exemplars: exemplars.map((e, i) => ({
      id: 'exemplar-' + i,
      summary: ((e && e.span_id) || '?') + ' · ' + (((e && e.user_decision) && (e.user_decision.color || e.user_decision.action)) || '?') + ((e && e.note) ? ' — ' + e.note : ''),
    })),
    stats_text: statsText,
  }
}

function buildApplyDecisions(acceptIds, rejectIds) {
  const decisions = {}
  if (Array.isArray(acceptIds) && acceptIds.length > 0) decisions.accept = acceptIds
  if (Array.isArray(rejectIds) && rejectIds.length > 0) decisions.reject = rejectIds
  return decisions
}

/**
 * Clamp a 0-based half-open span range to [0, len]. Tolerates whitespace /
 * normalization drift between anchors.json and the rendered text (design §10
 * #4): a slightly out-of-range span still renders instead of throwing mid-slice.
 */
function clampRange(start, end, len) {
  const s = Math.max(0, Math.min(start, len))
  const e = Math.max(s, Math.min(end, len))
  return [s, e]
}

function sortAnchorIds(anchors) {
  return Object.keys(anchors).sort((x, y) => {
    const a = anchors[x]
    const b = anchors[y]
    return a.page - b.page || a.block - b.block || a.par - b.par
  })
}

/**
 * Build the render block list in reading order. Skips heading blocks of EMPTY
 * sections (e.g. a leftover "## References" whose ref_text was filtered out)
 * but never the paper-title section. sections is optional (the dynamic half may
 * not provide it), so the skip is a best-effort refinement, not a contract.
 */
function buildBlocks(anchors, spans, sections) {
  const byAnchor = {}
  for (const s of spans || []) {
    if (!anchors[s.anchor]) continue
    ;(byAnchor[s.anchor] = byAnchor[s.anchor] || []).push(s)
  }
  const skip = new Set()
  if (sections) {
    for (const sec of sections) {
      if (sec.empty && sec.kind !== 'paper_title') skip.add(sec.anchor_id)
    }
  }
  let firstTitleSeen = false
  return sortAnchorIds(anchors).filter((id) => !skip.has(id)).map((id) => {
    const a = anchors[id]
    const list = (byAnchor[id] || []).slice().sort((x, y) => x.char_start - y.char_start)
    const isFirstTitle = !firstTitleSeen && a.type === 'title'
    if (a.type === 'title') firstTitleSeen = true
    return { id, anchor: a, spans: list, isFirstTitle }
  })
}

/**
 * Merge the visual style for one highlight mark (P2-c): base color chip + the
 * status style (spanActiveStyle) + the selected outline when active. Pure.
 * v0.3 Phase 1: `colors` (optional) is the profile color map (name →
 * {color,label}); when present the chip background resolves through it
 * (colors.yml-driven), otherwise the built-in COLOR_MAP is used.
 */
function markStyle(span, isActive, clickable, colors) {
  const legend = colorLegend(colors)
  let background = span.color
  for (const l of legend) {
    if (l.name === span.color) {
      background = l.color
      break
    }
  }
  const style = Object.assign(
    { background, padding: '1px 0', borderRadius: 2, cursor: clickable ? 'pointer' : 'help' },
    spanActiveStyle(span.status)
  )
  if (isActive) {
    style.outline = '2px solid rgba(0,0,0,.6)'
    style.outlineOffset = 1
  }
  return style
}

/**
 * v0.5.1 · lightweight inline/display math rendering.
 *
 * No external dependency (no KaTeX / MathJax): a pure tokenizer + converter
 * over the OCR-mangled LaTeX fragments that MinerU normalization leaves inline
 * (e.g. "N \times D", "l o g _ { 2 } ( V )", "\mathbf { f }", "{ - }"). It
 * supports explicit delimiters ($$…$$ / \[…\] display, $…$ / \(…\) inline) AND
 * bare LaTeX tokens embedded in prose. Display = Unicode symbols + combining
 * accents + CSS styling; unknown commands are preserved verbatim so nothing is
 * ever lost. splitMathPieces keeps the raw [start,end) char ranges, so the
 * highlight-selection machinery can subdivide segments exactly (each math
 * piece becomes its own segment; nodeOffsetToSeg maps the display-length
 * offset back to the raw range).
 *
 * These helpers never use backticks / template literals / `${` (they are
 * embedded into the shipped bundle via toString()).
 */

const MATH_SYMBOLS = {
  alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4', epsilon: '\u03B5',
  varepsilon: '\u03F5', zeta: '\u03B6', eta: '\u03B7', theta: '\u03B8', vartheta: '\u03D1',
  iota: '\u03B9', kappa: '\u03BA', lambda: '\u03BB', mu: '\u03BC', nu: '\u03BD',
  xi: '\u03BE', omicron: '\u03BF', pi: '\u03C0', varpi: '\u03D6', rho: '\u03C1',
  varrho: '\u03F1', sigma: '\u03C3', varsigma: '\u03C2', tau: '\u03C4', upsilon: '\u03C5',
  phi: '\u03C6', varphi: '\u03D5', chi: '\u03C7', psi: '\u03C8', omega: '\u03C9',
  Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039B', Xi: '\u039E',
  Pi: '\u03A0', Sigma: '\u03A3', Upsilon: '\u03A5', Phi: '\u03A6', Psi: '\u03A8', Omega: '\u03A9',
  times: '\u00D7', cdot: '\u00B7', pm: '\u00B1', mp: '\u2213', le: '\u2264', leq: '\u2264',
  ge: '\u2265', geq: '\u2265', ne: '\u2260', neq: '\u2260', approx: '\u2248', equiv: '\u2261',
  propto: '\u221D', in: '\u2208', notin: '\u2209', ni: '\u220B', subset: '\u2282',
  supset: '\u2283', subseteq: '\u2286', supseteq: '\u2287', cup: '\u222A', cap: '\u2229',
  forall: '\u2200', exists: '\u2203', nexists: '\u2204', emptyset: '\u2205', infty: '\u221E',
  partial: '\u2202', nabla: '\u2207', to: '\u2192', rightarrow: '\u2192', leftarrow: '\u2190',
  leftrightarrow: '\u2194', uparrow: '\u2191', downarrow: '\u2193', Rightarrow: '\u21D2',
  Leftarrow: '\u21D0', sum: '\u2211', prod: '\u220F', int: '\u222B', oint: '\u222E',
  ldots: '\u2026', dots: '\u2026', cdots: '\u22EF', vdots: '\u22EE', ddots: '\u22F1',
  prime: '\u2032', degree: '\u00B0', ast: '\u2217', star: '\u22C6', oplus: '\u2295',
  otimes: '\u2297', ominus: '\u2296', odot: '\u2299', sqrt: '\u221A', angle: '\u2220',
  perp: '\u22A5', parallel: '\u2225', mid: '\u2223', sim: '\u223C', simeq: '\u2243',
  cong: '\u2245', asymp: '\u224D', ll: '\u226A', gg: '\u226B', lceil: '\u2308',
  rceil: '\u2309', lfloor: '\u230A', rfloor: '\u230B', frac: '\u2044', colon: ':',
  // legacy font switches (no glyph of their own) — vanish cleanly.
  bf: '', rm: '', it: '', tt: '', cal: '', boldsymbol: '',
}

const SUP_MAP = { '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079', '+': '\u207A', '-': '\u207B', '=': '\u207C', '(': '\u207D', ')': '\u207E', 'n': '\u207F', 'i': '\u2071', 'T': '\u1D40' }
const SUB_MAP = { '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084', '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089', '+': '\u208A', '-': '\u208B', '=': '\u208C', '(': '\u208D', ')': '\u208E', 'a': '\u2090', 'e': '\u2091', 'o': '\u2092', 'x': '\u2093', 'i': '\u1D62', 'j': '\u2C7C', 'k': '\u2096', 'l': '\u2097', 'm': '\u2098', 'n': '\u2099', 'p': '\u209A', 's': '\u209B', 't': '\u209C', 'r': '\u1D63', 'h': '\u2095', 'u': '\u1D64', 'v': '\u1D65', 'f': '\u1DA0' }

/** Map each char of t through the script table (fallback = the char itself). */
function mapScript(t, map) {
  let out = ''
  for (const ch of String(t || '')) out += map[ch] !== undefined ? map[ch] : ch
  return out
}

/** Unicode superscript for t (fallback = plain char). */
function supScript(t) { return mapScript(t, SUP_MAP) }

/** Unicode subscript for t (fallback = plain char). */
function subScript(t) { return mapScript(t, SUB_MAP) }

/** Unicode mathematical bold for t (a-z → 𝐚-𝐳, A-Z → 𝐀-𝐙). */
function boldMath(t) {
  let out = ''
  for (const ch of String(t || '')) {
    const c = ch.codePointAt(0)
    if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1D41A + (c - 97))
    else if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1D400 + (c - 65))
    else out += ch
  }
  return out
}

/**
 * Convert one math fragment (raw LaTeX text, delimiters stripped by
 * mathConvert) into its display string. Pure — unknown commands stay verbatim.
 */
function mathClean(s) {
  return String(s || '')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, a, b) => mathClean(a).trim() + '\u2044' + mathClean(b).trim())
    .replace(/\\(mathbf|boldsymbol|textbf)\s*\{([^{}]*)\}/g, (m, c, a) => boldMath(mathClean(a).trim()))
    .replace(/\\(mathrm|mathit|text|textit|textrm)\s*\{([^{}]*)\}/g, (m, c, a) => mathClean(a).trim())
    .replace(/\\(bar|hat|tilde|dot|acute|grave|vec|overline|check)\s*\{([^{}]*)\}/g, (m, cmd, a) => {
      const t = mathClean(a).trim()
      const cc = { bar: '\u0304', hat: '\u0302', tilde: '\u0303', dot: '\u0307', acute: '\u0301', grave: '\u0300', vec: '\u20D7', overline: '\u0305', check: '\u030C' }[cmd]
      return cc ? (t + cc) : t
    })
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, (m, a) => '\u221A' + mathClean(a).trim())
    .replace(/([_\^])\s*\{\s*([^{}]*)\s*\}/g, (m, op, inner) => (op === '_' ? subScript(mathClean(inner).trim()) : supScript(mathClean(inner).trim())))
    .replace(/([_\^])([A-Za-z0-9])/g, (m, op, ch) => (op === '_' ? subScript(ch) : supScript(ch)))
    .replace(/\\[,;:!]\s*/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, (m, name) => (MATH_SYMBOLS[name] !== undefined ? MATH_SYMBOLS[name] : m))
    .replace(/\{\s*([0-9A-Za-z+\-*/=<>()|.,;:'"~])\s*\}/g, '$1')
}

/** Strip the surrounding math delimiters, then convert. */
function mathConvert(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^\$\$/, '').replace(/\$\$$/, '')
    .replace(/^\$/, '').replace(/\$$/, '')
    .replace(/^\\\[/, '').replace(/\\\]$/, '')
    .replace(/^\\\(/, '').replace(/\\\)$/, '')
  return mathClean(s)
}

/** Match one explicit delimiter at the head of rest → {len, display, block} | null. */
function matchMathDelim(rest) {
  let m = /^\$\$([\s\S]+?)\$\$/.exec(rest)
  if (m) return { len: m[0].length, display: mathConvert(m[1]), block: true }
  m = /^\\\[([\s\S]+?)\\\]/.exec(rest)
  if (m) return { len: m[0].length, display: mathConvert(m[1]), block: true }
  m = /^\\\(([\s\S]+?)\\\)/.exec(rest)
  if (m) return { len: m[0].length, display: mathConvert(m[1]) }
  m = /^\$([\s\S]+?)\$/.exec(rest)
  if (m && /[\\_^{]/.test(m[1])) return { len: m[0].length, display: mathConvert(m[1]) }
  return null
}

/** Match one bare LaTeX token at the head of rest → {len, display} | null. */
function matchMathToken(rest) {
  const re = /\\[a-zA-Z]+(?:\s*\{[^{}]*\}){0,2}|[_\^]\s*\{[^{}]*\}|[_\^][A-Za-z0-9]|\{\s*[^\s{}]\s*\}/g
  re.lastIndex = 0
  const m = re.exec(rest)
  if (m && m.index === 0) return { len: m[0].length, display: mathConvert(m[0]) }
  return null
}

/**
 * PURE — split a string into contiguous pieces [{start, end, math, display,
 * block?}] covering [0, text.length). `start/end` are offsets into `text`
 * (RAW), `display` is the rendered form (length may differ for math pieces).
 * Text gaps without math collapse into a single piece so non-math anchors keep
 * the exact segment layout the selection machinery expects.
 */
function splitMathPieces(text) {
  const src = String(text || '')
  const n = src.length
  const out = []
  let pos = 0
  let textStart = 0
  const flush = (end) => {
    if (end > textStart) out.push({ start: textStart, end, math: false, display: src.slice(textStart, end) })
  }
  while (pos < n) {
    const rest = src.slice(pos)
    const d = matchMathDelim(rest)
    if (d) {
      flush(pos)
      out.push({ start: pos, end: pos + d.len, math: true, display: d.display, block: !!d.block })
      pos += d.len
      textStart = pos
      continue
    }
    const t = matchMathToken(rest)
    if (t) {
      flush(pos)
      out.push({ start: pos, end: pos + t.len, math: true, display: t.display })
      pos += t.len
      textStart = pos
      continue
    }
    pos++
  }
  flush(n)
  return out
}

/** React element for one math piece (shared by the renderText branches). */
function mathPieceEl(piece, rawText, segIndex, withSeg, segProps) {
  const props = {
    key: 'seg-' + segIndex,
    className: 'phl-math' + (piece.block ? ' phl-math-display' : ''),
    title: rawText,
  }
  if (withSeg) {
    props['data-phl-seg'] = String(segIndex)
    props['data-phl-dlen'] = String(piece.display.length)
  }
  return React.createElement('span', props, piece.display)
}

/**
 * Render one paragraph's text with its spans as <mark> nodes. opts (optional)
 * enables the P2-c review interaction: { onMarkClick, activeSpanId }. When
 * onMarkClick is provided the marks become clickable (selected outline from
 * markStyle) so the action bar can open on them.
 *
 * P2-d: opts.withSegments wraps EVERY emitted text node (plain text + mark) in
 * an element carrying data-phl-seg (= its index into the flat buildSegmentMap
 * list) and data-phl-anchor (= its anchor id), so a DOM selection can be
 * mapped back to anchor char offsets. opts.segBase is the flat segment index
 * where this block's nodes begin; opts.anchorId is this block's anchor id.
 * When withSegments is off the output is unchanged (bare strings + marks).
 */
function renderText(text, spans, opts) {
  const withSeg = !!(opts && opts.withSegments)
  const segBase = (opts && Number.isInteger(opts.segBase)) ? opts.segBase : -1
  const anchorId = (opts && opts.anchorId) || ''
  const segProps = (i) => ({ 'data-phl-seg': String(i), 'data-phl-anchor': anchorId })
  // v0.5.1: emit one node per splitMathPieces piece for a plain run (math
  // pieces become their own styled/segment elements). The mathPieceEl helper
  // keeps every branch (no-span / gap / tail) emitting identical DOM.
  const emitPlain = (run) => {
    const pieces = splitMathPieces(run)
    if (pieces.length === 1 && !pieces[0].math) {
      if (withSeg) out.push(React.createElement('span', Object.assign({ key: 'seg-' + si }, segProps(si)), run))
      else out.push(run)
      si++
      return
    }
    for (const p of pieces) {
      if (!p.math) {
        if (withSeg) out.push(React.createElement('span', Object.assign({ key: 'seg-' + si }, segProps(si)), p.display))
        else out.push(p.display)
      } else {
        out.push(mathPieceEl(p, run.slice(p.start, p.end), si, withSeg, segProps))
      }
      si++
    }
  }
  const out = []
  let pos = 0
  let si = segBase
  const onMarkClick = opts && opts.onMarkClick
  const activeSpanId = opts && opts.activeSpanId
  if (!spans || spans.length === 0) {
    const pieces = splitMathPieces(String(text))
    if (pieces.length === 1 && !pieces[0].math) {
      if (withSeg) return [React.createElement('span', Object.assign({ key: 'seg-' + segBase }, segProps(segBase)), text)]
      return [text]
    }
    for (const p of pieces) {
      if (!p.math) {
        if (withSeg) out.push(React.createElement('span', Object.assign({ key: 'seg-' + si }, segProps(si)), p.display))
        else out.push(p.display)
      } else {
        out.push(mathPieceEl(p, text.slice(p.start, p.end), si, withSeg, segProps))
      }
      si++
    }
    return out
  }
  for (const s of spans) {
    const [start, end] = clampRange(s.char_start, s.char_end, text.length)
    if (start > pos) emitPlain(text.slice(pos, start))
    if (end > start) {
      const props = {
        key: s.id,
        style: markStyle(s, s.id === activeSpanId, !!onMarkClick, opts && opts.colors),
        title: (s.rationale || s.color) + (s.status ? ' [' + s.status + ']' : '')
      }
      if (withSeg) Object.assign(props, segProps(si))
      if (onMarkClick) {
        props.onClick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation()
          onMarkClick(s)
        }
      }
      out.push(React.createElement('mark', props, text.slice(start, end)))
      si++
    }
    pos = Math.max(pos, end)
  }
  if (pos < text.length) emitPlain(text.slice(pos))
  return out
}

/**
 * v0.2 Phase 2 · client review interactions — P2-a write path + P2-b state model.
 *
 * All of these are pure / transport-injectable so they are embedded verbatim
 * into the shipped bundles via toString() (same single-source pattern as the
 * render helpers above) and unit-tested in test/run-render.js without React.
 */

/** Build the POST URL for the review write route (P2-a). */
function buildWriteUrl(paperId) {
  return '/paper-hl/write' + (paperId ? '?paperId=' + encodeURIComponent(paperId) : '')
}

/** JSON-encode the review action payload (P2-a). null/undefined → '{}'. */
function encodeWriteBody(action) {
  return JSON.stringify(action || {})
}

/**
 * Data function for the write path (P2-a). Sends one review action to the
 * host and resolves with the parsed response ({ok:true,…}), rejecting on an
 * ok:false payload or a transport failure. `transport` is injected by the
 * embedding code (durable bundle: fetch POST; dynamic half: not wired yet):
 *   transport(url, body) → Promise<parsed JSON>
 * When omitted, falls back to the closure-injected `writeData` (gen-client.js
 * defines it for the durable bundle only — "dynamic 半体备份暂不接 write").
 */
function callWrite(action, paperId, transport) {
  const url = buildWriteUrl(paperId)
  const body = encodeWriteBody(action)
  const t = transport || (typeof writeData === 'function' ? writeData : null)
  if (!t) return Promise.reject(new Error('paper-highlight: write transport not available'))
  return Promise.resolve(t(url, body)).then((res) => {
    if (!res || res.ok !== true) throw new Error((res && res.error) || ('write ' + url + ' failed'))
    return res
  })
}

/**
 * v0.3 Phase 1 · profile data function. Sends one request to the profile
 * routes: callProfile('GET', '') → GET /paper-hl/profile; callProfile('POST',
 * '/init', payload) → POST /paper-hl/profile/init; callProfile('POST',
 * '/apply', payload) → POST /paper-hl/profile/apply. Resolves with the parsed
 * JSON response ({ok:true,…}), rejecting on ok:false or transport failure.
 * `transport` is injected by the embedding code (durable bundle: profileData
 * fetch; dynamic half: not wired → clean rejection, like callWrite).
 */
function callProfile(method, path, payload, transport) {
  const url = '/paper-hl/profile' + (path || '')
  const body = payload ? JSON.stringify(payload) : null
  const m = method || 'GET'
  const t = transport || (typeof profileData === 'function' ? profileData : null)
  if (!t) return Promise.reject(new Error('paper-highlight: profile transport not available'))
  return Promise.resolve(t(m, url, body)).then((res) => {
    if (!res || res.ok !== true) throw new Error((res && res.error) || ('profile ' + m + ' ' + url + ' failed'))
    return res
  })
}

/**
 * v0.5 · format data function. POSTs a one-click factory reset to
 * /paper-hl/format with a JSON body ({confirm: true, scope}). The payload must
 * carry confirm:true — the host rejects anything else (destructive guard).
 * Resolves with the cleared-count audit summary ({ok:true, …}), rejecting on
 * ok:false or transport failure. `transport` is injected by the embedding
 * code (durable bundle: formatData fetch; dynamic half: not wired → clean
 * rejection, like callWrite / callProfile).
 */
function callFormat(payload, transport) {
  const body = payload ? JSON.stringify(payload) : '{}'
  const t = transport || (typeof formatData === 'function' ? formatData : null)
  if (!t) return Promise.reject(new Error('paper-highlight: format transport not available'))
  return Promise.resolve(t(body)).then((res) => {
    if (!res || res.ok !== true) throw new Error((res && res.error) || 'format failed')
    return res
  })
}

/**
 * Filter for rendering (P2-b): rejected spans are NOT highlighted in the body
 * but stay in the JSON as the audit/diff signal (design §4.2). Pure — returns
 * a new array.
 */
function excludeRejected(spans) {
  return (spans || []).filter((s) => s.status !== 'rejected')
}

/**
 * Optimistic-update reducer (P2-b): applies a review action payload locally to
 * the current span list so the UI responds instantly, before the write round
 * trip. Pure — never mutates the input; returns a new array.
 *
 * payload mirrors the POST body ({action, span_id, color, anchor, char_start,
 * char_end, rationale, note, …}). `add` may carry an extra `clientId` for the
 * optimistic local id (the server allocates the real s-<n> id and ignores it).
 * Unknown span id / unknown action are no-ops (optimistic tolerance).
 */
function localApplySpans(spans, payload) {
  const arr = (spans || []).slice()
  const kind = payload && payload.action
  if (kind === 'add') {
    arr.push({
      id: (payload && payload.clientId) || 'local-' + (arr.length + 1),
      anchor: payload.anchor,
      char_start: payload.char_start,
      char_end: payload.char_end,
      color: payload.color,
      rationale: (payload && payload.rationale) || '',
      status: 'user_added',
      decisions: [],
      _local: true,
    })
    return arr
  }
  const idx = payload && payload.span_id ? arr.findIndex((s) => s.id === payload.span_id) : -1
  if (idx < 0) return arr
  const span = arr[idx]
  const next = { ...span, decisions: span.decisions ? span.decisions.slice() : [] }
  switch (kind) {
    case 'accept':
      next.status = 'accepted'
      break
    case 'reject':
      next.status = 'rejected'
      break
    case 'recolor':
      next.color = payload.color
      break
    case 'rescope':
      next.anchor = payload.anchor
      next.char_start = payload.char_start
      next.char_end = payload.char_end
      break
    case 'note':
      next.note = (payload.note !== undefined && payload.note !== null) ? String(payload.note) : ''
      break
    default:
      return arr
  }
  arr[idx] = next
  return arr
}

/**
 * Status → visual style mapping (P2-b). Merged into a mark's React style by
 * the review UI (P2-c+) so proposed / accepted / user_added / rejected are
 * visually distinct. Note rejected spans are normally filtered by
 * excludeRejected before rendering; this still defines their visual contract.
 */
function spanActiveStyle(status) {
  if (status === 'rejected') return { opacity: 0.3, textDecoration: 'line-through' }
  if (status === 'accepted') return { opacity: 1 }
  if (status === 'user_added') return { boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.35)' }
  return { opacity: 0.75 } // proposed
}

/**
 * Merge the server-confirmed span (from a write response) back into the
 * optimistic overlay (P2-c): replace the matching span by id so status/color/
 * decisions reflect the authoritative host result. Unknown id or missing span
 * leaves the list untouched (the optimistic copy already matches for the
 * P2-c single-user flow). P2-d: for an `add` the optimistic span carries a
 * client-local id while the server allocates s-<n>, so when no span matches
 * the server id we fall back to matching the optimistic _local span by the
 * clientId from the payload. Pure.
 */
function reconcileSpan(spans, serverSpan, payload) {
  if (!serverSpan || typeof serverSpan.id !== 'string') return (spans || []).slice()
  const arr = (spans || []).slice()
  let idx = arr.findIndex((s) => s.id === serverSpan.id)
  if (idx < 0 && payload && payload.action === 'add' && payload.clientId) {
    idx = arr.findIndex((s) => s._local === true && s.id === payload.clientId)
  }
  if (idx >= 0) arr[idx] = serverSpan
  return arr
}

/**
 * v0.2 Phase 2 (P2-d) · selection → anchor range mapping.
 *
 * buildSegmentMap turns the render block list into a FLAT list of segments —
 * one per rendered text node (plain text or highlighted <mark>) — each with
 * its anchor id and [start, end) char range inside anchor.text. The segments
 * come out in exactly the order renderText emits nodes, so a rendered node's
 * data-phl-seg index maps 1:1 to a segment. mapSelection then converts a
 * normalized {start, end} selection (segment index + char offset) into a
 * highlight range, tolerating cross-segment / reverse / out-of-bounds / empty
 * selections. These are the pure, browser-free core of the "text selection →
 * manual add / rescope" interaction.
 */

/** Segments for ONE block (anchor). Spans are clamped + sorted by start.
 *  v0.5.1: plain runs are subdivided by splitMathPieces so math pieces become
 *  their own segments — exactly matching renderText's node emission. */
function pushPlainSegs(segs, anchorId, text, from, to) {
  const pieces = splitMathPieces(text.slice(from, to))
  for (const p of pieces) segs.push({ anchorId, start: from + p.start, end: from + p.end, spanId: null, math: !!p.math })
}

function buildBlockSegments(anchorId, text, spans) {
  const segs = []
  const sorted = (spans || []).slice().sort((x, y) => x.char_start - y.char_start)
  let pos = 0
  for (const s of sorted) {
    const [start, end] = clampRange(s.char_start, s.char_end, text.length)
    if (start > pos) pushPlainSegs(segs, anchorId, text, pos, start)
    if (end > start) segs.push({ anchorId, start, end, spanId: s.id })
    pos = Math.max(pos, end)
  }
  if (pos < text.length) pushPlainSegs(segs, anchorId, text, pos, text.length)
  return segs
}

/** Flat segment list across all blocks, in render order. */
function buildSegmentMap(blocks) {
  const out = []
  for (const b of blocks || []) {
    const segs = buildBlockSegments(b.id, (b.anchor && b.anchor.text) || '', b.spans)
    for (const s of segs) out.push(s)
  }
  return out
}

/**
 * Map a normalized selection back to a highlight range.
 * sel = { start: {seg, offset}, end: {seg, offset} } — seg indexes into the
 * flat buildSegmentMap list, offset is a char offset within that segment's
 * rendered text. Returns:
 *   { ok:true, anchor, char_start, char_end }
 *   { ok:false, reason: 'empty' | 'out-of-range' | 'cross-anchor' }
 * Tolerances: reverse selections swap; out-of-bounds offsets clamp; a selection
 * spanning two anchors cannot become one span (rejected); empty → 'empty'.
 */
function mapSelection(segments, sel) {
  if (!sel || !sel.start || !sel.end) return { ok: false, reason: 'empty' }
  const norm = (p) => {
    if (!p || typeof p !== 'object') return null
    const seg = Number.isInteger(p.seg) && p.seg >= 0 && p.seg < segments.length ? segments[p.seg] : null
    if (!seg) return null
    const len = seg.end - seg.start
    const off = Math.max(0, Math.min(Number.isFinite(p.offset) ? p.offset : 0, len))
    return { seg: p.seg, segObj: seg, offset: off }
  }
  let s = norm(sel.start)
  let e = norm(sel.end)
  if (!s || !e) return { ok: false, reason: 'out-of-range' }
  if (s.seg > e.seg || (s.seg === e.seg && s.offset > e.offset)) { const t = s; s = e; e = t }
  if (s.segObj.anchorId !== e.segObj.anchorId) return { ok: false, reason: 'cross-anchor' }
  const char_start = s.segObj.start + s.offset
  const char_end = e.segObj.start + e.offset
  if (char_end <= char_start) return { ok: false, reason: 'empty' }
  return { ok: true, anchor: s.segObj.anchorId, char_start, char_end }
}

/**
 * Resolve a DOM selection boundary (a node + offset) to a segment index + char
 * offset. node is an element (nodeType 1) or a text node (nodeType 3); the
 * nearest element carrying data-phl-seg (= flat segment index) wins:
 *  - text node inside a seg element → offset is already a char offset
 *  - seg element itself → offset is a child index (0 → start, ≥1 → end)
 *  - a block element (data-phl-anchor) → child index mapped via blockChildToSeg
 * Returns { seg, offset } or null when no seg element is reachable.
 */
function nodeOffsetToSeg(node, offset, segments) {
  if (!node) return null
  const isEl = node.nodeType === 1
  let el = isEl ? node : node.parentElement
  let depth = 0
  while (el && depth < 40) {
    const attr = (typeof el.getAttribute === 'function') ? el.getAttribute('data-phl-seg') : null
    if (attr !== null && attr !== undefined && attr !== '') {
      const seg = Number(attr)
      if (!(Number.isInteger(seg) && seg >= 0 && seg < segments.length)) return null
      const len = segments[seg].end - segments[seg].start
      // v0.5.1: math pieces carry data-phl-dlen (their display length, which
      // may be shorter than the raw LaTeX range). A display offset at/after the
      // display end maps to the raw end (whole-token selections stay exact);
      // partial offsets are clamped to the raw range.
      let off
      if (isEl) {
        off = offset > 0 ? len : 0
      } else {
        off = Math.max(0, Math.min(offset, len))
        const dlenAttr = (typeof el.getAttribute === 'function') ? el.getAttribute('data-phl-dlen') : null
        if (dlenAttr !== null && dlenAttr !== undefined && dlenAttr !== '') {
          const dlen = Number(dlenAttr)
          if (Number.isFinite(dlen) && dlen < len && off >= dlen) off = len
        }
      }
      return { seg, offset: off }
    }
    if (isEl && el === node && typeof el.getAttribute === 'function' && el.getAttribute('data-phl-anchor') !== null) {
      return blockChildToSeg(el, offset, segments)
    }
    el = el.parentElement
    depth++
  }
  return null
}

/** Map a block element's child index (an element-offset boundary) to a segment. */
function blockChildToSeg(blockEl, childIndex, segments) {
  const kids = blockEl.childNodes || []
  const attrOf = (n) => (n && typeof n.getAttribute === 'function') ? n.getAttribute('data-phl-seg') : null
  const at = (n, end) => {
    const a = attrOf(n)
    if (a === null || a === undefined || a === '') return null
    const seg = Number(a)
    if (!(Number.isInteger(seg) && seg >= 0 && seg < segments.length)) return null
    return { seg, offset: end ? segments[seg].end - segments[seg].start : 0 }
  }
  if (childIndex <= 0) return at(kids[0], false)
  if (childIndex >= kids.length) return at(kids[kids.length - 1], true)
  return at(kids[childIndex], false)
}

/**
 * Convert a DOM Selection into the normalized {start, end} mapSelection input.
 * Collapsed selections (no text selected) → null. Returns null when the
 * selection cannot be resolved to segments ({ok:false} marks a non-fatal
 * no-seg so the caller can stay silent — e.g. release over the margins).
 */
function selectionToNorm(sel, segments) {
  if (!sel) return null
  if (sel.isCollapsed) return null
  const a = nodeOffsetToSeg(sel.anchorNode, sel.anchorOffset, segments)
  const b = nodeOffsetToSeg(sel.focusNode, sel.focusOffset, segments)
  if (!a || !b) return { ok: false, reason: 'no-seg' }
  return { start: a, end: b }
}

/**
 * v0.2 Phase 2 (P2-e) · review-completion signal (section status closure).
 *
 * sectionList turns the /read sections into the GUI's reviewable section list —
 * skipping the paper-title pseudo-section and empty sections (e.g. a leftover
 * References) — and merges the plan review status (reviewed_at) with the
 * optimistic local overrides written by review_section. currentSectionId
 * derives which section is currently in view from the body scroll state, so
 * the "标记本节审查完毕" button acts on the section the user is actually reading.
 */

/** Reviewable section list: filter + plan/override status merge. Pure. */
function sectionList(sections, plan, overrides) {
  const planSections = (plan && plan.sections) || []
  const out = []
  for (const s of sections || []) {
    if (!s || s.empty || s.kind === 'paper_title') continue
    const entry = s.plan || planSections.find((e) => e.id === s.id || e.section === s.title) || null
    const ov = overrides && overrides[s.id]
    const status = (ov && ov.status) || (entry && entry.status) || 'pending'
    out.push({
      id: s.id,
      title: s.title,
      anchor_id: s.anchor_id,
      reviewed: status === 'reviewed',
      reviewed_at: (ov && ov.reviewed_at) || (entry && entry.reviewed_at) || null,
    })
  }
  return out
}

/**
 * Current section id from the body scroll state. blockTops: [{anchorId, top}]
 * — each rendered block's top offset inside the scroll container. The current
 * section is the LAST reviewable section whose anchor block sits at or above
 * the vertical middle of the viewport (standard "sticky heading" reading
 * position). Returns null when no reviewable section is in view yet.
 */
function currentSectionId(sections, blockTops, scrollTop, viewportHeight) {
  if (!sections || sections.length === 0) return null
  const mid = (scrollTop || 0) + (viewportHeight || 0) / 2
  let current = null
  for (const s of sections) {
    if (!s || s.kind === 'paper_title' || s.empty) continue
    const bt = (blockTops || []).find((b) => b.anchorId === s.anchor_id)
    if (bt && bt.top <= mid) current = s.id
  }
  return current
}

/**
 * v0.4 Phase 4 (D6) · keyboard shortcut mapper. Pure — the PaperView attaches a
 * keydown listener and dispatches whatever this returns.
 *
 * state: { panelView, menuOpen, activeSpanId, addDraft, rescueTarget,
 *          currentSection, sectionItems }
 * opts:  { palette: [color names in legend order] }
 *
 * Mapping: 1-5 改色（对活动 span）/ a 接受 / d 删除 / r 改范围（进入选文态）/
 * Esc 取消（关菜单/新增/改范围/导出对话框）/ Ctrl+Enter 标记当前节完毕 /
 * e 打开导出对话框。仅在论文视图（panelView 'paper'）生效，且忽略输入态
 * （INPUT/TEXTAREA/SELECT/contentEditable 焦点）与带修饰键的普通按键。
 * 返回 action 对象或 null（无操作）。'n 新增' 不在键盘映射内——新增依赖鼠标
 * 选文（onBodyMouseUp），无键盘目标（Phase 4 裁剪）。
 */
function keyAction(event, state, opts) {
  if (!event) return null
  const t = event.target
  if (t && typeof t.tagName === 'string') {
    const tag = t.tagName.toUpperCase()
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true) return null
  }
  const st = state || {}
  if (st.panelView && st.panelView !== 'paper') return null
  const key = event.key
  if (event.ctrlKey || event.metaKey || event.altKey) {
    if ((event.ctrlKey || event.metaKey) && key === 'Enter') {
      const id = st.currentSection || (st.sectionItems && st.sectionItems[0] && st.sectionItems[0].id)
      return id ? { type: 'markSectionReviewed', section: id } : null
    }
    return null
  }
  if (key === 'Escape') return { type: 'cancel' }
  if (key === 'e' || key === 'E') return { type: 'toggleExport' }
  const spanId = st.menuOpen && st.activeSpanId ? st.activeSpanId : null
  if (key === 'a' || key === 'A') return spanId ? { type: 'accept', span_id: spanId } : null
  if (key === 'd' || key === 'D') return spanId ? { type: 'reject', span_id: spanId } : null
  if (key === 'r' || key === 'R') return spanId ? { type: 'rescope', span_id: spanId } : null
  if (/^[1-5]$/.test(key)) {
    const names = (opts && opts.palette) || []
    const name = names[Number(key) - 1]
    return spanId && name ? { type: 'recolor', span_id: spanId, color: name } : null
  }
  return null
}

/**
 * v0.4 Phase 4 (D6) · review progress model. Pure. Accepts either sectionItems
 * (sectionList output: {id, title, reviewed}) or plan.sections entries
 * ({id, status, skip}); skips skip:true entries from both the total and the
 * next-id scan. Returns { total, done, ratio (0-100 rounded), nextId } — empty /
 * no-plan input → all-zero fallback.
 */
function reviewProgress(items) {
  const list = (items || []).filter((s) => s && !s.skip)
  const total = list.length
  const reviewed = (s) => !!(s && (s.reviewed === true || s.status === 'reviewed'))
  const done = list.filter(reviewed).length
  let nextId = null
  for (const s of list) {
    if (!reviewed(s)) { nextId = s.id; break }
  }
  return { total, done, ratio: total > 0 ? Math.round((done / total) * 100) : 0, nextId }
}

/** v0.4 Phase 4 (D6) · export dialog → download URL (pure). */
function buildExportUrl(paperId, format, includePending, download) {
  const q = ['paperId=' + encodeURIComponent(paperId || '')]
  if (format) q.push('format=' + encodeURIComponent(format))
  if (includePending) q.push('include_pending=1')
  if (download) q.push('download=1')
  return '/paper-hl/export?' + q.join('&')
}

const BODY = String.raw`
const COLOR_MAP = ${JSON.stringify(COLOR_MAP)};
const COLOR_LABELS = ${JSON.stringify(COLOR_LABELS)};

${clampRange.toString()}

${sortAnchorIds.toString()}

${buildBlocks.toString()}

${renderText.toString()}

${buildWriteUrl.toString()}

${encodeWriteBody.toString()}

${callWrite.toString()}

${callProfile.toString()}

${callFormat.toString()}

${colorLegend.toString()}

const MATH_SYMBOLS = ${JSON.stringify(MATH_SYMBOLS)};
const SUP_MAP = ${JSON.stringify(SUP_MAP)};
const SUB_MAP = ${JSON.stringify(SUB_MAP)};

${mapScript.toString()}

${supScript.toString()}

${subScript.toString()}

${boldMath.toString()}

${mathClean.toString()}

${mathConvert.toString()}

${matchMathDelim.toString()}

${matchMathToken.toString()}

${splitMathPieces.toString()}

${mathPieceEl.toString()}

${profilePanelModel.toString()}

${profilePanelColors.toString()}

${profileSavePayload.toString()}

${proposalCardModel.toString()}

${buildApplyDecisions.toString()}

${excludeRejected.toString()}

${localApplySpans.toString()}

${spanActiveStyle.toString()}

${markStyle.toString()}

${reconcileSpan.toString()}

${buildBlockSegments.toString()}

${buildSegmentMap.toString()}

${mapSelection.toString()}

${nodeOffsetToSeg.toString()}

${blockChildToSeg.toString()}

${selectionToNorm.toString()}

${sectionList.toString()}

${currentSectionId.toString()}

${keyAction.toString()}

${reviewProgress.toString()}

${buildExportUrl.toString()}

function defaultOnboardDraft(colors) {
  const legend = colorLegend(colors)
  const c = {}
  for (const l of legend) c[l.name] = { color: l.color, label: l.label }
  return { colors: c, density: '每节 3-5 处', granularity: '句子级' }
}

function PaperView() {
  const [state, setState] = React.useState({ phase: 'loading', error: null, data: null, papers: [], paperId: null })
  // v0.2 Phase 2 interaction state:
  // - spansOverride: optimistic overlay of the visible span list (null → server data)
  // - activeSpanId / menuOpen: the selected mark and whether the action bar is open
  // - drafts: per-span note drafts (unsaved input)
  // - flash: transient notice (error on failed write / info)
  const [spansOverride, setSpansOverride] = React.useState(null)
  const [activeSpanId, setActiveSpanId] = React.useState(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [drafts, setDrafts] = React.useState({})
  const [flash, setFlash] = React.useState(null)
  // P2-d: addDraft = pending "新增高亮" {range:{anchor,char_start,char_end}, color, rationale};
  // rescueTarget = span id awaiting a "改范围" text selection (or null).
  const [addDraft, setAddDraft] = React.useState(null)
  const [rescueTarget, setRescueTarget] = React.useState(null)
  // P2-e: sectionOverrides = optimistic review status per section id
  // ({status, reviewed_at}); currentSection = id of the section in view.
  const [sectionOverrides, setSectionOverrides] = React.useState({})
  const [currentSection, setCurrentSection] = React.useState(null)
  // v0.4 Phase 4 (D6): export dialog state (open + format + include_pending).
  const [exportOpen, setExportOpen] = React.useState(false)
  const [exportFormat, setExportFormat] = React.useState('html')
  const [exportPending, setExportPending] = React.useState(false)
  // v0.5: one-click format (一键格式化) dialog state — open + in-flight.
  const [formatOpen, setFormatOpen] = React.useState(false)
  const [formatBusy, setFormatBusy] = React.useState(false)
  // v0.4 Phase 4 (D6): render-time actions/hints are published into this ref
  // (set in the ready path) so the keydown effect — declared BEFORE the early
  // returns to keep React hook order stable across the loading→ready
  // transition — always reads the freshest dispatch closures without capturing
  // them at registration time.
  const dispatchRef = React.useRef(null)
  // v0.3 Phase 1: profileState = { loading, has_profile, profile } from
  // /paper-hl/profile (full four-layer profile, colors.yml-driven palette);
  // onboard = the cold-start onboarding form draft (null unless no profile
  // exists yet). v0.3 Phase 3: panelView ('paper' | 'profile') switches to the
  // profile edit panel; panelDrafts holds its unsaved edits; newRuleText is the
  // add-rule input draft. v0.3 Phase 2: pendingProposals (from /profile
  // pending_proposals[]) drives the 待确认提案 panel; propSelections holds the
  // per-paper per-item accept/reject choices for 确认选择.
  const [profileState, setProfileState] = React.useState({ loading: true, has_profile: true, profile: null, pendingProposals: [] })
  const [onboard, setOnboard] = React.useState(null)
  const [panelView, setPanelView] = React.useState('paper')
  const [panelDrafts, setPanelDrafts] = React.useState(null)
  const [newRuleText, setNewRuleText] = React.useState('')
  const [propSelections, setPropSelections] = React.useState({})
  const loadProfile = React.useCallback(() => {
    callProfile('GET', '').then((res) => {
      setProfileState({ loading: false, has_profile: !!res.has_profile, profile: res.profile || null, pendingProposals: Array.isArray(res.pending_proposals) ? res.pending_proposals : [] })
      if (!res.has_profile) setOnboard(defaultOnboardDraft(null))
    }).catch(() => {
      // host without the profile route (or offline) → fall back to defaults
      setProfileState({ loading: false, has_profile: true, profile: null, pendingProposals: [] })
    })
  }, [])
  const load = React.useCallback((id) => {
    setState((s) => ({ ...s, phase: 'loading', error: null }))
    setSpansOverride(null)
    setMenuOpen(false)
    setAddDraft(null)
    setRescueTarget(null)
    setSectionOverrides({})
    setCurrentSection(null)
    setExportOpen(false)
    setFormatOpen(false)
    callData({ paperId: id }).then((res) => {
      if (!res || res.ok !== true) throw new Error((res && res.error) || 'paper.read failed')
      setState({ phase: 'ready', error: null, data: res, papers: res.papers || [], paperId: res.paperId })
    }).catch((err) => {
      setState((s) => ({ ...s, phase: 'error', error: String((err && err.message) || err) }))
    })
  }, [])
  React.useEffect(() => { loadProfile(); load(null) }, [loadProfile, load])

  // v0.4 Phase 4 (D6): keyboard shortcuts — keydown listener maps to review
  // actions via keyAction (paper view only, input-state ignored). No deps ⇒
  // re-registered after every render so the captured state values stay fresh;
  // the ready-path dispatch closures come from dispatchRef (always current).
  // The headless harness (no window) safely skips this.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return undefined
    const onKey = (e) => {
      const d = dispatchRef.current
      if (!d) return
      const act = keyAction(e, {
        panelView,
        menuOpen,
        activeSpanId,
        addDraft: !!addDraft,
        rescueTarget,
        currentSection,
        sectionItems: d.sectionItems || []
      }, { palette: d.palette || [] })
      if (!act) return
      if (act.type === 'cancel') {
        setMenuOpen(false); setAddDraft(null); setRescueTarget(null); setExportOpen(false); setFormatOpen(false)
      } else if (act.type === 'accept') d.applyAction({ action: 'accept', span_id: act.span_id })
      else if (act.type === 'reject') d.applyAction({ action: 'reject', span_id: act.span_id })
      else if (act.type === 'rescope') { setRescueTarget(act.span_id); setMenuOpen(false) }
      else if (act.type === 'recolor') d.applyAction({ action: 'recolor', span_id: act.span_id, color: act.color })
      else if (act.type === 'markSectionReviewed') d.markCurrentReviewed()
      else if (act.type === 'toggleExport') setExportOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (state.phase === 'loading') {
    return React.createElement('div', { className: 'phl-wrap' },
      React.createElement('div', { className: 'phl-note' }, '加载论文…'))
  }
  if (state.phase === 'error') {
    return React.createElement('div', { className: 'phl-wrap' },
      React.createElement('div', { className: 'phl-error' }, '加载失败：' + state.error),
      React.createElement('button', { className: 'phl-refresh', onClick: () => load(null) }, '重试'))
  }

  const data = state.data
  const highlights = data.highlights || {}
  // P2-b: rejected spans are excluded from rendering (but stay in the JSON
  // audit trail); the count and the body both use the visible span set. When
  // spansOverride is set (P2-c optimistic updates) it replaces the server view.
  const spans = spansOverride || excludeRejected(highlights.spans || [])
  const blocks = buildBlocks(data.anchors || {}, spans, data.sections)
  const metaTitle = (highlights.paper && highlights.paper.title) || ''
  // v0.3 Phase 1: the colors.yml-driven palette (legend / swatches / marks).
  const palette = colorLegend(profileState.profile ? profileState.profile.colors : null)

  // P2-d: the flat segment map drives selection→anchor mapping. segBaseOf maps
  // each block id to the index of its first segment in the flat list (absent
  // for blocks that produce no segments, e.g. empty text).
  const segments = buildSegmentMap(blocks)
  const segBaseOf = {}
  {
    let cursor = 0
    for (const b of blocks) {
      const n = buildBlockSegments(b.id, (b.anchor && b.anchor.text) || '', b.spans).length
      if (n > 0) segBaseOf[b.id] = cursor
      cursor += n
    }
  }

  // P2-c: clicking a mark selects it (outline) and opens the floating action
  // bar; clicking the same mark again toggles it closed. Any pending add popup
  // is dismissed (a mark click is a different context).
  const onMarkClick = (span) => {
    setAddDraft(null)
    setActiveSpanId(span.id)
    setMenuOpen((prev) => !(prev && activeSpanId === span.id))
  }

  // P2-c: dispatch one review action — optimistic local update first, then the
  // write round trip. On success the server-confirmed span reconciles the
  // overlay; on failure we notify and re-read /read to calibrate (roll back).
  const applyAction = (payload) => {
    const paperId = state.paperId
    const next = localApplySpans(spans, payload)
    setSpansOverride(next)
    setFlash(null)
    callWrite(payload, paperId).then((res) => {
      if (res && res.span && typeof res.span.id === 'string') {
        setSpansOverride((prev) => reconcileSpan(prev || next, res.span, payload))
      }
    }).catch((err) => {
      const msg = String(err && err.message ? err.message : err)
      setFlash({ kind: 'error', text: '操作失败（已回读校准）：' + msg })
      callData({ paperId }).then((res) => {
        if (res && res.ok) {
          setState((s) => ({ ...s, data: res, phase: 'ready' }))
          setSpansOverride(null)
        }
      }).catch(() => {})
    })
  }

  // P2-d: text-selection handler (mouseup on the body). A non-collapsed
  // selection is mapped back to an anchor range; depending on mode it either
  // opens the 新增高亮 popup or rescopes the active span. Collapsed selections
  // (plain clicks, incl. marks whose onClick consumed the event) are ignored.
  const onBodyMouseUp = () => {
    const sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null
    const norm = selectionToNorm(sel, segments)
    if (!norm || norm.ok === false) return
    const range = mapSelection(segments, norm)
    if (!range) return
    if (range.ok === false) {
      if (range.reason === 'cross-anchor') setFlash({ kind: 'error', text: '高亮不能跨段落选择' })
      return
    }
    if (rescueTarget) {
      const target = rescueTarget
      setRescueTarget(null)
      setMenuOpen(false)
      applyAction({ action: 'rescope', span_id: target, anchor: range.anchor, char_start: range.char_start, char_end: range.char_end })
    } else {
      setAddDraft({ range: { anchor: range.anchor, char_start: range.char_start, char_end: range.char_end }, color: 'yellow', rationale: '' })
      setMenuOpen(false)
    }
    if (sel && sel.removeAllRanges) sel.removeAllRanges()
  }

  // P2-e: reviewable section list (filtered + plan/override status merged).
  const sectionItems = sectionList(data.sections, highlights.plan, sectionOverrides)

  // P2-e: derive the section in view from the body scroll state. Reads the
  // scroll container and its block children from the scroll event target (no
  // refs needed, so the headless harness can drive it with a fake target).
  const onBodyScroll = (e) => {
    const el = e && e.target ? e.target : null
    if (!el) return
    const top = el.scrollTop || 0
    const height = el.clientHeight || 0
    const rectBase = el.getBoundingClientRect ? el.getBoundingClientRect().top : null
    const tops = []
    for (const child of (el.children || [])) {
      const anchor = child && child.dataset ? (child.dataset.phlAnchor || null) : null
      if (!anchor) continue
      let t = 0
      if (rectBase !== null && child.getBoundingClientRect) t = child.getBoundingClientRect().top - rectBase + top
      else if (typeof child.offsetTop === 'number') t = child.offsetTop + top
      tops.push({ anchorId: anchor, top: t })
    }
    setCurrentSection(currentSectionId(data.sections, tops, top, height))
  }

  // P2-e: mark the current section reviewed — optimistic ✓ first, then the
  // review_section round trip (reconcile with the server entry / re-read on
  // failure), mirroring the P2-c applyAction contract.
  const markCurrentReviewed = () => {
    const id = currentSection || (sectionItems[0] && sectionItems[0].id)
    if (!id) return
    const optimistic = { status: 'reviewed', reviewed_at: new Date().toISOString() }
    setSectionOverrides((m) => Object.assign({}, m, { [id]: optimistic }))
    setFlash(null)
    callWrite({ action: 'review_section', section: id }, state.paperId).then((res) => {
      if (res && res.section && res.section.id) {
        setSectionOverrides((m) => Object.assign({}, m, { [res.section.id]: { status: res.section.status || 'reviewed', reviewed_at: res.section.reviewed_at || null } }))
      }
    }).catch((err) => {
      const msg = String(err && err.message ? err.message : err)
      setFlash({ kind: 'error', text: '标记失败（已回读校准）：' + msg })
      callData({ paperId: state.paperId }).then((res) => {
        if (res && res.ok) { setState((s) => ({ ...s, data: res })); setSectionOverrides({}) }
      }).catch(() => {})
    })
  }

  // v0.4 Phase 4 (D6): publish the ready-path dispatch closures + hints so the
  // keydown effect (declared before the early returns) reads them fresh.
  dispatchRef.current = {
    applyAction,
    markCurrentReviewed,
    sectionItems,
    palette: palette.map((l) => l.name),
  }

  const activeSpan = menuOpen && activeSpanId ? spans.find((s) => s.id === activeSpanId) || null : null

  const renderActionBar = (span) => {
    const swatches = palette.map((l) =>
      React.createElement('button', {
        key: l.name,
        className: 'phl-ab-swatch' + (l.name === span.color ? ' phl-ab-swatch-on' : ''),
        style: { background: l.color },
        title: l.label,
        onClick: () => applyAction({ action: 'recolor', span_id: span.id, color: l.name })
      }, '')
    )
    const noteValue = drafts[span.id] !== undefined ? drafts[span.id] : (span.note || '')
    return React.createElement('div', { className: 'phl-ab' },
      React.createElement('div', { className: 'phl-ab-head' },
        React.createElement('span', { className: 'phl-ab-title' },
          span.id + ' · ' + ((palette.find((l) => l.name === span.color) || {}).label || span.color) + (span.status ? ' [' + span.status + ']' : '')),
        React.createElement('button', { className: 'phl-ab-close', onClick: () => setMenuOpen(false) }, '×')
      ),
      React.createElement('div', { className: 'phl-ab-actions' },
        React.createElement('button', { className: 'phl-ab-btn phl-ab-accept', onClick: () => applyAction({ action: 'accept', span_id: span.id }) }, '接受'),
        React.createElement('button', { className: 'phl-ab-btn phl-ab-reject', onClick: () => applyAction({ action: 'reject', span_id: span.id }) }, '删除'),
        React.createElement('button', {
          className: 'phl-ab-btn phl-ab-rescope',
          onClick: () => { setRescueTarget(span.id); setMenuOpen(false) },
          title: '选中新文本以替换本高亮范围'
        }, '改范围')
      ),
      React.createElement('div', { className: 'phl-ab-colors' }, ...swatches),
      React.createElement('div', { className: 'phl-ab-note' },
        React.createElement('input', {
          className: 'phl-ab-input',
          value: noteValue,
          placeholder: '备注…',
          onChange: (e) => setDrafts((d) => Object.assign({}, d, { [span.id]: e.target.value }))
        }),
        React.createElement('button', {
          className: 'phl-ab-btn phl-ab-note-save',
          onClick: () => applyAction({ action: 'note', span_id: span.id, note: noteValue })
        }, '保存')
      )
    )
  }

  const flashEl = flash
    ? React.createElement('div', { className: 'phl-flash' + (flash.kind === 'error' ? ' phl-flash-error' : '') }, flash.text)
    : null

  const header = React.createElement('div', { className: 'phl-header' },
    React.createElement('div', { className: 'phl-title' }, metaTitle || state.paperId),
    React.createElement('div', { className: 'phl-tools' },
      React.createElement('select', {
        className: 'phl-select',
        value: state.paperId,
        onChange: (e) => load(e.target.value)
      }, (state.papers || []).map((p) => React.createElement('option', { key: p, value: p }, p))),
      React.createElement('button', { className: 'phl-refresh', onClick: () => load(state.paperId) }, '刷新'),
      React.createElement('button', {
        className: 'phl-export-btn',
        onClick: () => setExportOpen(true),
        title: '导出高亮（HTML / Markdown，下载）'
      }, '导出'),
      React.createElement('button', {
        className: 'phl-format-btn',
        onClick: () => setFormatOpen(true),
        title: '一键格式化：清除所有论文高亮记录与个性化画像（危险操作，需二次确认）'
      }, '格式化'),
      React.createElement('button', {
        className: 'phl-profile-btn',
        onClick: () => { setPanelDrafts(profilePanelModel(profileState.profile)); setPanelView('profile') },
        title: '查看 / 编辑个性化画像（四层）'
      }, '画像'),
      React.createElement('button', {
        className: 'phl-prop-btn',
        onClick: () => { setPropSelections({}); setPanelView('proposals') },
        title: profileState.pendingProposals.length > 0 ? ('待确认画像提案 ' + profileState.pendingProposals.length + ' 条') : '没有待确认的画像提案'
      }, '提案' + (profileState.pendingProposals.length > 0 ? ' (' + profileState.pendingProposals.length + ')' : '')),
      React.createElement('button', {
        className: 'phl-review-btn',
        onClick: markCurrentReviewed,
        disabled: !currentSection && !(sectionItems[0]),
        title: currentSection
          ? ('标记当前节审查完毕：' + ((sectionItems.find((s) => s.id === currentSection) || {}).title || currentSection))
          : '滚动到要标记的节'
      }, '标记本节审查完毕')
    )
  )
  const legend = React.createElement('div', { className: 'phl-legend' },
    React.createElement('span', { className: 'phl-count' }, blocks.length + ' 段 · ' + spans.length + ' 处高亮'),
    palette.map((l) => React.createElement('span', { key: l.name, className: 'phl-legend-item' },
      React.createElement('mark', { style: { background: l.color } }, ' '),
      React.createElement('span', { className: 'phl-legend-label', style: { color: l.color } }, l.label)
    ))
  )
  // v0.4 Phase 4 (D6): review progress bar + next-unreviewed hint (passive; no
  // scroll navigation). progress derives from sectionItems (plan + optimistic
  // overrides merged by sectionList), so it updates live as sections are marked.
  const progress = reviewProgress(sectionItems)
  const progressBar = React.createElement('div', { className: 'phl-progress' },
    React.createElement('span', { className: 'phl-progress-text' }, '已审 ' + progress.done + '/' + progress.total + ' 节'),
    React.createElement('div', { className: 'phl-progress-track' },
      React.createElement('div', { className: 'phl-progress-fill', style: { width: progress.ratio + '%' } })
    ),
    progress.nextId
      ? React.createElement('span', { className: 'phl-progress-next' },
          '下一个：' + (((sectionItems.find((s) => s.id === progress.nextId) || {}).title) || progress.nextId))
      : React.createElement('span', { className: 'phl-progress-next phl-progress-done' }, '全部节已审查 ✓')
  )
  // v0.4 Phase 4 (D6): export dialog — format (HTML/MD) + include_pending + a
  // download link into GET /paper-hl/export?…&download=1 (Phase 1 route).
  const exportDialog = exportOpen
    ? React.createElement('div', { className: 'phl-exp' },
        React.createElement('div', { className: 'phl-exp-head' },
          React.createElement('span', { className: 'phl-exp-title' }, '导出高亮'),
          React.createElement('button', { className: 'phl-ab-close', onClick: () => setExportOpen(false) }, '×')
        ),
        React.createElement('div', { className: 'phl-exp-format' },
          ['html', 'md'].map((f) =>
            React.createElement('label', { key: f, className: 'phl-exp-opt' },
              React.createElement('input', {
                type: 'radio',
                name: 'phl-exp-format',
                checked: exportFormat === f,
                onChange: () => setExportFormat(f)
              }),
              ' ' + (f === 'html' ? 'HTML' : 'Markdown')
            )
          )
        ),
        React.createElement('label', { className: 'phl-exp-opt' },
          React.createElement('input', {
            type: 'checkbox',
            checked: exportPending,
            onChange: (e) => setExportPending(e.target.checked)
          }),
          ' 包含未决（proposed）高亮'
        ),
        React.createElement('div', { className: 'phl-exp-actions' },
          React.createElement('button', { className: 'phl-exp-btn', onClick: () => setExportOpen(false) }, '取消'),
          React.createElement('a', {
            className: 'phl-exp-btn phl-exp-download',
            href: buildExportUrl(state.paperId, exportFormat, exportPending, true),
            download: true,
            onClick: () => setExportOpen(false),
            'data-phl-export-url': buildExportUrl(state.paperId, exportFormat, exportPending, true)
          }, '下载')
        )
      )
    : null
  // v0.5: one-click format (一键格式化) dialog — a deliberate danger action.
  // The dialog itself is the confirmation step; 确认格式化 POSTs
  // /paper-hl/format with {confirm:true, scope:'all'} (the host rejects any
  // request without confirm:true). On success the paper + profile reload so
  // the GUI returns to a factory-fresh state (cold-start onboarding).
  const confirmFormat = () => {
    setFormatBusy(true)
    setFlash(null)
    callFormat({ confirm: true, scope: 'all' }).then(() => {
      setFormatOpen(false)
      setFormatBusy(false)
      setFlash({ kind: 'info', text: '已格式化：论文高亮记录与个性化画像已清除，可重新开始高亮' })
      loadProfile()
      load(state.paperId)
    }).catch((err) => {
      setFormatBusy(false)
      setFlash({ kind: 'error', text: '格式化失败：' + String((err && err.message) || err) })
    })
  }
  const formatDialog = formatOpen
    ? React.createElement('div', { className: 'phl-fmt', 'data-phl-format': '1' },
        React.createElement('div', { className: 'phl-fmt-head' },
          React.createElement('span', { className: 'phl-fmt-title' }, '一键格式化（危险操作）'),
          React.createElement('button', { className: 'phl-ab-close', onClick: () => setFormatOpen(false) }, '×')
        ),
        React.createElement('p', { className: 'phl-fmt-warn' }, '将清除：'),
        React.createElement('ul', { className: 'phl-fmt-list' },
          React.createElement('li', null, '所有论文的高亮记录（spans / 计划 / 去重 / reflections 提案 / 导出产物 / 论文级反思）'),
          React.createElement('li', null, '个性化画像（highlight-profile/，之后将回到冷启动引导）')
        ),
        React.createElement('p', { className: 'phl-fmt-note' }, '已解析的论文正文（paper.md / anchors）会保留，可立即重新高亮。此操作不可撤销。'),
        React.createElement('div', { className: 'phl-fmt-actions' },
          React.createElement('button', { className: 'phl-fmt-btn', onClick: () => setFormatOpen(false) }, '取消'),
          React.createElement('button', {
            className: 'phl-fmt-btn phl-fmt-danger',
            disabled: formatBusy,
            onClick: confirmFormat
          }, formatBusy ? '格式化中…' : '确认格式化')
        )
      )
    : null
  // P2-e: reviewable section bar (✓ on reviewed, highlight on the section in view).
  const sectionBar = React.createElement('div', { className: 'phl-sections' },
    sectionItems.map((s) =>
      React.createElement('div', {
        key: s.id,
        className: 'phl-section' + (s.reviewed ? ' phl-section-done' : '') + (s.id === currentSection ? ' phl-section-curr' : ''),
        'data-phl-sec': s.id,
        title: (s.reviewed ? '✓ 已审查' : '待审查') + ' · ' + s.title
      },
        React.createElement('span', { className: 'phl-section-check' }, s.reviewed ? '✓' : ''),
        React.createElement('span', { className: 'phl-section-title' }, s.title)
      )
    )
  )
  const body = React.createElement('div', { className: 'phl-body', onMouseUp: onBodyMouseUp, onScroll: onBodyScroll },
    blocks.map((b) => {
      const segBase = segBaseOf[b.id]
      const kids = renderText(b.anchor.text, b.spans, { onMarkClick, activeSpanId, withSegments: segBase !== undefined, segBase: segBase || 0, anchorId: b.id, colors: profileState.profile ? profileState.profile.colors : null })
      const blockProps = { key: b.id, 'data-phl-anchor': b.id }
      if (b.anchor.type === 'title') {
        return React.createElement(b.isFirstTitle ? 'h1' : 'h2', Object.assign(blockProps, { className: 'phl-heading' }), ...kids)
      }
      return React.createElement('p', Object.assign(blockProps, { className: 'phl-para' }), ...kids)
    })
  )

  // P2-d: 改范围 hint bar — shown while a rescope selection is pending.
  const rescueHint = rescueTarget
    ? React.createElement('div', { className: 'phl-hint' },
        React.createElement('span', null, '请选择新文本以更改 ' + rescueTarget + ' 的高亮范围'),
        React.createElement('button', { className: 'phl-refresh', onClick: () => setRescueTarget(null) }, '取消')
      )
    : null

  // P2-d: 新增高亮 popup — color + rationale for the pending selection range.
  const addPopup = addDraft
    ? React.createElement('div', { className: 'phl-add' },
        React.createElement('div', { className: 'phl-add-head' },
          React.createElement('span', { className: 'phl-add-title' }, '新增高亮'),
          React.createElement('button', { className: 'phl-ab-close', onClick: () => setAddDraft(null) }, '×')
        ),
        React.createElement('div', { className: 'phl-add-colors' }, ...palette.map((l) =>
          React.createElement('button', {
            key: l.name,
            className: 'phl-add-swatch' + (l.name === addDraft.color ? ' phl-ab-swatch-on' : ''),
            style: { background: l.color },
            title: l.label,
            onClick: () => setAddDraft((d) => Object.assign({}, d, { color: l.name }))
          }, '')
        )),
        React.createElement('input', {
          className: 'phl-add-input',
          value: addDraft.rationale,
          placeholder: '理由…',
          onChange: (e) => setAddDraft((d) => Object.assign({}, d, { rationale: e.target.value }))
        }),
        React.createElement('div', { className: 'phl-add-actions' },
          React.createElement('button', { className: 'phl-add-btn', onClick: () => setAddDraft(null) }, '取消'),
          React.createElement('button', {
            className: 'phl-add-btn phl-add-confirm',
            onClick: () => {
              const d = addDraft
              applyAction({ action: 'add', anchor: d.range.anchor, char_start: d.range.char_start, char_end: d.range.char_end, color: d.color, rationale: d.rationale, clientId: 'local-add-' + Date.now() })
              setAddDraft(null)
            }
          }, '添加')
        )
      )
    : null

  // v0.3 Phase 1: cold-start onboarding (D6) — shown only when no profile
  // exists yet. Collects color semantics + density/granularity baseline and
  // POSTs /paper-hl/profile/init to create colors.yml + initial rules.json.
  const confirmInit = () => {
    const d = onboard || defaultOnboardDraft(null)
    callProfile('POST', '/init', {
      colors: d.colors,
      rules: [
        { rule: 'density_per_section: ' + d.density, enabled: true },
        { rule: 'granularity: ' + d.granularity, enabled: true },
      ],
    }).then(() => {
      setFlash({ kind: 'info', text: '画像初始化完成' })
      loadProfile()
    }).catch((err) => {
      setFlash({ kind: 'error', text: '初始化失败：' + String((err && err.message) || err) })
    })
  }
  const renderOnboarding = () => {
    const draft = onboard || defaultOnboardDraft(null)
    const patchColor = (name, field, value) => {
      setOnboard((d) => {
        const cur = d || defaultOnboardDraft(null)
        return Object.assign({}, cur, { colors: Object.assign({}, cur.colors, { [name]: Object.assign({}, cur.colors[name], { [field]: value }) }) })
      })
    }
    const patchMeta = (field, value) => setOnboard((d) => Object.assign({}, d || defaultOnboardDraft(null), { [field]: value }))
    const colorRows = Object.keys(draft.colors).map((name) => {
      const c = draft.colors[name]
      return React.createElement('div', { key: name, className: 'phl-onb-row' },
        React.createElement('span', { className: 'phl-onb-name' }, name),
        React.createElement('input', { className: 'phl-onb-hex', value: c.color, onChange: (e) => patchColor(name, 'color', e.target.value) }),
        React.createElement('input', { className: 'phl-onb-label', value: c.label, onChange: (e) => patchColor(name, 'label', e.target.value) })
      )
    })
    return React.createElement('div', { className: 'phl-onb' },
      React.createElement('h2', { className: 'phl-onb-title' }, '初始化高亮画像'),
      React.createElement('p', { className: 'phl-onb-desc' }, '先声明你的颜色语义与密度/粒度基线，之后 Agent 的 propose 将按此收敛；可在「画像」面板随时修改。'),
      React.createElement('div', { className: 'phl-onb-colors' },
        React.createElement('div', { className: 'phl-onb-colors-head' },
          React.createElement('span', { className: 'phl-onb-name' }, '颜色'),
          React.createElement('span', { className: 'phl-onb-hex' }, '色值'),
          React.createElement('span', { className: 'phl-onb-label' }, '语义')
        ),
        ...colorRows
      ),
      React.createElement('div', { className: 'phl-onb-meta' },
        React.createElement('label', { className: 'phl-onb-field' },
          React.createElement('span', null, '每节密度基线'),
          React.createElement('select', {
            className: 'phl-onb-select',
            value: draft.density,
            onChange: (e) => patchMeta('density', e.target.value)
          },
            React.createElement('option', { value: '每节 2-4 处' }, '每节 2-4 处'),
            React.createElement('option', { value: '每节 3-5 处' }, '每节 3-5 处'),
            React.createElement('option', { value: '每节 4-6 处' }, '每节 4-6 处')
          )
        ),
        React.createElement('label', { className: 'phl-onb-field' },
          React.createElement('span', null, '高亮粒度'),
          React.createElement('select', {
            className: 'phl-onb-select',
            value: draft.granularity,
            onChange: (e) => patchMeta('granularity', e.target.value)
          },
            React.createElement('option', { value: '短语级' }, '短语级'),
            React.createElement('option', { value: '句子级' }, '句子级'),
            React.createElement('option', { value: '段落级' }, '段落级')
          )
        )
      ),
      React.createElement('div', { className: 'phl-onb-actions' },
        React.createElement('button', { className: 'phl-onb-btn phl-onb-confirm', onClick: confirmInit }, '初始化画像')
      )
    )
  }

  // v0.3 Phase 3: profile edit panel — four layers viewable/editable
  // (stats read-only). Drafts are local; 保存全部 POSTs /paper-hl/profile/save
  // (profileSavePayload) and re-reads the profile (optimistic + calibrate).
  const confirmProfileSave = () => {
    const d = panelDrafts
    if (!d) return
    callProfile('POST', '/save', profileSavePayload(d)).then(() => {
      setFlash({ kind: 'info', text: '画像已保存' })
      loadProfile()
    }).catch((err) => {
      setFlash({ kind: 'error', text: '保存失败：' + String((err && err.message) || err) })
    })
  }
  const renderProfilePanel = () => {
    const d = panelDrafts || profilePanelModel(profileState.profile)
    const patchColors = (name, field, value) => setPanelDrafts((p) => {
      const cur = p || profilePanelModel(profileState.profile)
      return Object.assign({}, cur, { colors: cur.colors.map((r) => (r.name === name ? Object.assign({}, r, { [field]: value }) : r)) })
    })
    const patchRule = (i, field, value) => setPanelDrafts((p) => {
      const cur = p || profilePanelModel(profileState.profile)
      const rules = cur.rules.slice()
      rules[i] = Object.assign({}, rules[i], { [field]: value })
      return Object.assign({}, cur, { rules })
    })
    const removeRule = (i) => setPanelDrafts((p) => {
      const cur = p || profilePanelModel(profileState.profile)
      return Object.assign({}, cur, { rules: cur.rules.filter((_, j) => j !== i) })
    })
    const addRule = () => {
      const text = newRuleText.trim()
      if (!text) return
      setPanelDrafts((p) => {
        const cur = p || profilePanelModel(profileState.profile)
        return Object.assign({}, cur, { rules: cur.rules.concat([{ rule: text, confidence: 'medium', enabled: true, source: 'user-edit' }]) })
      })
      setNewRuleText('')
    }
    const removeExemplar = (i) => setPanelDrafts((p) => {
      const cur = p || profilePanelModel(profileState.profile)
      return Object.assign({}, cur, { exemplars: cur.exemplars.filter((_, j) => j !== i) })
    })

    const colorRows = d.colors.map((c) =>
      React.createElement('div', { key: c.name, className: 'phl-pnl-row', 'data-phl-color': c.name },
        React.createElement('span', { className: 'phl-pnl-name' }, c.name),
        React.createElement('input', { className: 'phl-pnl-hex', value: c.color, onChange: (e) => patchColors(c.name, 'color', e.target.value) }),
        React.createElement('input', { className: 'phl-pnl-label', value: c.label, onChange: (e) => patchColors(c.name, 'label', e.target.value) })
      )
    )

    const ruleRows = d.rules.map((r, i) =>
      React.createElement('div', { key: r.id || ('new-' + i), className: 'phl-pnl-row', 'data-phl-rule': r.id || '' },
        React.createElement('input', {
          type: 'checkbox',
          className: 'phl-pnl-rule-on',
          checked: r.enabled !== false,
          onChange: (e) => patchRule(i, 'enabled', e.target.checked),
          title: '启用/禁用'
        }),
        React.createElement('input', { className: 'phl-pnl-rule-text', value: r.rule, onChange: (e) => patchRule(i, 'rule', e.target.value) }),
        React.createElement('select', {
          className: 'phl-pnl-conf',
          value: r.confidence || 'medium',
          onChange: (e) => patchRule(i, 'confidence', e.target.value)
        },
          React.createElement('option', { value: 'low' }, 'low'),
          React.createElement('option', { value: 'medium' }, 'medium'),
          React.createElement('option', { value: 'high' }, 'high')
        ),
        React.createElement('button', { className: 'phl-pnl-del', onClick: () => removeRule(i), title: '删除规则' }, '×')
      )
    )

    const exemplarRows = d.exemplars.length === 0
      ? React.createElement('div', { className: 'phl-pnl-empty' }, '（暂无示例，确认提案后自动入库）')
      : d.exemplars.map((e, i) =>
          React.createElement('div', { key: i, className: 'phl-pnl-row', 'data-phl-ex': String(i) },
            React.createElement('span', { className: 'phl-pnl-ex-summary' },
              (e.span_id || '?') + ' · ' + ((e.user_decision && (e.user_decision.color || e.user_decision.action)) || '?') + (e.note ? ' — ' + e.note : '')),
            React.createElement('button', { className: 'phl-pnl-del', onClick: () => removeExemplar(i), title: '删除示例' }, '×')
          )
        )

    const stats = d.stats || { papers: [], overall: null }
    const statsOverall = stats.overall
      ? React.createElement('div', { className: 'phl-pnl-stats-overall' },
          '累计：' + stats.overall.papers_reviewed + ' 篇 · 认可率 ' + Math.round(stats.overall.approve_rate * 100) + '% · 修改率 ' + Math.round(stats.overall.modify_rate * 100) + '%')
      : React.createElement('div', { className: 'phl-pnl-empty' }, '（暂无统计）')
    const statsRows = (stats.papers || []).map((p) =>
      React.createElement('div', { key: p.paper_id, className: 'phl-pnl-row phl-pnl-stats-row' },
        React.createElement('span', { className: 'phl-pnl-stats-paper' }, p.paper_id),
        React.createElement('span', null, '认可率 ' + Math.round((p.approve_rate || 0) * 100) + '%'),
        React.createElement('span', null, '修改率 ' + Math.round((p.modify_rate || 0) * 100) + '%'),
        React.createElement('span', { className: 'phl-pnl-stats-kinds' },
          'acc ' + ((p.change_kinds && p.change_kinds.accepted) || 0) + ' / rej ' + ((p.change_kinds && p.change_kinds.rejected) || 0) +
          ' / rec ' + ((p.change_kinds && p.change_kinds.recolored) || 0) + ' / res ' + ((p.change_kinds && p.change_kinds.rescoped) || 0))
      )
    )

    return React.createElement('div', { className: 'phl-pnl' },
      React.createElement('div', { className: 'phl-pnl-head' },
        React.createElement('h2', { className: 'phl-pnl-title' }, '个性化画像（四层）'),
        React.createElement('button', { className: 'phl-refresh', onClick: () => setPanelView('paper') }, '← 返回论文')
      ),
      React.createElement('section', { className: 'phl-pnl-sec' },
        React.createElement('h3', { className: 'phl-pnl-sec-title' }, 'L1 · 颜色语义（colors.yml）'),
        React.createElement('div', { className: 'phl-pnl-row phl-pnl-headrow' },
          React.createElement('span', { className: 'phl-pnl-name' }, '颜色'),
          React.createElement('span', { className: 'phl-pnl-hex' }, '色值'),
          React.createElement('span', { className: 'phl-pnl-label' }, '语义')
        ),
        ...colorRows
      ),
      React.createElement('section', { className: 'phl-pnl-sec' },
        React.createElement('h3', { className: 'phl-pnl-sec-title' }, 'L2 · 规则（rules.json，仅用户确认的规则在此）'),
        ...ruleRows,
        React.createElement('div', { className: 'phl-pnl-addrule' },
          React.createElement('input', { className: 'phl-pnl-rule-text phl-pnl-rule-new', value: newRuleText, placeholder: '新规则文本…', onChange: (e) => setNewRuleText(e.target.value) }),
          React.createElement('button', { className: 'phl-pnl-addrule-btn', onClick: addRule }, '添加规则')
        )
      ),
      React.createElement('section', { className: 'phl-pnl-sec' },
        React.createElement('h3', { className: 'phl-pnl-sec-title' }, 'L3 · 示例库（exemplars.json，仅参考信号）'),
        ...exemplarRows
      ),
      React.createElement('section', { className: 'phl-pnl-sec' },
        React.createElement('h3', { className: 'phl-pnl-sec-title' }, 'L4a · 统计（stats.json，只读）'),
        statsOverall,
        ...statsRows
      ),
      React.createElement('section', { className: 'phl-pnl-sec' },
        React.createElement('h3', { className: 'phl-pnl-sec-title' }, 'L4b · 反思笔记（reflection-notes.md）'),
        React.createElement('textarea', {
          className: 'phl-pnl-notes',
          value: d.notes,
          onChange: (e) => setPanelDrafts((p) => Object.assign({}, p || profilePanelModel(profileState.profile), { notes: e.target.value }))
        })
      ),
      React.createElement('div', { className: 'phl-pnl-actions' },
        React.createElement('button', { className: 'phl-pnl-save', onClick: confirmProfileSave }, '保存全部')
      )
    )
  }

  // v0.3 Phase 2: pending-proposal confirmation panel. Each paper's reflect
  // proposal (from /profile pending_proposals[]) is a card with rule/exemplar
  // rows; per-item 接受/否决 toggles feed 确认选择 (buildApplyDecisions), plus
  // 全部接受 / 全部否决 shortcuts. All merges run host-side (applyProposal).
  const applyProposalDecision = (paperId, decisions) => {
    callProfile('POST', '/apply?paperId=' + encodeURIComponent(paperId), { decisions }).then(() => {
      setFlash({ kind: 'info', text: '提案已确认：' + paperId })
      setPropSelections((s) => { const n = Object.assign({}, s); delete n[paperId]; return n })
      loadProfile()
    }).catch((err) => {
      setFlash({ kind: 'error', text: '确认失败：' + String((err && err.message) || err) })
    })
  }
  const renderProposalsPanel = () => {
    const pending = profileState.pendingProposals || []
    const cards = pending.map((p) => {
      const card = proposalCardModel(p)
      const sel = propSelections[card.paper_id] || { accept: [], reject: [] }
      const inList = (list, id) => list.indexOf(id) >= 0
      const toggle = (listName, id) => setPropSelections((s) => {
        const cur = s[card.paper_id] || { accept: [], reject: [] }
        const next = { accept: cur.accept.slice(), reject: cur.reject.slice() }
        const other = listName === 'accept' ? 'reject' : 'accept'
        next[listName] = inList(next[listName], id) ? next[listName].filter((x) => x !== id) : next[listName].concat([id])
        next[other] = next[other].filter((x) => x !== id)
        return Object.assign({}, s, { [card.paper_id]: next })
      })
      const itemBtn = (id, kind, label) =>
        React.createElement('button', {
          className: 'phl-prop-item' + (inList(sel[kind], id) ? ' phl-prop-item-on' : ''),
          'data-phl-prop': id,
          onClick: () => toggle(kind, id),
          title: kind === 'accept' ? '接受该项（并入画像）' : '否决该项'
        }, label)
      const ruleRows = card.rules.map((r) =>
        React.createElement('div', { key: r.id, className: 'phl-prop-row' },
          React.createElement('span', { className: 'phl-prop-text' }, r.text),
          React.createElement('span', { className: 'phl-prop-conf' }, r.confidence || ''),
          itemBtn(r.id, 'accept', '接受'),
          itemBtn(r.id, 'reject', '否决')
        )
      )
      const exRows = card.exemplars.map((e) =>
        React.createElement('div', { key: e.id, className: 'phl-prop-row' },
          React.createElement('span', { className: 'phl-prop-text' }, e.summary),
          itemBtn(e.id, 'accept', '接受'),
          itemBtn(e.id, 'reject', '否决')
        )
      )
      return React.createElement('div', { key: card.paper_id, className: 'phl-prop-card', 'data-phl-paper': card.paper_id },
        React.createElement('div', { className: 'phl-prop-head' },
          React.createElement('span', { className: 'phl-prop-paper' }, card.paper_id),
          React.createElement('span', { className: 'phl-prop-stats' }, card.stats_text)
        ),
        React.createElement('div', { className: 'phl-prop-sec' },
          React.createElement('span', { className: 'phl-prop-sec-title' }, '规则（' + card.rules.length + '）'),
          ...ruleRows
        ),
        React.createElement('div', { className: 'phl-prop-sec' },
          React.createElement('span', { className: 'phl-prop-sec-title' }, '示例（' + card.exemplars.length + '）'),
          ...exRows
        ),
        React.createElement('div', { className: 'phl-prop-actions' },
          React.createElement('button', { className: 'phl-prop-btn2', onClick: () => applyProposalDecision(card.paper_id, { accept: 'all' }) }, '全部接受'),
          React.createElement('button', { className: 'phl-prop-btn2', onClick: () => applyProposalDecision(card.paper_id, { reject: 'all' }) }, '全部否决'),
          React.createElement('button', {
            className: 'phl-prop-btn2 phl-prop-confirm',
            onClick: () => {
              const decisions = buildApplyDecisions(sel.accept, sel.reject)
              if (!decisions.accept && !decisions.reject) {
                setFlash({ kind: 'error', text: '请先选择要接受/否决的条目' })
                return
              }
              applyProposalDecision(card.paper_id, decisions)
            }
          }, '确认选择（' + (sel.accept.length + sel.reject.length) + '）')
        )
      )
    })
    return React.createElement('div', { className: 'phl-pnl' },
      React.createElement('div', { className: 'phl-pnl-head' },
        React.createElement('h2', { className: 'phl-pnl-title' }, '待确认画像提案' + (pending.length ? '（' + pending.length + '）' : '')),
        React.createElement('button', { className: 'phl-refresh', onClick: () => setPanelView('paper') }, '← 返回论文')
      ),
      pending.length === 0
        ? React.createElement('div', { className: 'phl-pnl-empty' }, '没有待确认的画像提案（reflect 产出 reflections.json 后出现）')
        : React.createElement('div', { className: 'phl-prop-list' }, ...cards)
    )
  }

  const actionBar = activeSpan ? renderActionBar(activeSpan) : null
  // v0.3 Phase 1: cold start → onboarding panel replaces the paper view.
  if (!profileState.loading && !profileState.has_profile) {
    return React.createElement('div', { className: 'phl-wrap' }, flashEl, renderOnboarding())
  }
  // v0.3 Phase 3: profile edit panel view.
  if (panelView === 'profile') {
    return React.createElement('div', { className: 'phl-wrap' }, flashEl, renderProfilePanel())
  }
  // v0.3 Phase 2: pending-proposal confirmation panel view.
  if (panelView === 'proposals') {
    return React.createElement('div', { className: 'phl-wrap' }, flashEl, renderProposalsPanel())
  }
  return React.createElement('div', { className: 'phl-wrap' }, header, legend, progressBar, sectionBar, flashEl, rescueHint, addPopup, exportDialog, formatDialog, actionBar, body)
}

const inject = ['slots']

function apply(ctx) {
  ctx.effect(() => {
    styles.insert([
      '.phl-wrap{display:flex;flex-direction:column;height:100%;min-height:0;padding:16px 20px;overflow:hidden;font-size:14px;line-height:1.65}',
      '.phl-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap}',
      '.phl-title{font-size:17px;font-weight:600;margin:0}',
      '.phl-tools{display:flex;align-items:center;gap:8px}',
      '.phl-select{max-width:260px;padding:4px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px}',
      '.phl-refresh{padding:4px 10px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-refresh:hover{background:rgba(128,128,128,.12)}',
      '.phl-review-btn{padding:4px 10px;border-radius:6px;border:1px solid rgba(120,220,130,.7);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-review-btn:hover:not(:disabled){background:rgba(120,220,130,.14)}',
      '.phl-review-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.phl-export-btn{padding:4px 10px;border-radius:6px;border:1px solid rgba(255,190,120,.7);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-export-btn:hover{background:rgba(255,190,120,.14)}',
      '.phl-progress{display:flex;align-items:center;gap:8px;padding:4px 0 8px;border-bottom:1px solid rgba(128,128,128,.25);margin-bottom:10px;font-size:12px;color:rgba(128,128,128,.9)}',
      '.phl-progress-text{flex:0 0 auto;font-weight:600}',
      '.phl-progress-track{flex:0 1 220px;height:6px;border-radius:3px;background:rgba(128,128,128,.2);overflow:hidden}',
      '.phl-progress-fill{height:100%;background:rgba(120,220,130,.85);border-radius:3px;transition:width .2s}',
      '.phl-progress-next{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(160,230,170,.9)}',
      '.phl-progress-done{color:rgba(120,220,130,.9)}',
      '.phl-exp{position:fixed;top:60px;right:12px;z-index:22;width:260px;padding:10px 12px;border-radius:8px;background:rgba(30,30,30,.94);color:#f5f5f5;border:1px solid rgba(255,255,255,.2);box-shadow:0 4px 14px rgba(0,0,0,.35);font-size:12px;line-height:1.5}',
      '.phl-exp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
      '.phl-exp-title{font-weight:600}',
      '.phl-exp-format{display:flex;gap:14px;margin-bottom:6px}',
      '.phl-exp-opt{display:flex;align-items:center;gap:4px;cursor:pointer}',
      '.phl-exp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}',
      '.phl-exp-btn{padding:4px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:12px;cursor:pointer;text-decoration:none}',
      '.phl-exp-btn:hover{background:rgba(128,128,128,.12)}',
      '.phl-exp-download{border-color:rgba(120,220,130,.8)}',
      '.phl-format-btn{padding:4px 10px;border-radius:6px;border:1px solid rgba(240,120,120,.7);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-format-btn:hover{background:rgba(240,120,120,.14)}',
      '.phl-fmt{position:fixed;top:60px;right:12px;z-index:23;width:320px;padding:10px 12px;border-radius:8px;background:rgba(40,24,24,.96);color:#f5f5f5;border:1px solid rgba(240,120,120,.6);box-shadow:0 4px 14px rgba(0,0,0,.4);font-size:12px;line-height:1.5}',
      '.phl-fmt-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
      '.phl-fmt-title{font-weight:600;color:#ffb3b3}',
      '.phl-fmt-warn{margin:0 0 4px;font-weight:600}',
      '.phl-fmt-list{margin:0 0 8px;padding-left:18px}',
      '.phl-fmt-list li{margin-bottom:3px}',
      '.phl-fmt-note{margin:0 0 10px;color:rgba(235,200,200,.85)}',
      '.phl-fmt-actions{display:flex;gap:8px;justify-content:flex-end}',
      '.phl-fmt-btn{padding:4px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-fmt-btn:hover{background:rgba(128,128,128,.12)}',
      '.phl-fmt-danger{border-color:rgba(240,120,120,.85);color:#ffb3b3}',
      '.phl-fmt-danger:hover:not(:disabled){background:rgba(240,120,120,.16)}',
      '.phl-fmt-danger:disabled{opacity:.5;cursor:not-allowed}',
      '.phl-legend{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid rgba(128,128,128,.25);margin-bottom:10px;font-size:12px;color:rgba(128,128,128,.9)}',
      '.phl-legend-item{display:inline-flex;align-items:center;gap:4px}',
      // v0.5.1: the semantic label renders in its own highlight color.
      '.phl-legend-label{white-space:nowrap;font-weight:600;opacity:.95}',
      // v0.5.1: lightweight math — serif-italic glyphs with a faint tint.
      '.phl-math{font-family:Georgia,"Times New Roman",serif;font-style:italic;color:#dcdcdc;padding:0 2px;border-radius:3px;background:rgba(96,130,190,.12)}',
      '.phl-math-display{display:block;text-align:center;font-size:1.05em;margin:6px 0;padding:5px 8px;background:rgba(96,130,190,.14);border-radius:6px}',
      '.phl-count{margin-right:auto;opacity:.8}',
      '.phl-body{flex:1;min-height:0;overflow-y:auto;padding-right:6px}',
      '.phl-heading{margin:14px 0 8px;line-height:1.4}',
      '.phl-para{margin:0 0 10px;white-space:pre-wrap;word-break:break-word}',
      '.phl-note{color:rgba(128,128,128,.85)}',
      '.phl-error{color:#e05a5a;margin-bottom:8px}',
      '.phl-flash{position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:30;max-width:70%;padding:6px 14px;border-radius:6px;background:rgba(40,40,40,.92);color:#f5f5f5;font-size:12px;box-shadow:0 2px 10px rgba(0,0,0,.3)}',
      '.phl-flash-error{background:rgba(150,50,50,.95)}',
      '.phl-ab{position:fixed;top:60px;right:12px;z-index:20;width:230px;padding:8px 10px;border-radius:8px;background:rgba(30,30,30,.88);color:#f5f5f5;border:1px solid rgba(255,255,255,.2);box-shadow:0 4px 14px rgba(0,0,0,.35);font-size:12px;line-height:1.4}',
      '.phl-ab-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}',
      '.phl-ab-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.phl-ab-close{border:none;background:transparent;color:inherit;font-size:15px;cursor:pointer;padding:0 2px;line-height:1}',
      '.phl-ab-actions{display:flex;gap:6px;margin-bottom:6px}',
      '.phl-ab-btn{padding:3px 10px;border-radius:5px;border:1px solid rgba(255,255,255,.35);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-ab-btn:hover{background:rgba(255,255,255,.14)}',
      '.phl-ab-accept{border-color:rgba(120,220,130,.8)}',
      '.phl-ab-reject{border-color:rgba(240,120,120,.8)}',
      '.phl-ab-rescope{border-color:rgba(255,190,120,.8)}',
      '.phl-ab-colors{display:flex;gap:6px;margin-bottom:6px}',
      '.phl-ab-swatch{width:20px;height:20px;border-radius:4px;border:1px solid rgba(255,255,255,.5);cursor:pointer;padding:0}',
      '.phl-ab-swatch-on{outline:2px solid #fff;outline-offset:1px}',
      '.phl-ab-note{display:flex;gap:6px}',
      '.phl-ab-input{flex:1;min-width:0;padding:3px 6px;border-radius:5px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:inherit;font-size:12px}',
      '.phl-ab-note-save{border-color:rgba(150,190,255,.8)}',
      '.phl-hint{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;padding:6px 10px;border-radius:6px;background:rgba(255,190,120,.12);border:1px solid rgba(255,190,120,.5);color:#ffd9a0;font-size:12px}',
      '.phl-add{position:fixed;top:60px;right:12px;z-index:21;width:250px;padding:8px 10px;border-radius:8px;background:rgba(30,30,30,.92);color:#f5f5f5;border:1px solid rgba(255,255,255,.2);box-shadow:0 4px 14px rgba(0,0,0,.35);font-size:12px;line-height:1.4}',
      '.phl-add-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}',
      '.phl-add-title{font-weight:600}',
      '.phl-add-colors{display:flex;gap:6px;margin-bottom:6px}',
      '.phl-add-swatch{width:20px;height:20px;border-radius:4px;border:1px solid rgba(255,255,255,.5);cursor:pointer;padding:0}',
      '.phl-add-input{width:100%;box-sizing:border-box;padding:3px 6px;border-radius:5px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:inherit;font-size:12px;margin-bottom:8px}',
      '.phl-add-actions{display:flex;gap:6px;justify-content:flex-end}',
      '.phl-add-btn{padding:3px 10px;border-radius:5px;border:1px solid rgba(255,255,255,.35);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-add-btn:hover{background:rgba(255,255,255,.14)}',
      '.phl-add-confirm{border-color:rgba(120,220,130,.8)}',
      '.phl-sections{display:flex;gap:6px;overflow-x:auto;padding:6px 0 8px;border-bottom:1px solid rgba(128,128,128,.25);margin-bottom:10px;font-size:11px;scrollbar-width:thin}',
      '.phl-section{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;max-width:220px;padding:3px 8px;border-radius:10px;border:1px solid rgba(128,128,128,.35);background:transparent;color:rgba(128,128,128,.9);cursor:default;white-space:nowrap;overflow:hidden}',
      '.phl-section-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.phl-section-check{font-weight:700;flex:0 0 auto}',
      '.phl-section-done{border-color:rgba(120,220,130,.6);color:rgba(160,230,170,.95);background:rgba(120,220,130,.08)}',
      '.phl-section-curr{border-color:rgba(150,190,255,.7);color:#dce8ff;background:rgba(150,190,255,.12)}',
      '.phl-onb{max-width:560px;margin:40px auto 0;padding:20px 24px;border-radius:10px;border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.06)}',
      '.phl-onb-title{margin:0 0 6px;font-size:16px}',
      '.phl-onb-desc{margin:0 0 14px;color:rgba(128,128,128,.9);font-size:12px}',
      '.phl-onb-colors{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}',
      '.phl-onb-colors-head{display:grid;grid-template-columns:90px 120px 1fr;gap:8px;font-size:11px;color:rgba(128,128,128,.8)}',
      '.phl-onb-row{display:grid;grid-template-columns:90px 120px 1fr;gap:8px;align-items:center}',
      '.phl-onb-name{font-size:12px;font-weight:600}',
      '.phl-onb-hex{padding:3px 6px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px;font-family:monospace}',
      '.phl-onb-label{padding:3px 6px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px}',
      '.phl-onb-meta{display:flex;gap:16px;margin-bottom:16px}',
      '.phl-onb-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:rgba(128,128,128,.9)}',
      '.phl-onb-select{padding:3px 6px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px}',
      '.phl-onb-actions{display:flex;justify-content:flex-end}',
      '.phl-onb-btn{padding:5px 14px;border-radius:6px;border:1px solid rgba(120,220,130,.7);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-onb-btn:hover{background:rgba(120,220,130,.14)}',
      '.phl-profile-btn{padding:4px 10px;border-radius:6px;border:1px solid rgba(150,190,255,.7);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-profile-btn:hover{background:rgba(150,190,255,.14)}',
      '.phl-pnl{max-width:720px;margin:0 auto;padding:8px 4px 20px;overflow-y:auto;flex:1;min-height:0}',
      '.phl-pnl-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}',
      '.phl-pnl-title{margin:0;font-size:16px}',
      '.phl-pnl-sec{margin-bottom:14px;padding:10px 12px;border-radius:8px;border:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.04)}',
      '.phl-pnl-sec-title{margin:0 0 8px;font-size:13px;color:rgba(128,128,128,.9)}',
      '.phl-pnl-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.phl-pnl-headrow{font-size:11px;color:rgba(128,128,128,.8);margin-bottom:4px}',
      '.phl-pnl-name{width:70px;flex:0 0 auto;font-size:12px;font-weight:600}',
      '.phl-pnl-hex{width:110px;flex:0 0 auto;padding:3px 6px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px;font-family:monospace}',
      '.phl-pnl-label{flex:1;min-width:0;padding:3px 6px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px}',
      '.phl-pnl-rule-on{flex:0 0 auto}',
      '.phl-pnl-rule-text{flex:1;min-width:0;padding:3px 6px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px}',
      '.phl-pnl-conf{width:90px;flex:0 0 auto;padding:3px 6px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px}',
      '.phl-pnl-del{flex:0 0 auto;border:none;background:transparent;color:#e08585;font-size:15px;cursor:pointer;padding:0 2px;line-height:1}',
      '.phl-pnl-del:hover{color:#ff6b6b}',
      '.phl-pnl-addrule{display:flex;gap:8px;margin-top:8px}',
      '.phl-pnl-rule-new{flex:1}',
      '.phl-pnl-addrule-btn{padding:3px 10px;border-radius:5px;border:1px solid rgba(150,190,255,.7);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-pnl-addrule-btn:hover{background:rgba(150,190,255,.14)}',
      '.phl-pnl-ex-summary{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.phl-pnl-empty{font-size:12px;color:rgba(128,128,128,.75);padding:4px 0}',
      '.phl-pnl-stats-overall{font-size:12px;font-weight:600;margin-bottom:6px}',
      '.phl-pnl-stats-paper{font-family:monospace;font-size:11px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.phl-pnl-stats-kinds{font-size:11px;color:rgba(128,128,128,.8)}',
      '.phl-pnl-notes{width:100%;box-sizing:border-box;min-height:90px;padding:6px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:12px;font-family:inherit;resize:vertical}',
      '.phl-pnl-actions{display:flex;justify-content:flex-end}',
      '.phl-pnl-save{padding:5px 16px;border-radius:6px;border:1px solid rgba(120,220,130,.7);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-pnl-save:hover{background:rgba(120,220,130,.14)}',
      '.phl-prop-btn{padding:4px 10px;border-radius:6px;border:1px solid rgba(255,190,120,.7);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-prop-btn:hover{background:rgba(255,190,120,.14)}',
      '.phl-prop-list{display:flex;flex-direction:column;gap:12px}',
      '.phl-prop-card{padding:10px 12px;border-radius:8px;border:1px solid rgba(255,190,120,.4);background:rgba(255,190,120,.05)}',
      '.phl-prop-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}',
      '.phl-prop-paper{font-family:monospace;font-size:12px;font-weight:600}',
      '.phl-prop-stats{font-size:11px;color:rgba(128,128,128,.85)}',
      '.phl-prop-sec{margin-bottom:8px}',
      '.phl-prop-sec-title{display:block;font-size:11px;color:rgba(128,128,128,.8);margin-bottom:4px}',
      '.phl-prop-row{display:flex;align-items:center;gap:6px;margin-bottom:4px}',
      '.phl-prop-text{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.phl-prop-conf{flex:0 0 auto;font-size:11px;color:rgba(128,128,128,.75);width:52px;text-align:right}',
      '.phl-prop-item{padding:2px 8px;border-radius:5px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font-size:11px;cursor:pointer;flex:0 0 auto}',
      '.phl-prop-item:hover{background:rgba(128,128,128,.12)}',
      '.phl-prop-item-on{border-color:rgba(120,220,130,.8);background:rgba(120,220,130,.14)}',
      '.phl-prop-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}',
      '.phl-prop-btn2{padding:3px 12px;border-radius:5px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:12px;cursor:pointer}',
      '.phl-prop-btn2:hover{background:rgba(128,128,128,.12)}',
      '.phl-prop-confirm{border-color:rgba(120,220,130,.8)}'
    ].join(''))
  }, 'paper-highlight: styles')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'paper-highlight',
    order: 5,
    label: '论文',
    inject: () => ({})
  }, PaperView))
}
`

module.exports = {
  BODY,
  clampRange,
  sortAnchorIds,
  buildBlocks,
  renderText,
  buildWriteUrl,
  encodeWriteBody,
  callWrite,
  callProfile,
  callFormat,
  colorLegend,
  excludeRejected,
  localApplySpans,
  spanActiveStyle,
  markStyle,
  reconcileSpan,
  buildBlockSegments,
  buildSegmentMap,
  mapSelection,
  nodeOffsetToSeg,
  blockChildToSeg,
  selectionToNorm,
  sectionList,
  currentSectionId,
  keyAction,
  reviewProgress,
  buildExportUrl,
  profilePanelModel,
  profilePanelColors,
  profileSavePayload,
  proposalCardModel,
  buildApplyDecisions,
  MATH_SYMBOLS,
  supScript,
  subScript,
  boldMath,
  mathClean,
  mathConvert,
  splitMathPieces,
}
