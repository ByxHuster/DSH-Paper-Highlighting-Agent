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

function callFormat(payload, transport) {
  const body = payload ? JSON.stringify(payload) : '{}'
  const t = transport || (typeof formatData === 'function' ? formatData : null)
  if (!t) return Promise.reject(new Error('paper-highlight: format transport not available'))
  return Promise.resolve(t(body)).then((res) => {
    if (!res || res.ok !== true) throw new Error((res && res.error) || 'format failed')
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

























function profilePanelModel(profile) {
  const colors = profilePanelColors(profile)
  const rules = profile && Array.isArray(profile.rules) ? profile.rules : []
  const exemplars = profile && Array.isArray(profile.exemplars) ? profile.exemplars : []
  const stats = profile && profile.stats && typeof profile.stats === 'object' ? profile.stats : { papers: [], overall: null }
  const notes = profile && typeof profile.reflection_notes === 'string' ? profile.reflection_notes : ''
  return { colors, rules, exemplars, stats, notes }
}

function profilePanelColors(profile) {
  return colorLegend(profile && profile.colors ? profile.colors : null)
}

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

function localApproveSectionSpans(spans, sectionAnchors) {
  const set = new Set(sectionAnchors || [])
  return (spans || []).map((s) => {
    if (s.status !== 'proposed' || !set.has(s.anchor)) return s
    return Object.assign({}, s, { status: 'accepted' })
  })
}

function localRevertSectionSpans(spans, sectionAnchors) {
  const set = new Set(sectionAnchors || [])
  return (spans || []).map((s) => {
    if (s.status !== 'accepted' || !set.has(s.anchor)) return s
    return Object.assign({}, s, { status: 'proposed' })
  })
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

function buildExportUrl(paperId, format, includePending, download) {
  const q = ['paperId=' + encodeURIComponent(paperId || '')]
  if (format) q.push('format=' + encodeURIComponent(format))
  if (includePending) q.push('include_pending=1')
  if (download) q.push('download=1')
  return '/paper-hl/export?' + q.join('&')
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

  // v0.5.1: approve one section from the TOC chip click — optimistic batch
  // accept of every proposed span in the section + mark the section reviewed,
  // then the approve_section round trip (server accepts + marks reviewed; the
  // returned spans reconcile the overlay, the section entry merges into the
  // optimistic review map). Empty sections (agent proposed nothing) still get
  // marked reviewed — passing them is exactly the point of a TOC click.
  const approveSection = (id) => {
    if (!id) return
    const sec = (data.sections || []).find((s) => s.id === id)
    const secAnchors = (sec && Array.isArray(sec.anchor_ids)) ? sec.anchor_ids : []
    const title = (sec && sec.title) || id
    const before = spans.filter((s) => s.status === 'proposed' && secAnchors.indexOf(s.anchor) >= 0).length
    const next = localApproveSectionSpans(spans, secAnchors)
    setSpansOverride(next)
    const optimistic = { status: 'reviewed', reviewed_at: new Date().toISOString() }
    setSectionOverrides((m) => Object.assign({}, m, { [id]: optimistic }))
    setFlash(null)
    setFlash({ kind: 'ok', text: '已审批通过 ' + title + (before ? '（接受 ' + before + ' 处高亮）' : '（无待审批高亮，已标记审查）') })
    callWrite({ action: 'approve_section', section: id }, state.paperId).then((res) => {
      if (res && Array.isArray(res.accepted)) {
        setSpansOverride((prev) => {
          let acc = prev || next
          for (const sp of res.accepted) acc = reconcileSpan(acc, sp, { action: 'accept', span_id: sp.id })
          return acc
        })
      }
      if (res && res.section && res.section.id) {
        setSectionOverrides((m) => Object.assign({}, m, { [res.section.id]: { status: res.section.status || 'reviewed', reviewed_at: res.section.reviewed_at || null } }))
      }
      if (res && typeof res.accepted_count === 'number') {
        setFlash({ kind: 'ok', text: '已审批通过 ' + title + (res.accepted_count ? '（接受 ' + res.accepted_count + ' 处高亮）' : '（无待审批高亮，已标记审查）') })
      }
    }).catch((err) => {
      const msg = String(err && err.message ? err.message : err)
      setFlash({ kind: 'error', text: '审批失败（已回读校准）：' + msg })
      callData({ paperId: state.paperId }).then((res) => {
        if (res && res.ok) { setState((s) => ({ ...s, data: res })); setSpansOverride(null); setSectionOverrides({}) }
      }).catch(() => {})
    })
  }

  // v0.5.3 · 反选 — revert one section from the TOC chip Shift+click. Optimistic
  // batch revert (accepted → proposed 待审) of the section's spans + set the
  // section back to pending (待审), then the revert_section round trip (server
  // reverts + marks pending; the returned spans reconcile the overlay, the
  // section entry merges into the optimistic map). The user asked explicitly
  // that 反选 = 批量设置为待审状态 (undo the one-click approve) — NOT batch
  // reject. Mirrors approveSection.
  const revertSection = (id) => {
    if (!id) return
    const sec = (data.sections || []).find((s) => s.id === id)
    const secAnchors = (sec && Array.isArray(sec.anchor_ids)) ? sec.anchor_ids : []
    const title = (sec && sec.title) || id
    const before = spans.filter((s) => s.status === 'accepted' && secAnchors.indexOf(s.anchor) >= 0).length
    const next = localRevertSectionSpans(spans, secAnchors)
    setSpansOverride(next)
    const optimistic = { status: 'pending' }
    setSectionOverrides((m) => Object.assign({}, m, { [id]: optimistic }))
    setFlash(null)
    setFlash({ kind: 'ok', text: '已恢复为待审 ' + title + (before ? '（' + before + ' 处高亮回到待审）' : '（该节无已接受高亮，已标记待审）') })
    callWrite({ action: 'revert_section', section: id }, state.paperId).then((res) => {
      if (res && Array.isArray(res.reverted)) {
        setSpansOverride((prev) => {
          let acc = prev || next
          for (const sp of res.reverted) acc = reconcileSpan(acc, sp, { action: 'revert', span_id: sp.id })
          return acc
        })
      }
      if (res && res.section && res.section.id) {
        setSectionOverrides((m) => Object.assign({}, m, { [res.section.id]: { status: res.section.status || 'pending' } }))
      }
      if (res && typeof res.reverted_count === 'number') {
        setFlash({ kind: 'ok', text: '已恢复为待审 ' + title + (res.reverted_count ? '（' + res.reverted_count + ' 处高亮回到待审）' : '（该节无已接受高亮，已标记待审）') })
      }
    }).catch((err) => {
      const msg = String(err && err.message ? err.message : err)
      setFlash({ kind: 'error', text: '恢复待审失败（已回读校准）：' + msg })
      callData({ paperId: state.paperId }).then((res) => {
        if (res && res.ok) { setState((s) => ({ ...s, data: res })); setSpansOverride(null); setSectionOverrides({}) }
      }).catch(() => {})
    })
  }

  // v0.4 Phase 4 (D6): publish the ready-path dispatch closures + hints so the
  // keydown effect (declared before the early returns) reads them fresh.
  dispatchRef.current = {
    applyAction,
    markCurrentReviewed,
    approveSection,
    revertSection,
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
  // v0.5.1: clicking a section chip approves ALL its highlights (batch accept)
  // and marks it reviewed — even when the agent proposed none.
  // v0.5.3: Shift+click on a chip is the 反选 — batch-REJECT all its highlights.
  const sectionBar = React.createElement('div', { className: 'phl-sections' },
    sectionItems.map((s) =>
      React.createElement('div', {
        key: s.id,
        className: 'phl-section' + (s.reviewed ? ' phl-section-done' : '') + (s.id === currentSection ? ' phl-section-curr' : ''),
        'data-phl-sec': s.id,
        title: (s.reviewed ? '✓ 已审查' : '待审查') + ' · ' + s.title + '（点击 = 审批通过本节全部高亮；Shift+点击 = 恢复本节为待审，撤销审批）',
        onClick: (e) => {
          if (e && e.shiftKey) revertSection(s.id)
          else approveSection(s.id)
        }
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
      ? [React.createElement('div', { className: 'phl-pnl-empty' }, '（暂无示例，确认提案后自动入库）')]
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
      '.phl-section{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;max-width:220px;padding:3px 8px;border-radius:10px;border:1px solid rgba(128,128,128,.35);background:transparent;color:rgba(128,128,128,.9);cursor:pointer;white-space:nowrap;overflow:hidden;transition:border-color .12s}',
      '.phl-section:hover{border-color:rgba(150,190,255,.85)}',
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

return { inject, apply }
