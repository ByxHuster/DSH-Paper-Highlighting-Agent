'use strict'

/**
 * paper-highlight · paper-level reflection template tests (v0.4 Phase 3)
 *
 * Pure-function matrix for host/reflection.js paperReflectionTemplate:
 *   - empty / cold-start (no highlights content, no diff, no profileSummary)
 *   - full-acceptance diff (counts + accept_rate, no samples)
 *   - diff with rejected + recolored + added samples (sample lines rendered)
 *   - profileSummary rendered into the 沉淀偏好 line
 *   - sections provided -> per-section table with span counts
 *   - lossless string output, deterministic via `now`
 *
 * Run:  node test/run-reflect-paper.js
 */

const { assert } = require('./verify')
const { paperReflectionTemplate, sectionTable, fmtCount, sampleLines, paperReflectionFile } = require('../host/reflection')
const { summarizeDiff } = require('../host/diff')
const { buildSections } = require('../host/sections')

const NOW = '2026-08-27T08:00:00.000Z'

function makeDoc() {
  const paperMd = ['# Title', '', '## Abstract', '', 'Abstract body text.', '', '## Method', '', 'Method body text.', '', '## References', ''].join('\n')
  const find = (s) => paperMd.indexOf(s)
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: find('Title') },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'title', text: 'Abstract', md_offset: find('Abstract') },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'Abstract body text.', md_offset: find('Abstract body text.') },
    'a-0001-04-01': { page: 1, block: 4, par: 1, type: 'title', text: 'Method', md_offset: find('Method') },
    'a-0001-05-01': { page: 1, block: 5, par: 1, type: 'text', text: 'Method body text.', md_offset: find('Method body text.') },
    'a-0001-06-01': { page: 1, block: 6, par: 1, type: 'title', text: 'References', md_offset: find('References') },
  }
  return {
    paper: { id: 'p-test', title: 'Test Paper' },
    anchors,
    plan: {
      summary: '该论文的贡献在于 X，方法围绕 Y，实验支撑 Z。',
      sections: [
        { id: 's2', section: 'Abstract', status: 'reviewed' },
        { id: 's3', section: 'Method', status: 'pending' },
      ],
    },
    spans: [],
    duplicates: [],
  }
}

function span(id, anchor, color, status, decisions, rationale) {
  return { id, anchor, char_start: 0, char_end: 5, color, rationale: rationale || '', status, decisions: decisions || [] }
}

function main() {
  // ── empty / cold-start ────────────────────────────────────────────────────
  const empty = paperReflectionTemplate({ now: NOW })
  assert(typeof empty === 'string' && empty.startsWith('# 论文级反思 — '), 'empty: renders a markdown string')
  assert(empty.includes('已审查 0 / 0 节') && empty.includes('认可率（accepted/decided）0'), 'empty: zeroed counters')
  assert(empty.includes('画像现状：无画像（冷启动）'), 'empty: cold-start profile line')
  assert(!/[^\\]undefined/.test(empty) && !empty.includes('NaN'), 'empty: lossless (no undefined/NaN)')

  // ── full acceptance ───────────────────────────────────────────────────────
  const docAccept = makeDoc()
  docAccept.spans = [
    span('s-001', 'a-0001-03-01', 'red', 'accepted', [{ action: 'proposed', by: 'agent' }, { action: 'accepted', by: 'user' }], '核心贡献'),
    span('s-002', 'a-0001-05-01', 'yellow', 'accepted', [{ action: 'proposed', by: 'agent' }, { action: 'accepted', by: 'user' }], '方法定义'),
  ]
  const diffAccept = summarizeDiff(docAccept.spans)
  const mdAccept = paperReflectionTemplate({ highlights: docAccept, diff: diffAccept, now: NOW })
  assert(mdAccept.includes('该论文的贡献在于 X'), 'accept: plan.summary in 论文概述')
  assert(mdAccept.includes('已审查 1 / 2 节'), 'accept: reviewed count 1/2')
  assert(mdAccept.includes('总 spans 2') && mdAccept.includes('导出候选 2 / 2'), 'accept: span totals')
  assert(mdAccept.includes('总计 2 · 已决策 2 · 待定 0'), 'accept: diff totals')
  assert(mdAccept.includes('接受 2 · 拒绝 0 · 改色 0 · 改范围 0 · 备注 0 · 新增 0'), 'accept: counts line')
  assert(mdAccept.includes('认可率（accepted/decided）1'), 'accept: accept_rate 1')
  assert(mdAccept.includes('（无改色/删除/新增样例）'), 'accept: no samples placeholder')

  // ── mixed diff: rejected + recolored + added samples ──────────────────────
  const docMixed = makeDoc()
  docMixed.spans = [
    span('s-001', 'a-0001-03-01', 'green', 'accepted', [
      { action: 'proposed', by: 'agent' },
      { action: 'recolored', by: 'user', from: 'yellow', to: 'green' },
      { action: 'accepted', by: 'user' },
    ], '改色示例'),
    span('s-002', 'a-0001-05-01', 'red', 'rejected', [
      { action: 'proposed', by: 'agent' },
      { action: 'rejected', by: 'user' },
    ], '删除示例'),
    span('s-003', 'a-0001-05-01', 'blue', 'user_added', [{ action: 'added', by: 'user' }], '新增示例'),
    span('s-004', 'a-0001-03-01', 'purple', 'proposed', [{ action: 'proposed', by: 'agent' }], '待定示例'),
  ]
  const diffMixed = summarizeDiff(docMixed.spans)
  const mdMixed = paperReflectionTemplate({ highlights: docMixed, diff: diffMixed, now: NOW })
  assert(mdMixed.includes('总计 4 · 已决策 3 · 待定 1'), 'mixed: diff totals')
  assert(mdMixed.includes('接受 0 · 拒绝 1 · 改色 1 · 改范围 0 · 备注 0 · 新增 1'), 'mixed: counts line (s-001 recolored, not accepted)')
  assert(mdMixed.includes('- 改色 s-001：yellow → green'), 'mixed: recolored sample line')
  assert(mdMixed.includes('- 删除 s-002：删除示例'), 'mixed: rejected sample line')
  assert(mdMixed.includes('- 新增 s-003：新增示例'), 'mixed: added sample line')
  assert(mdMixed.includes('导出候选 2 / 4'), 'mixed: accepted+user_added export candidates')
  assert(!/[^\\]undefined/.test(mdMixed), 'mixed: lossless')

  // ── profileSummary rendered ───────────────────────────────────────────────
  const profileSummary = {
    has_profile: true,
    colors: { red: { color: '#ff0000', label: '红' }, yellow: { color: '#fff000', label: '黄' } },
    rules: [{ id: 'rule-1', rule: 'granularity: sentence', enabled: true }],
    exemplars: [{ span_id: 's-001' }],
    stats_summary: '2 篇论文 · 累计认可率 80% · 累计修改率 20%',
  }
  const mdProf = paperReflectionTemplate({ highlights: docAccept, diff: diffAccept, profileSummary, now: NOW })
  assert(mdProf.includes('画像现状：L1 颜色 2 · L2 规则 1（enabled）· L3 示例 1 · L4 统计 2 篇论文 · 累计认可率 80% · 累计修改率 20%'),
    'profileSummary: 沉淀偏好 line renders colors/rules/exemplars/stats')

  // ── sections provided -> per-section table with span counts ───────────────
  const sections = buildSections({ paperMd: ['# Title', '', '## Abstract', '', 'Abstract body text.', '', '## Method', '', 'Method body text.', '', '## References', ''].join('\n'), anchors: makeDoc().anchors })
  const rows = sectionTable(docMixed, sections)
  assert(rows.length >= 2 && rows[0].startsWith('| s2 |') && rows[0].includes('reviewed'), 'sectionTable: paper_title skipped, Abstract row present')
  const s2Row = rows.find((r) => r.startsWith('| s2 |'))
  const s3Row = rows.find((r) => r.startsWith('| s3 |'))
  assert(s2Row && s2Row.endsWith('| 2 |'), 'sectionTable: Abstract span count = 2 (s-001, s-004)')
  assert(s3Row && s3Row.endsWith('| 2 |'), 'sectionTable: Method span count = 2 (s-002, s-003)')
  const mdSec = paperReflectionTemplate({ highlights: docMixed, diff: diffMixed, sections, now: NOW })
  assert(mdSec.includes('| s2 | Abstract | reviewed | 2 |'), 'template: sections table row for Abstract')
  assert(mdSec.includes('| s3 | Method | pending | 2 |'), 'template: sections table row for Method')

  // ── fmtCount / paperReflectionFile helpers ────────────────────────────────
  const fc = fmtCount({ accepted: 3 })
  assert(fc.accepted === 3 && fc.rejected === 0 && fc.pending === 0 && fc.added === 0, 'fmtCount: fills zero defaults')
  assert(paperReflectionFile('D:/root', 'p-x').endsWith(pathSepJoin('p-x', 'paper-reflection.md')), 'paperReflectionFile: path under paper dir')

  console.log(JSON.stringify({
    step: 'reflect-paper',
    result: 'PASS',
    paperReflectionTemplate: 'empty/cold-start + full-acceptance + mixed (rejected+recolored+added samples) + profileSummary line + sections per-section table + lossless + deterministic now',
    helpers: 'fmtCount zero-fill / paperReflectionFile path',
  }, null, 2))
}

function pathSepJoin(a, b) {
  const path = require('node:path')
  return path.join(a, b)
}

main()
