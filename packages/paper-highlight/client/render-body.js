'use strict'

/**
 * paper-highlight · shared client render body (single source of truth)
 *
 * A self-contained block of plain JavaScript statements that defines the
 * conversation.view occupant for the paper-highlight view. It is embedded
 * verbatim into TWO artifacts so the render logic never drifts:
 *
 *   1. dynamic/client-half.js  — the browser half of the Step-3 dynamic
 *      dual-half plugin; `callData` is backed by `host.call('paper.read', …)`.
 *   2. client/client.js        — the durable `__ModuleLoader__` bundle; the
 *      same statements run with `callData` backed by `fetch('/paper-hl/…')`
 *      (the Step-4 host webserver route).
 *
 * Closure contract: the embedding code must provide `React`, `callData`
 * (an async (args) => JSON function answering {ok, paperId, paperMd, anchors,
 * highlights, papers} | {ok:false, error}), and `styles` ({insert(css)}).
 * The statements define `const inject = [...]`, `function apply(ctx)`, plus
 * helpers, and end with nothing exported — wrappers assign exports themselves.
 *
 * No backticks / template literals inside (the body rides template strings).
 */

const BODY = String.raw`
const COLOR_MAP = {
  yellow: '#fff3a0',
  red: '#ff9c94',
  blue: '#8fd0f7',
  green: '#b0e3a8',
  purple: '#d9b8f2'
}
const COLOR_LABELS = {
  yellow: '关键定义/方法',
  red: '核心洞见/贡献',
  blue: '局限/风险',
  green: '可借鉴/启发',
  purple: '待深挖/存疑'
}

function sortAnchorIds(anchors) {
  return Object.keys(anchors).sort((x, y) => {
    const a = anchors[x]
    const b = anchors[y]
    return a.page - b.page || a.block - b.block || a.par - b.par
  })
}

function buildBlocks(anchors, spans) {
  const byAnchor = {}
  for (const s of spans || []) {
    if (!anchors[s.anchor]) continue
    ;(byAnchor[s.anchor] = byAnchor[s.anchor] || []).push(s)
  }
  let firstTitleSeen = false
  return sortAnchorIds(anchors).map((id) => {
    const a = anchors[id]
    const list = (byAnchor[id] || []).slice().sort((x, y) => x.char_start - y.char_start)
    const isFirstTitle = !firstTitleSeen && a.type === 'title'
    if (a.type === 'title') firstTitleSeen = true
    return { id, anchor: a, spans: list, isFirstTitle }
  })
}

function renderText(text, spans) {
  if (!spans || spans.length === 0) return [text]
  const out = []
  let pos = 0
  for (const s of spans) {
    if (s.char_start > pos) out.push(text.slice(pos, s.char_start))
    if (s.char_end > s.char_start) {
      out.push(React.createElement('mark', {
        key: s.id,
        style: { background: COLOR_MAP[s.color] || s.color, padding: '1px 0', borderRadius: 2, cursor: 'help' },
        title: (s.rationale || s.color) + (s.status ? ' [' + s.status + ']' : '')
      }, text.slice(s.char_start, s.char_end)))
    }
    pos = Math.max(pos, s.char_end)
  }
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

function PaperView() {
  const [state, setState] = React.useState({ phase: 'loading', error: null, data: null, papers: [], paperId: null })
  const load = React.useCallback((id) => {
    setState((s) => ({ ...s, phase: 'loading', error: null }))
    callData({ paperId: id }).then((res) => {
      if (!res || res.ok !== true) throw new Error((res && res.error) || 'paper.read failed')
      setState({ phase: 'ready', error: null, data: res, papers: res.papers || [], paperId: res.paperId })
    }).catch((err) => {
      setState((s) => ({ ...s, phase: 'error', error: String((err && err.message) || err) }))
    })
  }, [])
  React.useEffect(() => { load(null) }, [load])

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
  const spans = highlights.spans || []
  const blocks = buildBlocks(data.anchors || {}, spans)
  const metaTitle = (highlights.paper && highlights.paper.title) || ''
  const header = React.createElement('div', { className: 'phl-header' },
    React.createElement('div', { className: 'phl-title' }, metaTitle || state.paperId),
    React.createElement('div', { className: 'phl-tools' },
      React.createElement('select', {
        className: 'phl-select',
        value: state.paperId,
        onChange: (e) => load(e.target.value)
      }, (state.papers || []).map((p) => React.createElement('option', { key: p, value: p }, p))),
      React.createElement('button', { className: 'phl-refresh', onClick: () => load(state.paperId) }, '刷新')
    )
  )
  const legend = React.createElement('div', { className: 'phl-legend' },
    React.createElement('span', { className: 'phl-count' }, blocks.length + ' 段 · ' + spans.length + ' 处高亮'),
    Object.keys(COLOR_MAP).map((c) => React.createElement('span', { key: c, className: 'phl-legend-item' },
      React.createElement('mark', { style: { background: COLOR_MAP[c] } }, ' '),
      ' ' + (COLOR_LABELS[c] || c)
    ))
  )
  const body = React.createElement('div', { className: 'phl-body' },
    blocks.map((b) => {
      const kids = renderText(b.anchor.text, b.spans)
      if (b.anchor.type === 'title') {
        return React.createElement(b.isFirstTitle ? 'h1' : 'h2', { key: b.id, className: 'phl-heading' }, ...kids)
      }
      return React.createElement('p', { key: b.id, className: 'phl-para' }, ...kids)
    })
  )
  return React.createElement('div', { className: 'phl-wrap' }, header, legend, body)
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
      '.phl-legend{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid rgba(128,128,128,.25);margin-bottom:10px;font-size:12px;color:rgba(128,128,128,.9)}',
      '.phl-legend-item{display:inline-flex;align-items:center;gap:4px}',
      '.phl-count{margin-right:auto;opacity:.8}',
      '.phl-body{flex:1;min-height:0;overflow-y:auto;padding-right:6px}',
      '.phl-heading{margin:14px 0 8px;line-height:1.4}',
      '.phl-para{margin:0 0 10px;white-space:pre-wrap;word-break:break-word}',
      '.phl-note{color:rgba(128,128,128,.85)}',
      '.phl-error{color:#e05a5a;margin-bottom:8px}'
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

module.exports = BODY
