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
const effectCells = new Map() // effectHookIndex -> {fn, deps, cleanup}
const callbackCells = new Map() // callbackHookIndex -> {fn, deps}
let hookIndex = 0
let effectHookIndex = 0
let callbackHookIndex = 0

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
function useRef(initial) {
  const i = hookIndex++
  let cell = stateCells.get(i)
  if (!cell) {
    cell = { value: { current: initial } }
    stateCells.set(i, cell)
  }
  return cell.value
}
function useEffect(fn, deps) {
  const i = effectHookIndex++
  const cell = effectCells.get(i)
  const prevDeps = cell ? cell.deps : undefined
  // Run when: no prior run, no prior deps recorded, the effect has no deps
  // (runs every render, like React), or the deps changed.
  const changed = !cell || !prevDeps || deps === undefined || prevDeps === undefined ||
    deps.length !== prevDeps.length || deps.some((d, j) => d !== prevDeps[j])
  if (changed) {
    if (cell && typeof cell.cleanup === 'function') cell.cleanup()
    effectQueue.push(() => {
      effectCells.set(i, { deps: deps || null, cleanup: fn() })
    })
  }
}
function useCallback(fn, deps) {
  const i = callbackHookIndex++
  const cell = callbackCells.get(i)
  const d = deps || []
  if (!cell || cell.deps.length !== d.length || d.some((x, j) => x !== cell.deps[j])) {
    callbackCells.set(i, { fn, deps: d })
    return fn
  }
  return cell.fn
}

const reactShim = { useState, useRef, useEffect, useCallback, createElement }

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

// v0.3 Phase 1: profile endpoint is MOCKED (the running 3081 may not have the
// new host route until the user restarts). Two scenarios are driven:
//   has_profile=false → cold-start onboarding panel → POST /init → view switches
//   has_profile=true  → legend / swatches / marks driven by the profile colors
// v0.3 Phase 3: the mock GET serves the full four-layer profile so the edit
// panel renders; POST /save is captured (payload asserted, not applied).
// v0.3 Phase 2: the mock GET serves pending_proposals; POST /apply removes the
// confirmed paper from the list (host-equivalent) + captures the decisions.
const profileState = { has_profile: false, profile: null }
const profileCapture = []
const profileSaveCapture = []
const applyCapture = []
let mockPending = [
  {
    paper_id: 'p-a',
    updated_at: '2026-08-27T00:00:00.000Z',
    proposal: {
      rules: [
        { rule: 'color_semantics: 引言问题/动机类内容归 red', confidence: 'low', from: 's3 节 s-009 被 blue→red 改色' },
        { rule: 'granularity: 高亮默认取短语级短片段', confidence: 'medium', from: 's-003 与 s-006 两次 rescope' },
      ],
      exemplars: [{ span_id: 's-009', suggested: { color: 'blue' }, user_decision: { color: 'red' }, section: 's3', note: '问题/动机类内容用户归 red' }],
      stats: { sections_reviewed: 1, overall_accept_rate: 0, recolor_events: 1 },
    },
  },
  {
    paper_id: 'p-b',
    updated_at: '2026-08-27T00:00:00.000Z',
    proposal: {
      rules: [{ rule: 'value/density: 背景铺垫类句子不提出高亮', confidence: 'high', from: 's3 节 s-010 被删除' }],
      exemplars: [],
      stats: { sections_reviewed: 1, overall_accept_rate: 1 },
    },
  },
  {
    paper_id: 'p-c',
    updated_at: '2026-08-27T00:00:00.000Z',
    proposal: {
      rules: [],
      exemplars: [{ span_id: 's-012', suggested: null, user_decision: { action: 'added', color: 'purple' }, section: 's3', note: '用户节标题 purple 标记' }],
      stats: { sections_reviewed: 1 },
    },
  },
]
const CUSTOM_COLORS = {
  red: { color: '#ff0000', label: '红核心' },
  yellow: { color: '#fff3a0', label: '关键定义/方法' },
  blue: { color: '#8fd0f7', label: '局限/风险' },
  green: { color: '#b0e3a8', label: '可借鉴/启发' },
  purple: { color: '#d9b8f2', label: '待深挖/存疑' },
}
const MOCK_PROFILE = {
  colors: CUSTOM_COLORS,
  rules: [
    { id: 'rule-1', rule: 'density_per_section: 每节 3-5 处', confidence: 'medium', source: 'default-cold-start', enabled: true },
    { id: 'rule-2', rule: 'granularity: 句子级', confidence: 'medium', source: 'default-cold-start', enabled: true },
  ],
  exemplars: [
    { span_id: 's-009', suggested: { color: 'blue' }, user_decision: { color: 'red' }, section: 's3', note: '问题/动机类内容用户归 red' },
    { span_id: 's-012', suggested: null, user_decision: { action: 'added', color: 'purple' }, section: 's3', note: '用户节标题 purple 标记' },
  ],
  stats: {
    papers: [{ paper_id: 'p-mikolov-2013-2013-1-word2vec', sections_reviewed: 1, decided: 4, approved: 2, approve_rate: 0.5, modify_rate: 0.5, change_kinds: { accepted: 0, rejected: 1, recolored: 1, rescoped: 1, user_added: 1, pending: 1 }, color_distribution: { red: 1, blue: 1, purple: 1 } }],
    overall: { papers_reviewed: 1, decided: 4, approved: 2, approve_rate: 0.5, modify_rate: 0.5 },
  },
  reflection_notes: '# 反思笔记（L4b）\n\n测试笔记',
}
function mockProfileHandler(url, opts) {
  if (opts && opts.method === 'POST') {
    const payload = JSON.parse(opts.body || '{}')
    if (url.indexOf('/paper-hl/profile/save') === 0) {
      profileSaveCapture.push({ url, payload })
    } else if (url.indexOf('/paper-hl/profile/apply') === 0) {
      const m = /[?&]paperId=([^&]+)/.exec(url)
      const paperId = m ? decodeURIComponent(m[1]) : null
      applyCapture.push({ url, paperId, payload })
      if (paperId) mockPending = mockPending.filter((p) => p.paper_id !== paperId)
    } else {
      profileCapture.push({ url, payload })
    }
    // init/apply/save answer ok; the subsequent GET re-read reflects the new state
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, has_profile: true }) })
  }
  const res = profileState.has_profile
    ? { ok: true, has_profile: true, profile: profileState.profile, summary: { colors: profileState.profile.colors }, pending_proposals: mockPending }
    : { ok: true, has_profile: false, profile: null, summary: null, pending_proposals: [] }
  return Promise.resolve({ ok: true, status: 200, json: async () => res })
}

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
// v0.5.1: the approve_section mock answers are captured so the interaction test
// can assert the batch round trip (server accepted exactly the section spans).
const approveCapture = []
// v0.5.3: the revert_section mock answers are captured so the interaction test
// can assert the batch round trip (server reverted exactly the section spans
// back to 待审/proposed).
const revertCapture = []
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
      } else if (payload.action === 'approve_section') {
        // v0.5.1: approve_section answers with the batch-accepted spans + a
        // reviewed section entry (mirrors the real host applyApproveSection).
        const sec = (j.sections || []).find((s) => s.id === payload.section)
        const anchors = (sec && sec.anchor_ids) || []
        const accepted = spans.filter((s) => s.status === 'proposed' && anchors.indexOf(s.anchor) >= 0).map((s) => {
          const copy = Object.assign({}, s, { status: 'accepted', decisions: (s.decisions || []).concat([{ action: 'accepted', by: 'user', at: new Date().toISOString() }]) })
          return copy
        })
        result = { ok: true, action: 'approve_section', section: { id: payload.section, status: 'reviewed', reviewed_at: new Date().toISOString() }, accepted, accepted_count: accepted.length, span_count: spans.length }
        approveCapture.push({ section: payload.section, accepted_count: accepted.length, accepted: accepted.map((s) => s.id) })
      } else if (payload.action === 'revert_section') {
        // v0.5.3: revert_section answers with the batch-reverted (待审) spans +
        // a pending section entry (mirrors the real host applyRevertSection:
        // accepted → proposed + section back to pending). 反选 = 恢复待审, NOT reject.
        const sec = (j.sections || []).find((s) => s.id === payload.section)
        const anchors = (sec && sec.anchor_ids) || []
        const reverted = spans.filter((s) => s.status === 'accepted' && anchors.indexOf(s.anchor) >= 0).map((s) => {
          const copy = Object.assign({}, s, { status: 'proposed', decisions: (s.decisions || []).concat([{ action: 'proposed', by: 'user', at: new Date().toISOString() }]) })
          return copy
        })
        result = { ok: true, action: 'revert_section', section: { id: payload.section, status: 'pending' }, reverted, reverted_count: reverted.length, span_count: spans.length }
        revertCapture.push({ section: payload.section, reverted_count: reverted.length, reverted: reverted.map((s) => s.id) })
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

// v0.5 P5: the format POST is MOCKED (payload captured, ok answered). The
// profile mock flips to has_profile:false before the confirm so the post-format
// loadProfile re-read simulates the factory reset (profile deleted → onboarding).
const formatCapture = []
function mockFormatHandler(body) {
  const payload = JSON.parse(body || '{}')
  formatCapture.push(body)
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, scope: payload.scope || 'all', spans_cleared: 0, profile_removed: true }),
  })
}

// v0.5.4 P2-h: the 重新提出高亮 POST is MOCKED (payload captured, ok answered).
// The client POSTs /paper-hl/propose-request?paperId=…; the host would write a
// durable data/<paper_id>/propose-request.json marker. We only verify the
// request + the copied-instruction flash.
const proposeCapture = []
function mockProposeRequestHandler(url, body) {
  const payload = JSON.parse(body || '{}')
  const paperId = payload.paper_id || (url.match(/paperId=([^&]+)/) || [])[1] || 'p-x'
  proposeCapture.push({ url, body })
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, paper_id: paperId, requested_at: new Date().toISOString(), status: 'pending' }),
  })
}

function fetchShim(url, opts) {
  // The paper suite now has 3 papers; the assertion corpus (spans/plan/sections
  // counts, h1 title) is pinned to p-mikolov, so a bare /paper-hl/read (which
  // resolves to the first alphabetical paper) is redirected to it.
  if (url === '/paper-hl/read') url = '/paper-hl/read?paperId=p-mikolov-2013-2013-1-word2vec'
  const target = url.startsWith('/') ? API_ORIGIN + url : url
  if (url.indexOf('/paper-hl/profile') === 0) {
    return mockProfileHandler(url, opts)
  }
  if (opts && opts.method === 'POST' && url.indexOf('/paper-hl/format') === 0) {
    return mockFormatHandler(opts.body)
  }
  if (opts && opts.method === 'POST' && url.indexOf('/paper-hl/propose-request') === 0) {
    return mockProposeRequestHandler(url, opts.body)
  }
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
const keyHandlers = [] // v0.4 Phase 4: registered window keydown handlers
global.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
  getSelection: () => fakeSelection,
  addEventListener: (type, fn) => { if (type === 'keydown') keyHandlers.push(fn) },
  removeEventListener: (type, fn) => {
    const i = keyHandlers.indexOf(fn)
    if (i >= 0) keyHandlers.splice(i, 1)
  },
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
const p2e = ['sectionList', 'currentSectionId', 'phl-section', 'onBodyScroll', 'sectionOverrides', 'currentSection']
for (const needle of p2e) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing P2-e section-state plumbing: ${needle}`)
}
// v0.5.4.3: the 标记本节审查完毕 button + Ctrl+Enter review shortcut are REMOVED
// (the TOC chip click approves-and-marks reviewed, replacing them) — guard that
// none of the removed wiring leaks back into the bundle.
const p2eRemoved = ['phl-review-btn', '标记本节审查完毕', 'markCurrentReviewed', 'markSectionReviewed', '标记当前节审查完毕', 'review_section']
for (const needle of p2eRemoved) {
  if (bundleSrc.includes(needle)) throw new Error(`bundle must NOT contain removed review-button wiring: ${needle}`)
}
console.log('bundle removed review-button wiring guard (v0.5.4.3):', p2eRemoved.join(', '))
const p2f = ['approve_section', 'approveSection', 'localApproveSectionSpans', 'data-phl-sec', '已审批通过']
for (const needle of p2f) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.5.1 approve-section plumbing: ${needle}`)
}
// v0.5.3: reject-section (反选) plumbing — Shift+click batch reject mirror.
const p2g = ['revert_section', 'revertSection', 'localRevertSectionSpans', '已恢复为待审']
for (const needle of p2g) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.5.3 revert-section plumbing: ${needle}`)
}
const p1 = ['colorLegend', 'callProfile', 'profileData', '/paper-hl/profile', '初始化画像', 'phl-onb', 'defaultOnboardDraft', 'has_profile']
for (const needle of p1) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.3 Phase 1 profile plumbing: ${needle}`)
}
const p3 = ['profilePanelModel', 'profileSavePayload', '/paper-hl/profile/save', '个性化画像', 'phl-pnl', '保存全部', '返回论文', '添加规则', 'data-phl-color', 'data-phl-ex']
for (const needle of p3) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.3 Phase 3 profile-panel plumbing: ${needle}`)
}
const p2 = ['proposalCardModel', 'buildApplyDecisions', '待确认画像提案', 'phl-prop', '全部接受', '全部否决', '确认选择', 'data-phl-prop', 'data-phl-paper', 'pendingProposals']
for (const needle of p2) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.3 Phase 2 proposal-panel plumbing: ${needle}`)
}
const p4 = ['keyAction', 'reviewProgress', 'buildExportUrl', 'keydown', 'addEventListener', 'exportOpen', 'exportFormat', 'exportPending', 'phl-exp', 'phl-progress', 'download=1']
for (const needle of p4) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.4 Phase 4 UX plumbing: ${needle}`)
}
const p5 = ['callFormat', 'formatData', '/paper-hl/format', 'phl-fmt', 'phl-format-btn', '确认格式化', '一键格式化']
for (const needle of p5) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.5 format plumbing: ${needle}`)
}
// v0.5.1: legend colored labels. Guard the embedded helper by name so a missing
// toString() embed (which would only surface as a runtime ReferenceError →
// blank page) is caught statically. (v0.5.3: math rendering was removed; the
// legend labels remain.)
const v051 = ['phl-legend-label']
for (const needle of v051) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.5.1 legend-label plumbing: ${needle}`)
}
// v0.5.4 P2-h: 重新提出高亮 (re-propose) — the GUI button POSTs a durable
// propose-request to /paper-hl/propose-request and copies a ready-to-paste
// instruction (请为《…》重新提出高亮) into the clipboard so the user can trigger
// the agent in the conversation. A browser button cannot call the LLM directly;
// this arms the request + makes the trigger one paste.
const p2h = ['callProposeRequest', 'proposeData', '/paper-hl/propose-request', 'phl-repropose-btn', '重新提出高亮', '请为《', 'phl-empty-cta', 'requestRepropose']
for (const needle of p2h) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.5.4 propose-request plumbing: ${needle}`)
}
// v0.5.4.1: sticky top nav — the header/tools + legend + progress + section TOC
// are grouped in .phl-top (position:sticky; top:0; z-index:20), and the wrap's
// overflow:hidden was removed (an overflow:hidden ancestor silently disables
// position:sticky by becoming a non-scrolling scroll container).
const p2i = ['.phl-top', 'position:sticky', 'top:0', 'z-index:20', 'overflow:visible']
for (const needle of p2i) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.5.4.1 sticky-top plumbing: ${needle}`)
}
console.log('bundle sticky-top plumbing (v0.5.4.1):', p2i.join(', '))
// v0.6.1: math render pipeline — guard that every embedded math helper name is
// present in the shipped bundle (missing toString() embed → runtime
// ReferenceError → blank page, the v0.5.1 regression class), plus the .phl-math
// CSS and the data-phl-dlen selection bridge. G2 static side: the CSS must
// style .phl-math WITHOUT any fixed min-width (an empty-width span was the
// v0.5.2 grey-box root cause; the renderText guard folds empty displays, and
// the CSS must not reintroduce a visible box).
const p6 = ['repairMath', 'splitMathPieces', 'mathConvert', 'katexRender', 'buildTextPieces', 'segLen', 'MATH_GREEK', 'MATH_SYMB', 'MATH_ACCENTS', 'MATH_SUB', 'MATH_SUP', 'MATH_BB', 'MATH_BOLD', 'MATH_MONO', 'phl-math', 'data-phl-dlen', '.phl-math{background:rgba(90,120,220,.08)']
// v0.6.1+: KaTeX runtime inlined — the shipped bundle must carry the KaTeX
// engine (own math fonts → no tofu boxes) + its data-URI font CSS.
const p6k = ['// KaTeX (local, inlined)', 'const KATEX_CSS', 'data:font/woff2;base64', 'katex']
// v0.6.2: display-formula anchors render as block-level KaTeX (displayMode).
const p6d = ['phl-math-display', "type === 'interline_equation' ||", 'displayMode: true']
for (const needle of [...p6, ...p6k, ...p6d]) {
  if (!bundleSrc.includes(needle)) throw new Error(`bundle missing v0.6.1+ math/KaTeX plumbing: ${needle}`)
}
console.log('bundle math plumbing (v0.6.1):', p6.join(', '))
console.log('bundle KaTeX plumbing (v0.6.1+):', p6k.join(', '))
console.log('bundle display-formula plumbing (v0.6.2):', p6d.join(', '))
console.log('bundle write-path plumbing (P2-a):', p2a.join(', '))
console.log('bundle interaction state (P2-b):', p2b.join(', '))
console.log('bundle action bar (P2-c):', p2c.join(', '))
console.log('bundle selection→add/rescope (P2-d):', p2d.join(', '))
console.log('bundle review-complete signal (P2-e):', p2e.join(', '))
console.log('bundle approve-section plumbing (v0.5.1):', p2f.join(', '))
console.log('bundle revert-section plumbing (v0.5.3):', p2g.join(', '))
console.log('bundle profile plumbing (v0.3 P1):', p1.join(', '))
console.log('bundle profile-panel plumbing (v0.3 P3):', p3.join(', '))
console.log('bundle proposal-panel plumbing (v0.3 P2):', p2.join(', '))
console.log('bundle keyboard/export/progress plumbing (v0.4 P4):', p4.join(', '))
console.log('bundle one-click format plumbing (v0.5 P5):', p5.join(', '))
console.log('bundle math/legend plumbing (v0.5.1):', v051.join(', '))
console.log('bundle revert-section plumbing (v0.5.3):', p2g.join(', '))
console.log('bundle propose-request plumbing (v0.5.4 P2-h):', p2h.join(', '))

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
effectHookIndex = 0
callbackHookIndex = 0
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
  effectHookIndex = 0
  callbackHookIndex = 0
  tree = entry.Component()
  for (const fn of effectQueue.splice(0)) fn() // v0.4 P4: re-register keydown with fresh closure

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
  let fullText = textOf(tree)

  const assert = (cond, msg) => {
    if (!cond) throw new Error('ASSERT FAILED: ' + msg)
    console.log('  ok:', msg)
  }

  const rerender = () => {
    hookIndex = 0
    effectHookIndex = 0
    callbackHookIndex = 0
    tree = entry.Component()
    while (effectQueue.length) effectQueue.shift()() // flush re-registered effects (keydown)
    view = walkTree(tree)
    marks = view.marks
    byType = view.byType
    return view
  }

  // ══════════════ v0.3 Phase 1: cold-start onboarding (profile MOCKED) ══════════════
  // The profile mock starts with has_profile:false → the mount loadProfile()
  // already switched the view to the onboarding panel (pass 2).
  assert(byType.h1 === undefined || byType.h1.length === 0, 'P1: paper body NOT rendered while onboarding (no h1)')
  const onb = byType.div.find((d) => (d.props.className || '') === 'phl-onb')
  assert(onb !== undefined, 'P1: onboarding panel (.phl-onb) rendered when no profile exists')
  assert(textOf(onb).includes('初始化高亮画像'), 'P1: onboarding panel carries the title')
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-onb-row').length === 5, 'P1: onboarding has 5 color rows (default palette)')
  assert(byType.select.filter((s) => (s.props.className || '') === 'phl-onb-select').length === 2, 'P1: onboarding has density + granularity selects')

  // click 初始化画像 → POST /paper-hl/profile/init with the edited colors +
  // density/granularity baseline rules; the mock then reports has_profile:true
  // so loadProfile() switches the view to the paper body.
  const initBtn = collectButtons(onb).find((b) => textOf(b) === '初始化画像')
  assert(initBtn !== undefined, 'P1: onboarding has the 初始化画像 button')
  profileState.has_profile = true
  profileState.profile = MOCK_PROFILE
  profileCapture.length = 0
  initBtn.props.onClick()
  assert(profileCapture.length === 1 && profileCapture[0].url === '/paper-hl/profile/init', 'P1: init POST targets /paper-hl/profile/init')
  const initPayload = profileCapture[0].payload
  assert(initPayload.colors && Object.keys(initPayload.colors).length === 5, 'P1: init payload carries the 5 colors')
  assert(Array.isArray(initPayload.rules) && initPayload.rules.length === 2 &&
    initPayload.rules[0].rule.indexOf('density_per_section') === 0 && initPayload.rules[1].rule.indexOf('granularity') === 0,
    'P1: init payload carries density + granularity baseline rules')
  await new Promise((r) => setTimeout(r, 200)) // flush loadProfile re-fetch
  rerender()
  fullText = textOf(tree) // recompute after the view switched back to the paper body
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-onb').length === 0, 'P1: onboarding panel dismissed after init')
  assert(byType.h1 && byType.h1.length === 1, 'P1: paper body renders again after onboarding (h1 present)')

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
  // Live span count, minus rejected spans (excludeRejected: rejected spans are
  // kept in JSON but never rendered as marks) — data-adaptive so a user's
  // browser walkthrough (accept/reject/add) never breaks the assertion.
  const expectedSpans = await fetchShim('/paper-hl/read').then((r) => r.json()).then((j) => (j.ok ? j.highlights.spans.filter((s) => s.status !== 'rejected').length : -1))
  assert(expectedSpans > 0, 'live /paper-hl/read serves spans (got ' + expectedSpans + ')')
  assert(spanMarks.length === expectedSpans, spanMarks.length + ' highlight marks match live span count (' + expectedSpans + ')')

  // v0.3 Phase 1: mark chips resolve the profile palette (colors.yml-driven)
  const liveSpansP1 = await fetchShim('/paper-hl/read').then((r) => r.json()).then((j) => (j.ok ? j.highlights.spans : []))
  const redLive = liveSpansP1.find((s) => s.color === 'red' && s.status !== 'rejected')
  if (redLive) {
    const redMarkP1 = spanMarks.find((m) => m.props.key === redLive.id)
    assert(redMarkP1 && redMarkP1.props.style.background === '#ff0000', 'P1: a red-span mark renders with the profile color #ff0000 (not the built-in #ff9c94)')
  }

  const colors = {}
  for (const m of spanMarks) colors[m.props.style.background] = (colors[m.props.style.background] || 0) + 1
  console.log('  span mark colors:', JSON.stringify(colors))
  assert(spanMarks.some((m) => m.props.title.includes('核心贡献')), 'a mark carries the rationale tooltip')

  assert(byType.select && byType.select.length === 1, 'paper selector present')
  assert(byType.button && byType.button.some((b) => textOf(b).includes('刷新')), 'refresh button present')

  assert(byType.mark && fullText.includes('红核心') && fullText.includes('待深挖/存疑'), 'legend driven by the profile colors (custom red label 红核心 present)')

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
  assert(marksAfterRescope.length === expectedSpans + 1, 'P2-d: mark count unchanged after rescope (still ' + (expectedSpans + 1) + ')')
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

  // v0.5.4.3: the 标记本节审查完毕 toolbar button was REMOVED — the TOC chip
  // click (approve + mark reviewed) fully replaces it. Assert the rendered tree
  // carries no review-button (belt-and-suspenders over the static bundle guard).
  const reviewBtns = collectButtons(tree).filter((b) => (b.props.className || '').indexOf('phl-review-btn') === 0)
  assert(reviewBtns.length === 0, 'v0.5.4.3: review-complete button removed from the toolbar')

  // ══════════════ v0.5.1: section TOC click → batch approve ══════════════
  // Clicking a section chip approves ALL its highlights (POST approve_section)
  // and marks it reviewed — even when the agent proposed none. Pick the first
  // content chip that is not the already-reviewed current section.
  const targetSec = expectedList.find((s) => s.id !== expectedCurrent && !s.reviewed && s.id !== 's1')
  assert(targetSec !== undefined, 'P2-f: another unreviewed content section exists for the approve-click test')
  const targetChip = byType.div.filter(isSectionChip).find((c) => c.props['data-phl-sec'] === targetSec.id)
  assert(targetChip !== undefined && typeof targetChip.props.onClick === 'function', 'P2-f: section chip carries an onClick (TOC approve)')
  const proposedBefore = (liveData.highlights.spans || []).filter((s) => s.status === 'proposed' && (targetSec.anchor_ids || []).indexOf(s.anchor) >= 0).length
  writeCapture.length = 0
  approveCapture.length = 0
  targetChip.props.onClick()
  assert(writeCapture.length === 1 && writeCapture[0].action === 'approve_section' && writeCapture[0].section === targetSec.id,
    'P2-f: approve_section POST payload targets the clicked section (' + targetSec.id + ')')
  await new Promise((r) => setTimeout(r, 200)) // flush mock write + reconcile
  rerender()
  const chipsAfterApprove = byType.div.filter(isSectionChip)
  const approvedChip = chipsAfterApprove.find((c) => c.props['data-phl-sec'] === targetSec.id)
  assert(approvedChip !== undefined && (approvedChip.props.className || '').indexOf('phl-section-done') >= 0, 'P2-f: approved section chip shows the done state (✓)')
  assert(approveCapture.length === 1 && approveCapture[0].section === targetSec.id, 'P2-f: mock approve_section answered for the clicked section')
  assert(approveCapture[0].accepted_count === proposedBefore && approveCapture[0].accepted.length === proposedBefore,
    'P2-f: server accepted exactly the section spans (' + targetSec.id + ': ' + proposedBefore + ' proposed → all accepted)')
  assert(approveCapture[0].accepted.every((id) => (liveData.highlights.spans || []).find((s) => s.id === id) && (targetSec.anchor_ids || []).indexOf((liveData.highlights.spans || []).find((s) => s.id === id).anchor) >= 0),
    'P2-f: every accepted span belongs to the clicked section')

  // ══════════════ v0.5.3: section TOC Shift+click → batch 反选 (revert to 待审) ══════════════
  // Shift+clicking a section chip REVERTS every accepted highlight in the
  // section back to proposed (待审) + sets the section back to pending (POST
  // revert_section) — the inverse of the plain click (反选 = 恢复待审, NOT reject).
  const targetSec2 = expectedList.find((s) => s.id !== targetSec.id && s.id !== expectedCurrent && s.reviewed && s.id !== 's1')
  assert(targetSec2 !== undefined, 'P2-g: a reviewed content section exists for the revert-click test (target the one just approved)')
  const targetChip2 = byType.div.filter(isSectionChip).find((c) => c.props['data-phl-sec'] === targetSec2.id)
  assert(targetChip2 !== undefined && typeof targetChip2.props.onClick === 'function', 'P2-g: section chip carries an onClick (TOC revert)')
  const acceptedBefore2 = (liveData.highlights.spans || []).filter((s) => s.status === 'accepted' && (targetSec2.anchor_ids || []).indexOf(s.anchor) >= 0).length
  writeCapture.length = 0
  revertCapture.length = 0
  targetChip2.props.onClick({ shiftKey: true })
  assert(writeCapture.length === 1 && writeCapture[0].action === 'revert_section' && writeCapture[0].section === targetSec2.id,
    'P2-g: revert_section POST payload targets the Shift-clicked section (' + targetSec2.id + ')')
  await new Promise((r) => setTimeout(r, 200)) // flush mock write + reconcile
  rerender()
  const chipsAfterRevert = byType.div.filter(isSectionChip)
  const revertedChip = chipsAfterRevert.find((c) => c.props['data-phl-sec'] === targetSec2.id)
  assert(revertedChip !== undefined && (revertedChip.props.className || '').indexOf('phl-section-done') < 0, 'P2-g: reverted section chip no longer shows the done state (back to 待审查)')
  assert(revertCapture.length === 1 && revertCapture[0].section === targetSec2.id, 'P2-g: mock revert_section answered for the Shift-clicked section')
  assert(revertCapture[0].reverted_count === acceptedBefore2 && revertCapture[0].reverted.length === acceptedBefore2,
    'P2-g: server reverted exactly the section spans (' + targetSec2.id + ': ' + acceptedBefore2 + ' accepted → all back to 待审/proposed)')
  assert(revertCapture[0].reverted.every((id) => (liveData.highlights.spans || []).find((s) => s.id === id) && (targetSec2.anchor_ids || []).indexOf((liveData.highlights.spans || []).find((s) => s.id === id).anchor) >= 0),
    'P2-g: every reverted span belongs to the Shift-clicked section')

  // ══════════════ v0.3 Phase 3: profile edit panel ══════════════
  const saveAllBtn = () => collectButtons(tree).find((b) => textOf(b) === '保存全部')
  const profileBtn = collectButtons(tree).find((b) => (b.props.className || '').indexOf('phl-profile-btn') === 0)
  assert(profileBtn !== undefined, 'P3: 画像 toolbar button present')
  profileBtn.props.onClick()
  rerender()
  const pnl = byType.div.find((d) => (d.props.className || '') === 'phl-pnl')
  assert(pnl !== undefined, 'P3: profile panel (.phl-pnl) rendered after clicking 画像')
  const pnlText = textOf(pnl)
  assert(pnlText.includes('个性化画像') && pnlText.includes('L1') && pnlText.includes('L2') && pnlText.includes('L3') && pnlText.includes('L4a') && pnlText.includes('L4b'),
    'P3: panel renders the four layers (L1 colors … L4b notes)')
  assert(byType.div.filter((d) => d.props['data-phl-color'] !== undefined).length === 5, 'P3: 5 color rows')
  assert(byType.div.filter((d) => d.props['data-phl-rule'] !== undefined).length === 2, 'P3: 2 rule rows (rule-1/rule-2)')
  assert(byType.div.filter((d) => d.props['data-phl-ex'] !== undefined).length === 2, 'P3: 2 exemplar rows')
  assert(byType.div.filter((d) => (d.props.className || '').indexOf('phl-pnl-stats-row') >= 0).length === 1, 'P3: 1 stats row (per-paper)')
  const notesTa = byType.textarea ? byType.textarea.filter((t) => (t.props.className || '') === 'phl-pnl-notes') : []
  assert(notesTa.length === 1, 'P3: notes textarea present')
  assert(saveAllBtn() !== undefined, 'P3: 保存全部 button present')

  // edit the red hex → 保存全部 → POST /profile/save with the edited color
  profileSaveCapture.length = 0
  const redHex = byType.input.filter((i) => (i.props.className || '') === 'phl-pnl-hex')[0]
  redHex.props.onChange({ target: { value: '#112233' } })
  rerender()
  saveAllBtn().props.onClick()
  assert(profileSaveCapture.length === 1 && profileSaveCapture[0].url === '/paper-hl/profile/save', 'P3: save POST targets /paper-hl/profile/save')
  let savePayload = profileSaveCapture[0].payload
  assert(savePayload.colors && savePayload.colors.red && savePayload.colors.red.color === '#112233', 'P3: save payload carries the edited red hex')
  assert(savePayload.colors.red.label === '红核心', 'P3: save payload keeps the red label')
  assert(savePayload.rules && savePayload.rules.length === 2, 'P3: save payload carries the full rule list')

  // toggle rule-1 enabled off → save
  profileSaveCapture.length = 0
  const ruleOns = byType.input.filter((i) => (i.props.className || '') === 'phl-pnl-rule-on')
  assert(ruleOns.length === 2, 'P3: 2 rule enable checkboxes')
  ruleOns[0].props.onChange({ target: { checked: false } })
  rerender()
  saveAllBtn().props.onClick()
  savePayload = profileSaveCapture[0].payload
  assert(savePayload.rules[0].id === 'rule-1' && savePayload.rules[0].enabled === false, 'P3: save payload carries rule-1 disabled (id preserved)')

  // remove the first exemplar → save
  profileSaveCapture.length = 0
  const exRows = byType.div.filter((d) => d.props['data-phl-ex'] !== undefined)
  const exDel = collectButtons(exRows[0]).find((b) => (b.props.className || '').indexOf('phl-pnl-del') === 0)
  assert(exDel !== undefined, 'P3: exemplar rows carry a delete button')
  exDel.props.onClick()
  rerender()
  assert(byType.div.filter((d) => d.props['data-phl-ex'] !== undefined).length === 1, 'P3: exemplar row removed from the draft')
  saveAllBtn().props.onClick()
  savePayload = profileSaveCapture[0].payload
  assert(savePayload.exemplars && savePayload.exemplars.length === 1, 'P3: save payload carries the reduced exemplar list')

  // edit notes → save
  profileSaveCapture.length = 0
  notesTa[0].props.onChange({ target: { value: 'updated reflection note' } })
  rerender()
  saveAllBtn().props.onClick()
  savePayload = profileSaveCapture[0].payload
  assert(savePayload.reflection_notes === 'updated reflection note', 'P3: save payload carries the edited notes')

  // add a new rule → row appears → save carries 3 rules
  profileSaveCapture.length = 0
  const newRuleInput = byType.input.filter((i) => (i.props.className || '').indexOf('phl-pnl-rule-new') >= 0)[0]
  newRuleInput.props.onChange({ target: { value: 'value/density: 背景铺垫类句子不高亮' } })
  rerender()
  const addRuleBtn = collectButtons(tree).find((b) => textOf(b) === '添加规则')
  assert(addRuleBtn !== undefined, 'P3: 添加规则 button present')
  addRuleBtn.props.onClick()
  rerender()
  assert(byType.div.filter((d) => d.props['data-phl-rule'] !== undefined).length === 3, 'P3: new rule row appended to the draft')
  saveAllBtn().props.onClick()
  savePayload = profileSaveCapture[0].payload
  assert(savePayload.rules.length === 3 && savePayload.rules[2].rule === 'value/density: 背景铺垫类句子不高亮', 'P3: save payload carries the new rule (no id → host assigns)')

  // back to the paper view
  const backBtn = collectButtons(tree).find((b) => textOf(b) === '← 返回论文')
  assert(backBtn !== undefined, 'P3: 返回论文 button present')
  backBtn.props.onClick()
  rerender()
  assert(byType.h1 && byType.h1.length === 1, 'P3: paper view restored after closing the panel')
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-pnl').length === 0, 'P3: panel dismissed')

  // ══════════════ v0.3 Phase 2: pending-proposal confirmation panel ══════════════
  // The toolbar 提案 button shows the pending count from the mock GET; the
  // panel lists one card per pending reflect proposal with per-item toggles.
  const propBtn = collectButtons(tree).find((b) => (b.props.className || '').indexOf('phl-prop-btn') === 0)
  assert(propBtn !== undefined, 'P2: 提案 toolbar button present')
  assert(textOf(propBtn).indexOf('提案 (3)') === 0, 'P2: 提案 button carries the pending count badge (3)')
  propBtn.props.onClick()
  rerender()
  const propPanel = byType.div.find((d) => (d.props.className || '') === 'phl-pnl')
  assert(propPanel !== undefined && textOf(propPanel).includes('待确认画像提案'), 'P2: proposals panel rendered')
  const cards = byType.div.filter((d) => d.props['data-phl-paper'] !== undefined)
  assert(cards.length === 3, 'P2: 3 proposal cards (p-a / p-b / p-c)')
  assert(cards[0].props['data-phl-paper'] === 'p-a', 'P2: first card is p-a')
  const pAItems = byType.button.filter((b) => b.props['data-phl-prop'] !== undefined)
  // p-a: 2 rules + 1 exemplar = 3 items × 2 buttons (接受/否决) = 6
  assert(pAItems.length >= 6, 'P2: per-item 接受/否决 buttons rendered')

  // 全部接受 on p-a → POST /apply?paperId=p-a {decisions:{accept:'all'}} → card gone
  applyCapture.length = 0
  const acceptAllBtn = collectButtons(cards[0]).find((b) => textOf(b) === '全部接受')
  assert(acceptAllBtn !== undefined, 'P2: card has 全部接受 button')
  acceptAllBtn.props.onClick()
  assert(applyCapture.length === 1 && applyCapture[0].paperId === 'p-a', 'P2: apply POST targets paperId=p-a')
  assert(JSON.stringify(applyCapture[0].payload.decisions) === '{"accept":"all"}', 'P2: 全部接受 payload {accept:"all"}')
  await new Promise((r) => setTimeout(r, 200)) // flush loadProfile re-fetch
  rerender()
  assert(byType.div.filter((d) => d.props['data-phl-paper'] !== undefined).length === 2, 'P2: confirmed card removed (2 left)')

  // 确认选择 with an empty selection → no POST, flash error
  applyCapture.length = 0
  const cards2 = byType.div.filter((d) => d.props['data-phl-paper'] !== undefined)
  const pBConfirm = collectButtons(cards2.find((c) => c.props['data-phl-paper'] === 'p-b')).find((b) => textOf(b).indexOf('确认选择') === 0)
  assert(pBConfirm !== undefined, 'P2: p-b card has 确认选择 button')
  pBConfirm.props.onClick()
  assert(applyCapture.length === 0, 'P2: empty selection does NOT POST')
  rerender()
  assert(byType.div.filter((d) => (d.props.className || '').indexOf('phl-flash-error') >= 0).length >= 1, 'P2: empty selection flashes an error')

  // select rule-0 接受 on p-b → 确认选择 → POST {accept:['rule-0']} → card gone
  applyCapture.length = 0
  const pBItems = byType.button.filter((b) => b.props['data-phl-prop'] !== undefined)
  const pBRule0Accept = pBItems.find((b) => b.props['data-phl-prop'] === 'rule-0' && textOf(b) === '接受')
  assert(pBRule0Accept !== undefined, 'P2: p-b rule-0 接受 toggle present')
  pBRule0Accept.props.onClick()
  rerender()
  const pBConfirm2 = collectButtons(byType.div.find((d) => d.props['data-phl-paper'] === 'p-b')).find((b) => textOf(b).indexOf('确认选择') === 0)
  pBConfirm2.props.onClick()
  assert(applyCapture.length === 1 && applyCapture[0].paperId === 'p-b', 'P2: apply POST targets paperId=p-b (逐条)')
  assert(JSON.stringify(applyCapture[0].payload.decisions) === '{"accept":["rule-0"]}', 'P2: 确认选择 payload {accept:["rule-0"]} (proposal-relative id)')
  await new Promise((r) => setTimeout(r, 200))
  rerender()
  assert(byType.div.filter((d) => d.props['data-phl-paper'] !== undefined).length === 1, 'P2: p-b card removed (1 left)')

  // 全部否决 on p-c → POST {reject:'all'} → empty state
  applyCapture.length = 0
  const pCRejectAll = collectButtons(byType.div.find((d) => d.props['data-phl-paper'] === 'p-c')).find((b) => textOf(b) === '全部否决')
  assert(pCRejectAll !== undefined, 'P2: p-c card has 全部否决 button')
  pCRejectAll.props.onClick()
  assert(applyCapture.length === 1 && applyCapture[0].paperId === 'p-c' && JSON.stringify(applyCapture[0].payload.decisions) === '{"reject":"all"}',
    'P2: 全部否决 payload {reject:"all"}')
  await new Promise((r) => setTimeout(r, 200))
  rerender()
  assert(byType.div.filter((d) => d.props['data-phl-paper'] !== undefined).length === 0, 'P2: all cards confirmed/rejected')
  assert(textOf(byType.div.find((d) => (d.props.className || '') === 'phl-pnl')).includes('没有待确认的画像提案'), 'P2: empty state shown')

  // back to the paper view
  const backBtn2 = collectButtons(tree).find((b) => textOf(b) === '← 返回论文')
  backBtn2.props.onClick()
  rerender()
  assert(byType.h1 && byType.h1.length === 1, 'P2: paper view restored after closing the proposals panel')

  // ══════════════ v0.4 Phase 4: progress bar + export dialog + keyboard ══════════════
  // Progress bar derives from sectionItems (plan + the optimistic override the
  // P2-e review_section test added), via the EMBEDDED reviewProgress.
  const progressOverrides = {}
  progressOverrides[expectedCurrent] = { status: 'reviewed' }
  const expectedProgress = exportsObj.reviewProgress(exportsObj.sectionList(liveData.sections, liveData.highlights.plan, progressOverrides))
  const expDiv = () => byType.div.find((d) => (d.props.className || '') === 'phl-exp')
  const prog = byType.div.find((d) => (d.props.className || '') === 'phl-progress')
  assert(prog !== undefined, 'P4: progress bar (.phl-progress) rendered')
  assert(textOf(prog).includes('已审 ' + expectedProgress.done + '/' + expectedProgress.total + ' 节'),
    'P4: progress bar text = 已审 done/total 节 (' + expectedProgress.done + '/' + expectedProgress.total + ')')
  const fill = byType.div.find((d) => (d.props.className || '') === 'phl-progress-fill')
  assert(fill !== undefined && fill.props.style.width === expectedProgress.ratio + '%', 'P4: progress fill width = ratio%')
  assert(expectedProgress.nextId
    ? textOf(prog).includes('下一个：')
    : textOf(prog).includes('全部节已审查'), 'P4: progress hints the next unreviewed section (or all-done)')

  // Export dialog: toolbar 导出 → dialog with a download URL into the P1 route.
  const exportBtn = collectButtons(tree).find((b) => (b.props.className || '').indexOf('phl-export-btn') === 0)
  assert(exportBtn !== undefined, 'P4: 导出 toolbar button present')
  assert(expDiv() === undefined, 'P4: export dialog closed by default')
  exportBtn.props.onClick()
  rerender()
  const exp = expDiv()
  assert(exp !== undefined, 'P4: export dialog (.phl-exp) opens after clicking 导出')
  const dl = byType.a.find((a) => a.props['data-phl-export-url'] !== undefined)
  assert(dl !== undefined, 'P4: download link present')
  assert(dl.props.href === exportsObj.buildExportUrl(liveData.paperId, 'html', false, true),
    'P4: download URL defaults to html + download=1 (no pending)')
  const radios = byType.input.filter((i) => i.props.type === 'radio')
  assert(radios.length === 2, 'P4: two format radios (html/md)')
  const mdRadio = radios.find((i) => i.props.checked === false)
  mdRadio.props.onChange()
  rerender()
  const dl2 = byType.a.find((a) => a.props['data-phl-export-url'] !== undefined)
  assert(dl2.props.href.indexOf('format=md') >= 0, 'P4: switching to md updates the download URL')
  const pendingChk = byType.input.find((i) => i.props.type === 'checkbox')
  assert(pendingChk !== undefined, 'P4: include-pending checkbox present')
  pendingChk.props.onChange({ target: { checked: true } })
  rerender()
  const dl3 = byType.a.find((a) => a.props['data-phl-export-url'] !== undefined)
  assert(dl3.props.href.indexOf('format=md') >= 0 && dl3.props.href.indexOf('include_pending=1') >= 0 && dl3.props.href.indexOf('download=1') >= 0,
    'P4: download URL carries format=md + include_pending=1 + download=1')
  const cancelBtn = collectButtons(expDiv()).find((b) => textOf(b) === '取消')
  assert(cancelBtn !== undefined, 'P4: export dialog has a 取消 button')
  cancelBtn.props.onClick()
  rerender()
  assert(expDiv() === undefined, 'P4: export dialog closes via 取消')

  // Keyboard dispatch through the REAL keydown effect path (window shim).
  const keydown = (key, extra) => keyHandlers[keyHandlers.length - 1](Object.assign(
    { key, target: { tagName: 'BODY' }, ctrlKey: false, metaKey: false, altKey: false }, extra || {}))
  assert(keyHandlers.length === 1, 'P4: exactly one live keydown handler (fresh closure)')
  writeCapture.length = 0
  keydown('d')
  assert(writeCapture.length === 0, 'P4: d with no active span does nothing')
  // click a mark → action bar open → d → reject POST for the active span
  const marksNow = marks.filter((m) => m.props.title)
  const markForReject = marksNow[0]
  assert(markForReject !== undefined && typeof markForReject.props.onClick === 'function', 'P4: a clickable mark exists for the keyboard test')
  markForReject.props.onClick(clickEvent())
  rerender()
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-ab').length === 1, 'P4: action bar open after mark click (keyboard target)')
  assert(keyHandlers.length === 1, 'P4: keydown handler re-registered after mark click')
  writeCapture.length = 0
  keydown('d')
  assert(writeCapture.length === 1 && writeCapture[0].action === 'reject' && writeCapture[0].span_id === markForReject.props.key,
    'P4: d dispatches reject POST for the active span')
  // 3 → recolor the active span to palette[2] (blue)
  writeCapture.length = 0
  keydown('3')
  assert(writeCapture.length === 1 && writeCapture[0].action === 'recolor' && writeCapture[0].color === 'blue',
    'P4: 3 dispatches recolor to palette[2] (blue)')
  // Escape closes the action bar without a write
  writeCapture.length = 0
  keydown('Escape')
  rerender()
  assert(writeCapture.length === 0, 'P4: Escape sends no write')
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-ab').length === 0, 'P4: Escape closes the action bar')
  // input focus → ignored
  writeCapture.length = 0
  const inputKeydown = () => keyHandlers[keyHandlers.length - 1]({ key: 'a', target: { tagName: 'INPUT' }, ctrlKey: false, metaKey: false, altKey: false })
  inputKeydown()
  assert(writeCapture.length === 0, 'P4: input-focused a is ignored')

  // ══════════════ v0.5.4 P2-h: 重新提出高亮 (re-propose request + copied instruction) ══════════════
  // The toolbar button POSTs /paper-hl/propose-request?paperId=… {paper_id} and
  // flashes the ready-to-paste instruction 「请为《…》重新提出高亮」so the user can
  // trigger the agent in the conversation (a browser button cannot call the LLM).
  const reproposeBtn = collectButtons(tree).find((b) => (b.props.className || '').indexOf('phl-repropose-btn') === 0)
  assert(reproposeBtn !== undefined, 'P2-h: 重新提出高亮 toolbar button present')
  proposeCapture.length = 0
  reproposeBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 50)) // flush the propose-request POST + flash
  rerender()
  fullText = textOf(tree)
  assert(proposeCapture.length === 1, 'P2-h: 重新提出高亮 POSTs exactly once')
  const proposeUrl = proposeCapture[0].url
  const proposeBody = JSON.parse(proposeCapture[0].body)
  assert(proposeUrl.indexOf('/paper-hl/propose-request') === 0 && proposeBody.paper_id === liveData.paperId,
    'P2-h: POST targets /paper-hl/propose-request?paperId=… with {paper_id}')
  assert(fullText.includes('已记录请求') && fullText.includes('请为《'), 'P2-h: flash confirms the request + shows the paste-ready instruction')
  assert(fullText.includes('重新提出高亮'), 'P2-h: flash names the 重新提出高亮 trigger')

  // ══════════════ v0.5: one-click format (一键格式化) ══════════════
  const fmtBtn = collectButtons(tree).find((b) => (b.props.className || '').indexOf('phl-format-btn') === 0)
  assert(fmtBtn !== undefined, 'P5: 格式化 toolbar button present')
  const fmtDiv = () => byType.div.find((d) => d.props['data-phl-format'] !== undefined)
  assert(fmtDiv() === undefined, 'P5: format dialog closed by default')
  fmtBtn.props.onClick()
  rerender()
  const fmtDlg = fmtDiv()
  assert(fmtDlg !== undefined, 'P5: format dialog (.phl-fmt) opens after clicking 格式化')
  const fmtText = textOf(fmtDlg)
  assert(fmtText.includes('一键格式化') && fmtText.includes('危险操作'), 'P5: format dialog warns about the destructive operation')
  assert(fmtText.includes('高亮记录') && fmtText.includes('个性化画像') && fmtText.includes('不可撤销'),
    'P5: format dialog lists what will be cleared + irreversible note')
  // 取消 closes without POST
  formatCapture.length = 0
  const fmtCancel = collectButtons(fmtDlg).find((b) => textOf(b) === '取消')
  assert(fmtCancel !== undefined, 'P5: format dialog has a 取消 button')
  fmtCancel.props.onClick()
  rerender()
  assert(fmtDiv() === undefined && formatCapture.length === 0, 'P5: 取消 closes the dialog without POST')
  // confirm → POST {confirm:true, scope:'all'} → dialog closes + view returns to
  // cold-start onboarding (the profile mock flipped to has_profile:false).
  fmtBtn.props.onClick()
  rerender()
  formatCapture.length = 0
  profileState.has_profile = false // host-side effect: the profile was deleted
  const fmtConfirm = collectButtons(fmtDiv()).find((b) => textOf(b) === '确认格式化')
  assert(fmtConfirm !== undefined, 'P5: format dialog has a 确认格式化 button')
  fmtConfirm.props.onClick()
  assert(formatCapture.length === 1, 'P5: 确认格式化 POSTs exactly once')
  const fmtPayload = JSON.parse(formatCapture[0])
  assert(fmtPayload.confirm === true && fmtPayload.scope === 'all', 'P5: format POST body {confirm:true, scope:"all"}')
  await new Promise((r) => setTimeout(r, 200)) // flush loadProfile + load re-fetch
  rerender()
  fullText = textOf(tree)
  assert(fmtDiv() === undefined, 'P5: format dialog closes after confirm')
  assert(fullText.includes('已格式化'), 'P5: success flash shows 已格式化')
  assert(byType.div.filter((d) => (d.props.className || '') === 'phl-onb').length >= 1,
    'P5: view returns to cold-start onboarding (profile cleared, factory reset)')

  console.log(`\nSIMULATION PASS — bundle renders the paper with ${expectedSpans} highlight marks via the live 3081 data path; P1 cold-start onboarding (init POST + profile-driven legend/marks) + P2-c accept/recolor + P2-d selection→add→rescope + P2-e review-complete + P2-f section-TOC approve (chip click → approve_section POST → batch accept + reviewed ✓, server accepted exactly the section spans) + P2-g section-TOC 反选 (Shift+chip click → revert_section POST → accepted back to 待审/proposed + chip back to 待审查, server reverted exactly the section spans) + P2-h 重新提出高亮 (toolbar button → POST /paper-hl/propose-request {paper_id} → flash 已记录请求 + 请为《…》重新提出高亮 instruction) + P3 profile edit panel (colors/rules/exemplars/notes edits → /save payloads, add/remove rules, back to paper) + P2 proposal confirmation panel (全部接受 / 确认选择 rule-0 / 全部否决 → /apply payloads, empty-selection guard, cards removed) + P4 progress bar (reviewed/total + ratio + next hint) + export dialog (format md + include_pending + download=1 URL) + keyboard shortcuts (d→reject POST, 3→recolor blue, Escape closes bar, input-focus ignored) + P5 one-click format (格式化 button → warning dialog → 取消 closes w/o POST / 确认格式化 → POST {confirm:true, scope:"all"} → dialog closes + returns to cold-start onboarding) driven (write + profile + format + propose-request mocked, real data untouched)`)
})().catch((err) => {
  console.error('SIMULATION FAILED:', err.message)
  process.exit(1)
})
