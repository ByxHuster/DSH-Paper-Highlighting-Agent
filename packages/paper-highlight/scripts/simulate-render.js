'use strict'

/**
 * paper-highlight · headless render simulation (no browser needed)
 *
 * Executes the SHIPPED client bundle (client/client.js) in Node with minimal
 * React + DOM shims, drives its async load through the REAL 3081 data path
 * (GET /paper-hl/read on the running paper-profile server), and asserts the
 * produced element tree: title heading, paragraph count, mark count/colors,
 * legend, and controls. This proves the bundle logic end-to-end short of a
 * real browser's React reconciliation.
 *
 * v0.2 Phase 2 (P2-c): additionally drives the review interaction — click a
 * mark → assert the floating action bar renders; click 接受 / a color swatch →
 * assert the POST /paper-hl/write payload is correct AND the local render
 * syncs (status/color change). The POST is MOCKED (payload captured, response
 * derived from a read-only /read fetch) so the real 5-span demo data is never
 * mutated; the live write smoke is deferred to P2-f with a JSON backup.
 *
 * Run while the paper profile server (3081) is up:
 *   node scripts/simulate-render.js
 */

const http = require('http')
const fs = require('fs')
const path = require('path')

const BUNDLE = path.join(__dirname, '..', 'client', 'client.js')
const API = 'http://127.0.0.1:3081/paper-hl/read'

// ── minimal DOM shim ────────────────────────────────────────────────────────
const styleTags = []
const documentShim = {
  querySelector: () => null,
  createElement: (tag) => {
    if (tag === 'style') {
      const el = { dataset: {}, textContent: '', remove: () => {} }
      styleTags.push(el)
      return el
    }
    return {}
  },
  head: { appendChild: () => {} },
}

// ── minimal React shim ──────────────────────────────────────────────────────
function createElement(type, props, ...children) {
  const flat = []
  for (const c of children) {
    if (Array.isArray(c)) flat.push(...c)
    else if (c !== null && c !== undefined && c !== false) flat.push(c)
  }
  return { type, props: props || {}, children: flat }
}

const stateCells = new Map() // hookIndex -> {value}; persistent across renders (one component instance)
const effectQueue = []
let hookIndex = 0

function useState(initial) {
  const i = hookIndex++
  let cell = stateCells.get(i)
  if (!cell) {
    cell = { value: initial }
    stateCells.set(i, cell)
  }
  return [
    cell.value,
    (v) => {
      cell.value = typeof v === 'function' ? v(cell.value) : v
    },
  ]
}
function useEffect(fn) {
  effectQueue.push(fn)
}
function useCallback(fn) {
  return fn
}

const reactShim = { useState, useEffect, useCallback, createElement }

// ── require shim for the ModuleLoader factory ────────────────────────────────
function makeRequire() {
  return (id) => {
    if (id === 'react') return reactShim
    if (id === 'react/jsx-runtime') return { jsx: () => { throw new Error('jsx not expected') } }
    throw new Error(`simulation require: unexpected module ${id}`)
  }
}

// ── fetch shim → REAL GET /paper-hl/read + MOCKED POST /paper-hl/write ─────
const API_ORIGIN = 'http://127.0.0.1:3081'

// P2-c: capture every write payload the client would POST, and answer with a
// plausible server response WITHOUT mutating the real data (the mock derives
// the full mutated span from a read-only /read fetch, mirroring host applyAction).
const writeCapture = []
let mockAddedSpan = null // P2-d: server-confirmed span for the last mocked `add`
function applyMockAction(spans, payload) {
  const span = payload.span_id ? spans.find((s) => s.id === payload.span_id) || null : null
  if (span) {
    if (payload.action === 'accept') span.status = 'accepted'
    if (payload.action === 'reject') span.status = 'rejected'
    if (payload.action === 'recolor') span.color = payload.color
    if (payload.action === 'note') span.note = payload.note
    if (payload.action === 'rescope') {
      span.anchor = payload.anchor
      span.char_start = payload.char_start
      span.char_end = payload.char_end
    }
  }
  if (payload.action === 'add') {
    const maxId = spans.reduce((mx, s) => {
      const m = /^s-(\d+)$/.exec(s.id || '')
      return m ? Math.max(mx, Number(m[1])) : mx
    }, 0)
    const nspan = {
      id: 's-' + String(maxId + 1).padStart(3, '0'),
      anchor: payload.anchor,
      char_start: payload.char_start,
      char_end: payload.char_end,
      color: payload.color,
      rationale: payload.rationale || '',
      status: 'user_added',
      decisions: [],
    }
    spans.push(nspan)
    return nspan
  }
  return span
}
function mockWriteHandler(url, body) {
  const payload = JSON.parse(body || '{}')
  writeCapture.push(payload)
  return fetchShim('/paper-hl/read').then((res) => res.json()).then((j) => {
    let result
    if (!j.ok) {
      result = { ok: false, error: 'mock: read failed' }
    } else {
      const spans = (j.highlights && j.highlights.spans) || []
      // P2-e: review_section answers with a server-style section entry.
      if (payload.action === 'review_section') {
        const sec = { id: payload.section, status: 'reviewed', reviewed_at: new Date().toISOString() }
        result = { ok: true, action: 'review_section', section: sec, span_count: spans.length }
      } else {
        const span = applyMockAction(spans, payload)
        if (payload.action === 'add' && span) mockAddedSpan = span
        result = { ok: true, action: payload.action, span, span_count: spans.length }
      }
    }
    // Response-like shape — the durable writeData transport calls res.json()
    return { ok: result.ok, status: 200, json: async () => result }
  })
}

function fetchShim(url, opts) {
  const target = url.startsWith('/') ? API_ORIGIN + url : url
  if (opts && opts.method === 'POST' && url.indexOf('/paper-hl/write') === 0) {
    return mockWriteHandler(url, opts.body)
  }
  return new Promise((resolve, reject) => {
    http.get(target, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => JSON.parse(body),
        })
      })
    }).on('error', reject)
  })
}

// ── load + mount the bundle ─────────────────────────────────────────────────
let loaded = null
let fakeSelection = null // P2-d: stubbed window.getSelection() return value
global.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
  getSelection: () => fakeSelection,
}
global.document = documentShim
global.fetch = fetchShim

const bundleSrc = fs.readFileSync(BUNDLE, 'utf8')

// ── P2-a / P2-b: the SHIPPED bundle must embed the write path + state model ──
const p2a = ['/paper-hl/write', 'writeData', 'callWrite', 'buildWriteUrl', 'encodeWriteBody']
for (const needle of p2a) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing P2-a write plumbing: ${needle}`)
}
const p2b = ['excludeRejected', 'localApplySpans', 'spanActiveStyle', 'activeSpanId', 'menuOpen', 'drafts']
for (const needle of p2b) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing P2-b state model / reducer: ${needle}`)
}
const p2c = ['markStyle', 'reconcileSpan', 'renderActionBar', 'applyAction', 'phl-ab', '接受', '删除']
for (const needle of p2c) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing P2-c action bar: ${needle}`)
}
const p2d = ['buildSegmentMap', 'buildBlockSegments', 'mapSelection', 'selectionToNorm', 'nodeOffsetToSeg', 'data-phl-seg', '新增高亮', '改范围', 'addDraft', 'rescueTarget', 'onBodyMouseUp']
for (const needle of p2d) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing P2-d selection plumbing: ${needle}`)
}
const p2e = ['sectionList', 'currentSectionId', 'review_section', '标记本节审查完毕', 'phl-section', 'onBodyScroll', 'sectionOverrides', 'currentSection']
for (const needle of p2e) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing P2-e review-complete plumbing: ${needle}`)
}
console.log('bundle write-path plumbing (P2-a):', p2a.join(', '))
console.log('bundle interaction state (P2-b):', p2b.join(', '))
console.log('bundle action bar (P2-c):', p2c.join(', '))
console.log('bundle selection→add/rescope (P2-d):', p2d.join(', '))
console.log('bundle review-complete signal (P2-e):', p2e.join(', '))

// Execute the bundle: window.__ModuleLoader__.load({id, factory})
// eslint-disable-next-line no-new-func
new Function('window', bundleSrc)(global.window)
if (!loaded || typeof loaded.factory !== 'function') throw new Error('bundle did not call __ModuleLoader__.load')
const exportsObj = loaded.factory(makeRequire())
if (typeof exportsObj.apply !== 'function' || !Array.isArray(exportsObj.inject)) {
  throw new Error('bundle factory did not export {apply, inject}')
}
console.log('bundle id:', loaded.id, '| inject:', JSON.stringify(exportsObj.inject))

// ── fake ctx: capture the slots.inject registration + run effects ──────────
let registration = null
const ctxShim = {
  effect(fn) {
    fn() // run styles insertion synchronously
    return () => {}
  },
  slots: {
    inject(name, fn) {
      registration = { name, fn }
    },
    register(opts, Component) {
      return { ...opts, Component }
    },
  },
}
exportsObj.apply(ctxShim)
if (!registration || registration.name !== 'conversation.view') {
  throw new Error(`expected conversation.view registration, got ${registration && registration.name}`)
}
const entry = registration.fn()
console.log('registration:', entry.id, '| label:', entry.label, '| order:', entry.order)

// ── render pass 1 (loading) ─────────────────────────────────────────────────
hookIndex = 0
let tree = entry.Component()
console.log('pass1 (loading) node:', tree.type, '| text:', JSON.stringify((tree.children[0] || {}).children || tree.children))
console.log('css tags inserted:', styleTags.length, '| css bytes:', styleTags.reduce((n, t) => n + t.textContent.length, 0))

// ── drive the async load (useEffect ran load(null) synchronously via queue) ─
;(async () => {
  // run the mount effect (load(null)) — React runs effects after render
  for (const fn of effectQueue.splice(0)) fn()
  // flush the in-flight fetch → setState('ready')
  await new Promise((r) => setTimeout(r, 200))

  // render pass 2 (ready)
  hookIndex = 0
  tree = entry.Component()

  const textOf = (n) => (typeof n === 'string' ? n : Array.isArray(n.children) ? n.children.map(textOf).join('') : '')
  const isMark = (n) => typeof n === 'object' && n && n.type === 'mark'
  const walkTree = (root) => {
    const marks = []
    const byType = {}
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (typeof n.type === 'string') {
        ;(byType[n.type] = byType[n.type] || []).push(n)
        if (isMark(n)) marks.push(n)
      }
      if (Array.isArray(n.children)) n.children.forEach(walk)
    }
    walk(root)
    return { marks, byType }
  }
  const collectButtons = (root) => {
    const btns = []
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (n.type === 'button') btns.push(n)
      if (Array.isArray(n.children)) n.children.forEach(walk)
    }
    walk(root)
    return btns
  }
  let view = walkTree(tree)
  let marks = view.marks
  let byType = view.byType
  console.log('pass2 node:', tree.type)

  // assertions
  const fullText = textOf(tree)

  const assert = (cond, msg) => {
    if (!cond) throw new Error('ASSERT FAILED: ' + msg)
    console.log('  ok:', msg)
  }

  const rerender = () => {
    hookIndex = 0
    tree = entry.Component()
    view = walkTree(tree)
    marks = view.marks
    byType = view.byType
    return view
  }

  assert(!fullText.includes('加载论文'), 'loading state cleared (data loaded)')
  assert(byType.h1 && byType.h1.length === 1, 'exactly one h1 heading')
  assert(textOf(byType.h1[0]).includes('Efficient Estimation of Word Representations'), 'h1 is the paper title')

  const paras = byType.p || []
  assert(paras.length > 40, 'paragraph count > 40 (got ' + paras.length + ')')

  // Phase 0: the derived section index is served, and the empty "References"
  // heading (ref_text filtered out by normalize) must NOT be rendered.
  const live = await fetchShim('/paper-hl/read').then((r) => r.json())
  assert(live.ok && Array.isArray(live.sections) && live.sections.length === 22, 'live /read serves 22 derived sections')
  const h2s = byType.h2 || []
  assert(h2s.length === 20, '20 h2 headings — empty References section skipped (got ' + h2s.length + ')')
  assert(!h2s.some((h) => textOf(h).trim() === 'References'), 'no "References" heading rendered')

  // Data-driven mark count: the bundle must render exactly the spans the live
  // /paper-hl/read endpoint serves (Step 4: agent-written spans, not the old
  // fixed 9-seed demo).
  const spanMarks = marks.filter((m) => m.props.title) // legend marks carry no title
  const expectedSpans = await fetchShim('/paper-hl/read').then((r) => r.json()).then((j) => (j.ok ? j.highlights.spans.length : -1))
  assert(expectedSpans > 0, 'live /paper-hl/read serves spans (got ' + expectedSpans + ')')
  assert(spanMarks.length === expectedSpans, spanMarks.length + ' highlight marks match live span count (' + expectedSpans + ')')

  const colors = {}
  for (const m of spanMarks) colors[m.props.style.background] = (colors[m.props.style.background] || 0) + 1
  console.log('  span mark colors:', JSON.stringify(colors))
  assert(spanMarks.some((m) => m.props.title.includes('核心贡献')), 'a mark carries the rationale tooltip')

  assert(byType.select && byType.select.length === 1, 'paper selector present')
  assert(byType.button && byType.button.some((b) => textOf(b).includes('刷新')), 'refresh button present')

  assert(byType.mark && fullText.includes('关键定义/方法') && fullText.includes('待深挖/存疑'), 'legend with color semantics present')

  // ══════════════ P2-c: review interaction (mark click → action bar → accept/recolor) ══════════════
  const GREEN = '#b0e3a8'
  const clickEvent = () => ({ stopPropagation() {} })
  // spanMarks (above) is the pass2 snapshot; no mutation has happened yet, so
  // it is the same set as the current marks.
  const target = spanMarks[0]
  assert(typeof target.props.onClick === 'function', 'span mark is clickable (onClick attached)')
  const targetId = target.props.key
  assert(typeof targetId === 'string' && /^s-\d+$/.test(targetId), 'clickable mark carries its span id as key')

  // 1) click a mark → the floating action bar renders + the mark gets an outline
  target.props.onClick(clickEvent())
  rerender()
  const abDiffs = byType.div.filter((d) => (d.props.className || '') === 'phl-ab')
  assert(abDiffs.length === 1, 'action bar (.phl-ab) rendered after clicking a mark')
  const sel = marks.filter((m) => m.props.title).find((m) => m.props.key === targetId)
  assert(sel && sel.props.style.outline !== undefined, 'selected mark shows the selected outline')
  const abBtns = collectButtons(abDiffs[0])
  assert(abBtns.some((b) => textOf(b) === '接受') && abBtns.some((b) => textOf(b) === '删除'), 'action bar has 接受 + 删除 buttons')
  assert(abBtns.filter((b) => (b.props.className || '').indexOf('phl-ab-swatch') === 0).length === 5, 'action bar has the 5-color swatch palette')
  assert(byType.input.some((i) => (i.props.className || '').indexOf('phl-ab-input') === 0), 'action bar has a note input')

  // 2) accept → POST payload {action:accept, span_id} + local render sync
  writeCapture.length = 0
  abBtns.find((b) => textOf(b) === '接受').props.onClick()
  assert(writeCapture.length === 1 && writeCapture[0].action === 'accept' && writeCapture[0].span_id === targetId,
    'accept POST payload {action:"accept", span_id} correct')
  await new Promise((r) => setTimeout(r, 200)) // flush mock write + reconcile
  rerender()
  const accMark = marks.filter((m) => m.props.title).find((m) => m.props.key === targetId)
  assert(accMark && (accMark.props.title.indexOf('[accepted]') >= 0 || accMark.props.style.opacity === 1),
    'accept locally syncs the mark (status [accepted] / opacity 1)')

  // 3) recolor → click the green swatch → POST payload {action:recolor, span_id, color} + background sync
  const abDiffs2 = byType.div.filter((d) => (d.props.className || '') === 'phl-ab')
  assert(abDiffs2.length === 1, 'action bar stays open after accept (follow-up edits)')
  const greenSwatch = collectButtons(abDiffs2[0]).find((b) => b.props.style && b.props.style.background === GREEN)
  assert(greenSwatch !== undefined, 'green swatch present in the action bar')
  writeCapture.length = 0
  greenSwatch.props.onClick()
  assert(writeCapture.length === 1 && writeCapture[0].action === 'recolor' && writeCapture[0].span_id === targetId && writeCapture[0].color === 'green',
    'recolor POST payload {action:"recolor", span_id, color:"green"} correct')
  await new Promise((r) => setTimeout(r, 200)) // flush mock write + reconcile
  rerender()
  const recMark = marks.filter((m) => m.props.title).find((m) => m.props.key === targetId)
  assert(recMark && recMark.props.style.background === GREEN, 'recolor locally syncs the mark background to green')

  // ══════════════ P2-d: text selection → 新增高亮 popup → POST add ══════════════
  // Fake DOM-ish Selection: anchor/focus are text nodes inside a seg element
  // carrying data-phl-seg, exactly what nodeOffsetToSeg walks in the browser.
  const makeSegEl = (seg, anchor) => ({
    nodeType: 1,
    getAttribute(name) {
      if (name === 'data-phl-seg') return String(seg)
      if (name === 'data-phl-anchor') return anchor
      return null
    },
    parentElement: null,
  })
  const makeTextNode = (parent) => ({ nodeType: 3, parentElement: parent })
  const setFakeSelection = (seg, anchor, startOff, endOff) => {
    const segEl = makeSegEl(seg, anchor)
    fakeSelection = {
      isCollapsed: false,
      anchorNode: makeTextNode(segEl),
      anchorOffset: startOff,
      focusNode: makeTextNode(segEl),
      focusOffset: endOff,
      removeAllRanges: () => { fakeSelection = null },
    }
  }
  const findSegNode = (pred) => {
    for (const p of byType.p || []) {
      for (const k of (p.children || [])) {
        if (typeof k === 'object' && k && k.props && k.props['data-phl-seg'] !== undefined && textOf(k).length > 0) {
          if (!pred || pred(k)) return k
        }
      }
    }
    return null
  }
  const bodyDiv = () => byType.div.find((d) => (d.props.className || '') === 'phl-body')

  // pick a PLAIN (previously unhighlighted) text segment to add a highlight over
  const segNode = findSegNode((k) => k.type === 'span')
  assert(segNode !== null, 'P2-d: a plain text segment with data-phl-seg is rendered')
  const segIndex = Number(segNode.props['data-phl-seg'])
  const segAnchor = segNode.props['data-phl-anchor']
  const segLen = textOf(segNode).length
  assert(Number.isInteger(segIndex) && segIndex >= 0 && typeof segAnchor === 'string' && segAnchor.length > 0 && segLen > 0,
    'P2-d: selected segment metadata (index/anchor/length) is valid')

  // Expected range via the EMBEDDED mapSelection (the exact browser code path).
  const liveData = await fetchShim('/paper-hl/read').then((r) => r.json())
  const liveSegs = exportsObj.buildSegmentMap(exportsObj.buildBlocks(liveData.anchors, liveData.highlights.spans, liveData.sections))
  const expectedAdd = exportsObj.mapSelection(liveSegs, { start: { seg: segIndex, offset: 0 }, end: { seg: segIndex, offset: segLen } })
  assert(expectedAdd && expectedAdd.ok === true && expectedAdd.anchor === segAnchor,
    'P2-d: embedded mapSelection maps the rendered segment to its anchor range')

  // mouseup with a non-collapsed selection → 新增高亮 popup
  setFakeSelection(segIndex, segAnchor, 0, segLen)
  assert(bodyDiv() && typeof bodyDiv().props.onMouseUp === 'function', 'P2-d: .phl-body carries the mouseup selection handler')
  bodyDiv().props.onMouseUp({})
  rerender()
  let addDiffs = byType.div.filter((d) => (d.props.className || '') === 'phl-add')
  assert(addDiffs.length === 1, 'P2-d: 新增高亮 popup (.phl-add) rendered after a text selection')
  const addSwatches = collectButtons(addDiffs[0]).filter((b) => (b.props.className || '').indexOf('phl-add-swatch') === 0)
  assert(addSwatches.length === 5, 'P2-d: add popup has the 5-color palette')
  const addInputs = byType.input.filter((i) => (i.props.className || '') === 'phl-add-input')
  assert(addInputs.length === 1, 'P2-d: add popup has a rationale input')

  // pick green + type a rationale, then confirm 添加
  const greenAdd = addSwatches.find((b) => b.props.style && b.props.style.background === GREEN)
  assert(greenAdd !== undefined, 'P2-d: green swatch present in the add popup')
  greenAdd.props.onClick()
  addInputs[0].props.onChange({ target: { value: 'user manual highlight' } })
  rerender()
  const addDiffs2 = byType.div.filter((d) => (d.props.className || '') === 'phl-add')
  const confirmBtn = collectButtons(addDiffs2[0]).find((b) => textOf(b) === '添加')
  assert(confirmBtn !== undefined, 'P2-d: add popup has 添加 button')
  writeCapture.length = 0
  mockAddedSpan = null
  confirmBtn.props.onClick()
  assert(writeCapture.length === 1 && writeCapture[0].action === 'add', 'P2-d: add POST payload action=add')
  const addPayload = writeCapture[0]
  assert(addPayload.anchor === expectedAdd.anchor && addPayload.char_start === expectedAdd.char_start && addPayload.char_end === expectedAdd.char_end,
    'P2-d: add POST payload range equals the embedded mapSelection range')
  assert(addPayload.color === 'green' && addPayload.rationale === 'user manual highlight', 'P2-d: add POST payload carries color + rationale')
  assert(typeof addPayload.clientId === 'string' && addPayload.clientId.indexOf('local-add-') === 0, 'P2-d: add POST payload carries a clientId for optimistic reconciliation')
  await new Promise((r) => setTimeout(r, 200)) // flush mock write + reconcile
  rerender()
  const marksAfterAdd = marks.filter((m) => m.props.title)
  assert(marksAfterAdd.length === expectedSpans + 1, 'P2-d: a new highlight mark appears after add (local render sync)')
  assert(marksAfterAdd.some((m) => (m.props.title || '').indexOf('[user_added]') >= 0 && m.props.style.background === GREEN),
    'P2-d: the added mark renders green with [user_added] status')
  assert(mockAddedSpan !== null && mockAddedSpan.id !== addPayload.clientId, 'P2-d: server allocated a real s-<n> id (reconciled)')

  // ══════════════ P2-d: 改范围 → text selection → POST rescope ══════════════
  // open the action bar on the just-added mark, click 改范围
  const addedMarkNode = marksAfterAdd.find((m) => (m.props.title || '').indexOf('[user_added]') >= 0)
  assert(addedMarkNode !== undefined, 'P2-d: the user-added mark is present to rescope')
  const addedServerId = addedMarkNode.props.key
  assert(typeof addedServerId === 'string' && /^s-\d+$/.test(addedServerId), 'P2-d: added mark carries the reconciled server span id as key')
  addedMarkNode.props.onClick(clickEvent())
  rerender()
  const abDiffs3 = byType.div.filter((d) => (d.props.className || '') === 'phl-ab')
  assert(abDiffs3.length === 1, 'P2-d: action bar opens on the added mark')
  const rescopeBtn = collectButtons(abDiffs3[0]).find((b) => textOf(b) === '改范围')
  assert(rescopeBtn !== undefined, 'P2-d: action bar has a 改范围 button')
  writeCapture.length = 0
  rescopeBtn.props.onClick()
  rerender()
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-hint').length === 1, 'P2-d: rescope hint bar renders while awaiting a selection')
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-ab').length === 0, 'P2-d: action bar closes when entering rescope mode')

  // select a plain segment in a DIFFERENT paragraph (new anchor) → rescope moves it
  const segNode2 = findSegNode((k) => k.type === 'span' && k.props['data-phl-anchor'] !== addPayload.anchor)
  assert(segNode2 !== null, 'P2-d: a plain segment in another paragraph is available for rescope')
  const segIndex2 = Number(segNode2.props['data-phl-seg'])
  const segAnchor2 = segNode2.props['data-phl-anchor']
  const segLen2 = textOf(segNode2).length
  // Expected range from the CURRENT overlay structure: live spans + added span.
  const overlaySpans = (liveData.highlights.spans || []).concat([mockAddedSpan])
  const overlaySegs = exportsObj.buildSegmentMap(exportsObj.buildBlocks(liveData.anchors, overlaySpans, liveData.sections))
  const expectedRescope = exportsObj.mapSelection(overlaySegs, { start: { seg: segIndex2, offset: 0 }, end: { seg: segIndex2, offset: segLen2 } })
  assert(expectedRescope && expectedRescope.ok === true, 'P2-d: rescope target segment maps successfully')
  setFakeSelection(segIndex2, segAnchor2, 0, segLen2)
  bodyDiv().props.onMouseUp({})
  assert(writeCapture.length === 1 && writeCapture[0].action === 'rescope', 'P2-d: rescope POST payload action=rescope')
  const resPayload = writeCapture[0]
  assert(resPayload.span_id === addedServerId, 'P2-d: rescope POST payload targets the active span id')
  assert(resPayload.anchor === expectedRescope.anchor && resPayload.char_start === expectedRescope.char_start && resPayload.char_end === expectedRescope.char_end,
    'P2-d: rescope POST payload range equals the embedded mapSelection range')
  await new Promise((r) => setTimeout(r, 200)) // flush mock write + reconcile
  rerender()
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-hint').length === 0, 'P2-d: rescope hint clears after the rescope')
  const marksAfterRescope = marks.filter((m) => m.props.title)
  assert(marksAfterRescope.length === expectedSpans + 1, 'P2-d: mark count unchanged after rescope (still 6)')
  const resMark = marksAfterRescope.find((m) => m.props.key === addedServerId)
  assert(resMark !== undefined && resMark.props['data-phl-anchor'] === segAnchor2, 'P2-d: the res-coped mark now carries the new anchor')

  // ══════════════ P2-e: section list + review-complete signal ══════════════
  // Section bar renders the reviewable sections (data-driven count).
  // NB: chips are className 'phl-section' / 'phl-section phl-section-done' … —
  // the container is 'phl-sections', so match the chip exactly / space-prefixed.
  const isSectionChip = (d) => {
    const c = (d.props.className || '')
    return c === 'phl-section' || c.indexOf('phl-section ') === 0
  }
  const expectedList = exportsObj.sectionList(liveData.sections, liveData.highlights.plan, null)
  const sectionChips = byType.div.filter(isSectionChip)
  assert(sectionChips.length === expectedList.length, 'P2-e: section bar renders ' + expectedList.length + ' reviewable sections (paper_title + empty References skipped)')
  assert(sectionChips.every((c) => c.props['data-phl-sec'] !== undefined), 'P2-e: each section chip carries its section id')

  // Drive the body scroll with a fake DOM target (uniform block tops) and
  // assert the derived current section matches the EMBEDDED currentSectionId.
  const bodyChildren = []
  for (const child of bodyDiv().children || []) {
    const anchor = child && child.props ? child.props['data-phl-anchor'] : null
    if (!anchor) continue
    const top = bodyChildren.length * 40
    bodyChildren.push({ dataset: { phlAnchor: anchor }, offsetTop: top, getBoundingClientRect: () => ({ top }) })
  }
  const fakeScrollTarget = (scrollTop, clientHeight) => ({
    target: { scrollTop, clientHeight, children: bodyChildren, getBoundingClientRect: () => ({ top: 0 }) },
  })
  const scrollTopP2e = 4000
  const clientHeightP2e = 600
  // The component resolves block tops in CONTENT coordinates (rect.top − base +
  // scrollTop), so the expected derivation must add the scroll offset too.
  const expectedCurrent = exportsObj.currentSectionId(
    liveData.sections,
    bodyChildren.map((c, i) => ({ anchorId: c.dataset.phlAnchor, top: i * 40 + scrollTopP2e })),
    scrollTopP2e,
    clientHeightP2e,
  )
  assert(typeof expectedCurrent === 'string' && expectedCurrent.length > 0 && expectedCurrent !== 's1', 'P2-e: a content section is derived as current from the scroll position')
  assert(bodyDiv() && typeof bodyDiv().props.onScroll === 'function', 'P2-e: .phl-body carries the scroll handler')
  bodyDiv().props.onScroll(fakeScrollTarget(scrollTopP2e, clientHeightP2e))
  rerender()
  const chipAfterScroll = byType.div.filter(isSectionChip)
  const currChip = chipAfterScroll.find((c) => c.props['data-phl-sec'] === expectedCurrent)
  assert(currChip !== undefined && (currChip.props.className || '').indexOf('phl-section-curr') >= 0, 'P2-e: current section chip is highlighted')

  // Click 标记本节审查完毕 → POST review_section + optimistic ✓ on the chip.
  const reviewBtn = collectButtons(tree).find((b) => (b.props.className || '').indexOf('phl-review-btn') === 0)
  assert(reviewBtn !== undefined, 'P2-e: review-complete button present in the toolbar')
  writeCapture.length = 0
  reviewBtn.props.onClick()
  assert(writeCapture.length === 1 && writeCapture[0].action === 'review_section' && writeCapture[0].section === expectedCurrent,
    'P2-e: review_section POST payload targets the current section (' + expectedCurrent + ')')
  await new Promise((r) => setTimeout(r, 200)) // flush mock write + reconcile
  rerender()
  const chipsAfterReview = byType.div.filter(isSectionChip)
  const doneChip = chipsAfterReview.find((c) => c.props['data-phl-sec'] === expectedCurrent)
  assert(doneChip !== undefined && (doneChip.props.className || '').indexOf('phl-section-done') >= 0, 'P2-e: reviewed section chip shows the done state (✓)')

  console.log(`\nSIMULATION PASS — bundle renders the paper with ${expectedSpans} highlight marks via the live 3081 data path; P2-c accept/recolor + P2-d selection→add→rescope + P2-e review-complete (section list / current-section / review_section POST) driven (write mocked, real data untouched)`)
})().catch((err) => {
  console.error('SIMULATION FAILED:', err.message)
  process.exit(1)
})
