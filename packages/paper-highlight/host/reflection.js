'use strict'

/**
 * paper-highlight · paper-level reflection template (v0.4 Phase 3, D5)
 *
 * The reflect skill produces per-section reflections (data/<paper_id>/
 * reflections.json + profile_proposal). At wrap-up (all reviewable sections
 * reviewed, or the user says "论文完毕") it runs the whole-paper diff
 * (summarize_section_diff with no section) and calls paperReflectionTemplate to
 * scaffold data/<paper_id>/paper-reflection.md — a structured markdown the agent
 * fills with natural language (paper overview, inferred signals, field-map
 * augmentation, future work). Design §5.5: no self-spinning; the value is
 * turning the review into a reusable summary. Pure + lossless (no undefined).
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const { paperDir, atomicWriteText } = require('./store')

/** Normalized diff counts (all keys present, 0 default). */
function fmtCount(c) {
  return {
    accepted: (c && c.accepted) || 0,
    rejected: (c && c.rejected) || 0,
    recolored: (c && c.recolored) || 0,
    rescoped: (c && c.rescoped) || 0,
    noted: (c && c.noted) || 0,
    added: (c && c.added) || 0,
    pending: (c && c.pending) || 0,
  }
}

/** Up to 3 sample lines per change kind (recolored/rejected/added/rescoped). */
function sampleLines(samples) {
  const lines = []
  for (const kind of ['recolored', 'rejected', 'added', 'rescoped']) {
    const list = (samples && samples[kind]) || []
    for (const s of list.slice(0, 3)) {
      if (kind === 'recolored') {
        const r = s.recolor || {}
        lines.push(`- 改色 ${s.span_id}：${r.from || '?'} → ${r.to || '?'}（rationale: ${s.rationale || '-'}）`)
      } else if (kind === 'rescoped') {
        const to = (s.rescope && s.rescope.to) || {}
        lines.push(`- 改范围 ${s.span_id}：→ [${to.char_start}, ${to.char_end})（rationale: ${s.rationale || '-'}）`)
      } else if (kind === 'rejected') {
        lines.push(`- 删除 ${s.span_id}：${s.rationale || '(无 rationale)'}`)
      } else {
        lines.push(`- 新增 ${s.span_id}：${s.rationale || '(无 rationale)'}`)
      }
    }
  }
  return lines
}

/**
 * Per-section review table rows. When `sections` (buildSections output) is
 * provided, counts spans per section via anchor_ids; otherwise falls back to a
 * plan-only table (span count '-'). Skips the paper_title row.
 */
function sectionTable(highlights, sections) {
  const plan = highlights && highlights.plan && Array.isArray(highlights.plan.sections) ? highlights.plan.sections : []
  const spans = highlights && Array.isArray(highlights.spans) ? highlights.spans : []
  if (sections && Array.isArray(sections) && sections.length) {
    const rows = []
    for (const sec of sections) {
      if (sec.kind === 'paper_title') continue
      const spanCount = spans.filter((s) => (sec.anchor_ids || []).includes(s.anchor)).length
      const planEntry = plan.find((p) => p.id === sec.id)
      rows.push(`| ${sec.id} | ${sec.title} | ${(planEntry && planEntry.status) || 'pending'} | ${spanCount} |`)
    }
    return rows
  }
  return plan.map((p) => `| ${p.id} | ${p.section || ''} | ${p.status || 'pending'} | - |`)
}

/**
 * Build the structured paper-reflection markdown scaffold (D5).
 * @param {object} opts { paper?, highlights, diff?, profileSummary?, sections?, now? }
 * @returns {string} markdown
 */
function paperReflectionTemplate(opts = {}) {
  const highlights = opts.highlights || {}
  const paper = opts.paper || highlights.paper || {}
  const diff = opts.diff || { total: 0, pending: 0, decided: 0, counts: {}, accept_rate: 0, samples: {} }
  const counts = fmtCount(diff.counts)
  const summary = opts.profileSummary || null
  const now = opts.now || new Date().toISOString()
  const title = paper.title || ''
  const id = paper.id || ''
  const planSections = highlights.plan && Array.isArray(highlights.plan.sections) ? highlights.plan.sections : []
  const planSummary = (highlights.plan && highlights.plan.summary) || ''
  const reviewedCount = planSections.filter((p) => p.status === 'reviewed').length
  const totalSections = planSections.length
  const totalSpans = (highlights.spans || []).length
  const acceptedUserAdded = (highlights.spans || []).filter((s) => s.status === 'accepted' || s.status === 'user_added').length

  const lines = [
    `# 论文级反思 — ${title || id}`,
    '',
    `> paper_id: ${id} · 生成时间 ${now} · 来源：paper-hl-reflect（论文级）`,
    '',
    '## 1. 论文概述',
    '',
    planSummary || '（待填：一句话概括本文贡献与高亮策略）',
    '',
    '> Agent 补充：本文在领域主线中的定位与高亮策略要点。',
    '',
    '## 2. 审查进度（plan）',
    '',
    `已审查 ${reviewedCount} / ${totalSections} 节 · 总 spans ${totalSpans} · 导出候选（accepted+user_added）${acceptedUserAdded}`,
    '',
    '| 节 | 标题 | 状态 | 高亮数 |',
    '|---|---|---|---|',
  ]
  for (const row of sectionTable(highlights, opts.sections)) lines.push(row)
  lines.push(
    '',
    '## 3. 整篇差异汇总（summarize_section_diff，无 section）',
    '',
    `- 总计 ${diff.total} · 已决策 ${diff.decided} · 待定 ${diff.pending}`,
    `- 接受 ${counts.accepted} · 拒绝 ${counts.rejected} · 改色 ${counts.recolored} · 改范围 ${counts.rescoped} · 备注 ${counts.noted} · 新增 ${counts.added}`,
    `- 认可率（accepted/decided）${diff.accept_rate}`,
    '',
    '样例：',
  )
  const samples = sampleLines(diff.samples)
  if (samples.length) lines.push(...samples)
  else lines.push('（无改色/删除/新增样例）')
  lines.push(
    '',
    '## 4. 沉淀偏好',
    '',
    summary
      ? `- 画像现状：L1 颜色 ${Object.keys(summary.colors || {}).length} · L2 规则 ${(summary.rules || []).length}（enabled）· L3 示例 ${(summary.exemplars || []).length} · L4 统计 ${summary.stats_summary || '-'}`
      : '- 画像现状：无画像（冷启动）',
    '- 推断信号（Agent 填写，走 profile_proposal 需用户确认；Agent 不直接写 rules.json）：',
    '  - …',
    '',
    '## 5. 领域地图增补点',
    '',
    '（Agent 填写：对照 field-map 主线，本论文的定位增量 / 提议增补条目；field-map 不存在则提议初建）',
    '  - …',
    '',
    '## 6. 未来工作方向',
    '',
    '（Agent 填写：purple 类主张 / 值得继续深挖或存疑方向）',
    '  - …',
    '',
    '## 7. 导出状态',
    '',
    `- 导出候选 ${acceptedUserAdded} / ${totalSpans} spans（export_paper 默认口径）`,
    `- 可用：export_paper（html|md）→ data/${id}/export/${id}.html|md`,
    '',
  )
  return lines.join('\n')
}

/** data/<paper_id>/paper-reflection.md (D5). */
function paperReflectionFile(root, paperId) {
  return path.join(paperDir(root, paperId), 'paper-reflection.md')
}

/** Atomically write the paper-reflection markdown. */
async function writePaperReflection(root, paperId, content) {
  const file = paperReflectionFile(root, paperId)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteText(file, content)
  return file
}

module.exports = { paperReflectionTemplate, sectionTable, fmtCount, sampleLines, paperReflectionFile, writePaperReflection }
