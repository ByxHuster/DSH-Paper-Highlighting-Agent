const callData = (q) => host.call('paper.read', q)

const COLOR_MAP = {"yellow":"#fff3a0","red":"#ff9c94","blue":"#8fd0f7","green":"#b0e3a8","purple":"#d9b8f2"};
const COLOR_LABELS = {"yellow":"关键定义/方法","red":"核心洞见/贡献","blue":"局限/风险","green":"可借鉴/启发","purple":"待深挖/存疑"};

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

function renderText(text, spans, opts) {
  const withSeg = !!(opts && opts.withSegments)
  const segBase = (opts && Number.isInteger(opts.segBase)) ? opts.segBase : -1
  const anchorId = (opts && opts.anchorId) || ''
  const segProps = (i) => ({ 'data-phl-seg': String(i), 'data-phl-anchor': anchorId })
  if (!spans || spans.length === 0) {
    if (withSeg) return [React.createElement('span', Object.assign({ key: 'seg-' + segBase }, segProps(segBase)), text)]
    return [text]
  }
  const out = []
  let pos = 0
  let si = segBase
  const onMarkClick = opts && opts.onMarkClick
  const activeSpanId = opts && opts.activeSpanId
  for (const s of spans) {
    const [start, end] = clampRange(s.char_start, s.char_end, text.length)
    if (start > pos) {
      out.push(withSeg ? React.createElement('span', Object.assign({ key: 'seg-' + si }, segProps(si)), text.slice(pos, start)) : text.slice(pos, start))
      si++
    }
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
  if (pos < text.length) {
    out.push(withSeg ? React.createElement('span', Object.assign({ key: 'seg-' + si }, segProps(si)), text.slice(pos)) : text.slice(pos))
    si++
  }
  return out
}

function buildWriteUrl(paperId) {
  return '/paper-hl/write' + (paperId ? '?paperId=' + encodeURIComponent(paperId) : '')
}

function encodeWriteBody(action) {
  return JSON.stringify(action || {})
}

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

function excludeRejected(spans) {
  return (spans || []).filter((s) => s.status !== 'rejected')
}

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

function spanActiveStyle(status) {
  if (status === 'rejected') return { opacity: 0.3, textDecoration: 'line-through' }
  if (status === 'accepted') return { opacity: 1 }
  if (status === 'user_added') return { boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.35)' }
  return { opacity: 0.75 } // proposed
}

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

function buildBlockSegments(anchorId, text, spans) {
  const segs = []
  const sorted = (spans || []).slice().sort((x, y) => x.char_start - y.char_start)
  let pos = 0
  for (const s of sorted) {
    const [start, end] = clampRange(s.char_start, s.char_end, text.length)
    if (start > pos) segs.push({ anchorId, start: pos, end: start, spanId: null })
    if (end > start) segs.push({ anchorId, start, end, spanId: s.id })
    pos = Math.max(pos, end)
  }
  if (pos < text.length) segs.push({ anchorId, start: pos, end: text.length, spanId: null })
  return segs
}

function buildSegmentMap(blocks) {
  const out = []
  for (const b of blocks || []) {
    const segs = buildBlockSegments(b.id, (b.anchor && b.anchor.text) || '', b.spans)
    for (const s of segs) out.push(s)
  }
  return out
}

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
      const off = isEl ? (offset > 0 ? len : 0) : Math.max(0, Math.min(offset, len))
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

function selectionToNorm(sel, segments) {
  if (!sel) return null
  if (sel.isCollapsed) return null
  const a = nodeOffsetToSeg(sel.anchorNode, sel.anchorOffset, segments)
  const b = nodeOffsetToSeg(sel.focusNode, sel.focusOffset, segments)
  if (!a || !b) return { ok: false, reason: 'no-seg' }
  return { start: a, end: b }
}

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
  // v0.3 Phase 1: profileState = { loading, has_profile, colors } from
  // /paper-hl/profile (colors.yml-driven palette, D6); onboard = the cold-start
  // onboarding form draft (null unless no profile exists yet).
  const [profileState, setProfileState] = React.useState({ loading: true, has_profile: true, colors: null })
  const [onboard, setOnboard] = React.useState(null)
  const loadProfile = React.useCallback(() => {
    callProfile('GET', '').then((res) => {
      setProfileState({ loading: false, has_profile: !!res.has_profile, colors: (res.summary && res.summary.colors) || null })
      if (!res.has_profile) setOnboard(defaultOnboardDraft(null))
    }).catch(() => {
      // host without the profile route (or offline) → fall back to defaults
      setProfileState({ loading: false, has_profile: true, colors: null })
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
    callData({ paperId: id }).then((res) => {
      if (!res || res.ok !== true) throw new Error((res && res.error) || 'paper.read failed')
      setState({ phase: 'ready', error: null, data: res, papers: res.papers || [], paperId: res.paperId })
    }).catch((err) => {
      setState((s) => ({ ...s, phase: 'error', error: String((err && err.message) || err) }))
    })
  }, [])
  React.useEffect(() => { loadProfile(); load(null) }, [loadProfile, load])

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
  const palette = colorLegend(profileState.colors)

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
      ' ' + l.label
    ))
  )
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
      const kids = renderText(b.anchor.text, b.spans, { onMarkClick, activeSpanId, withSegments: segBase !== undefined, segBase: segBase || 0, anchorId: b.id, colors: profileState.colors })
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

  const actionBar = activeSpan ? renderActionBar(activeSpan) : null
  // v0.3 Phase 1: cold start → onboarding panel replaces the paper view.
  if (!profileState.loading && !profileState.has_profile) {
    return React.createElement('div', { className: 'phl-wrap' }, flashEl, renderOnboarding())
  }
  return React.createElement('div', { className: 'phl-wrap' }, header, legend, sectionBar, flashEl, rescueHint, addPopup, actionBar, body)
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
      '.phl-legend{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid rgba(128,128,128,.25);margin-bottom:10px;font-size:12px;color:rgba(128,128,128,.9)}',
      '.phl-legend-item{display:inline-flex;align-items:center;gap:4px}',
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
      '.phl-onb-btn:hover{background:rgba(120,220,130,.14)}'
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

return { inject, apply }
