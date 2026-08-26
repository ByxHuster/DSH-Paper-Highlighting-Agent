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

// ── fetch shim → the REAL 3081 route (resolve relative URLs like a browser) ─
const API_ORIGIN = 'http://127.0.0.1:3081'
function fetchShim(url) {
  const target = url.startsWith('/') ? API_ORIGIN + url : url
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
global.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
}
global.document = documentShim
global.fetch = fetchShim

const bundleSrc = fs.readFileSync(BUNDLE, 'utf8')
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

  const isMark = (n) => typeof n === 'object' && n && n.type === 'mark'
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
  walk(tree)
  console.log('pass2 node:', tree.type)

  // assertions
  const textOf = (n) => (typeof n === 'string' ? n : Array.isArray(n.children) ? n.children.map(textOf).join('') : '')
  const fullText = textOf(tree)

  const assert = (cond, msg) => {
    if (!cond) throw new Error('ASSERT FAILED: ' + msg)
    console.log('  ok:', msg)
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

  console.log(`\nSIMULATION PASS — bundle renders the paper with ${expectedSpans} highlight marks via the live 3081 data path`)
})().catch((err) => {
  console.error('SIMULATION FAILED:', err.message)
  process.exit(1)
})
