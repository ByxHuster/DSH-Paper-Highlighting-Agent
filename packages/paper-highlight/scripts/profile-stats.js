'use strict'

/**
 * paper-highlight · v0.3 Phase 4 convergence statistics (design §8 v0.3 验收)
 *
 * Aggregates per-paper approval/modify metrics (D4 accounting:
 *   decided  = non-pending review outcomes
 *   approved = accepted + recolored-kept + rescoped-kept
 *   approve_rate = approved / decided; modify_rate = 1 - approve_rate)
 * from two sources, in priority order:
 *   1. highlight-profile/stats.json papers[] (written by applyProposal on
 *      confirmation — the authoritative per-paper record)
 *   2. data/<paper_id>/reflections.json sections[].counts (fallback for papers
 *      reviewed but not yet confirmed)
 *
 * Prints a per-paper table + the v0.3 convergence verdict:
 *   paper 3 (last processed) approve_rate >= 70% AND modify_rate <= 50% of the
 *   baseline (first processed) paper's modify_rate. Thresholds adjustable.
 *
 * Usage:
 *   node scripts/profile-stats.js [--json] [--threshold 0.70] [--relative 0.50]
 *                                 [--baseline <paper_id>] [--final <paper_id>]
 * Baseline defaults to the first row (stats.json processing order, then any
 * reflections-only paper), final to the last row — pass --baseline/--final
 * explicitly when the processing order differs from the row order (e.g. an
 * unconfirmed baseline paper listed after confirmed ones).
 * Exit 0 = table printed (verdict inside), 1 = driver error.
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..', '..') // D:\aa
const PROFILE_DIR = path.join(ROOT, 'highlight-profile')
const DATA_DIR = path.join(ROOT, 'data')

/** Per-paper metrics from a reflections.json document (D4). */
function metricsFromReflections(ref) {
  const sections = Array.isArray(ref && ref.sections) ? ref.sections : []
  let accepted = 0
  let rejected = 0
  let recolored = 0
  let rescoped = 0
  let added = 0
  let pending = 0
  let sectionsReviewed = 0
  for (const s of sections) {
    const c = (s && s.counts) || {}
    accepted += c.accepted || 0
    rejected += c.rejected || 0
    recolored += c.recolored || 0
    rescoped += c.rescoped || 0
    added += c.user_added || 0
    pending += c.pending || 0
    if (s && s.status === 'reviewed') sectionsReviewed++
  }
  const decided = accepted + rejected + recolored + rescoped + added
  const approved = accepted + recolored + rescoped
  return {
    sections_reviewed: sectionsReviewed,
    decided,
    approved,
    approve_rate: decided > 0 ? Number((approved / decided).toFixed(3)) : 0,
    modify_rate: decided > 0 ? Number((1 - approved / decided).toFixed(3)) : 0,
    change_kinds: { accepted, rejected, recolored, rescoped, user_added: added, pending },
  }
}

/** Load a paper's stats entry: stats.json papers[] first, reflections fallback. */
function loadPaperStats(paperId, statsPapers) {
  const fromStats = statsPapers.find((p) => p.paper_id === paperId)
  if (fromStats) return fromStats
  const reflPath = path.join(DATA_DIR, paperId, 'reflections.json')
  if (fs.existsSync(reflPath)) {
    const ref = JSON.parse(fs.readFileSync(reflPath, 'utf8'))
    return Object.assign({ paper_id: paperId }, metricsFromReflections(ref))
  }
  return null
}

function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const threshold = parseFloat((args.find((a) => a.startsWith('--threshold=')) || '').split('=')[1] || '0.70')
  const relative = parseFloat((args.find((a) => a.startsWith('--relative=')) || '').split('=')[1] || '0.50')
  const baselineId = (args.find((a) => a.startsWith('--baseline=')) || '').split('=')[1] || null
  const finalId = (args.find((a) => a.startsWith('--final=')) || '').split('=')[1] || null

  const profileDir = PROFILE_DIR
  const papers = []
  let statsPapers = []
  if (fs.existsSync(path.join(profileDir, 'stats.json'))) {
    statsPapers = JSON.parse(fs.readFileSync(path.join(profileDir, 'stats.json'), 'utf8')).papers || []
  }

  // order: papers known in stats.json first (processing order), then any paper
  // with a reflections.json (e.g. the v0.2 baseline not yet confirmed)
  const orderedIds = []
  for (const p of statsPapers) if (!orderedIds.includes(p.paper_id)) orderedIds.push(p.paper_id)
  let dirs = []
  try {
    dirs = fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  } catch { /* no data dir */ }
  for (const id of dirs) if (!orderedIds.includes(id)) orderedIds.push(id)

  for (const paperId of orderedIds) {
    const entry = loadPaperStats(paperId, statsPapers)
    if (entry && entry.decided > 0) papers.push(entry)
  }

  if (papers.length === 0) {
    console.log('no reviewed-paper metrics found (stats.json papers[] or reflections.json)')
    process.exit(0)
  }

  // convergence verdict: explicit baseline/final win over row order
  const baseline = (baselineId && papers.find((p) => p.paper_id === baselineId)) || papers[0]
  const last = (finalId && papers.find((p) => p.paper_id === finalId)) || papers[papers.length - 1]
  const rateOk = last.approve_rate >= threshold
  const relModify = baseline.modify_rate > 0 ? last.modify_rate / baseline.modify_rate : 0
  const modifyOk = relModify <= relative
  const verdict = {
    baseline_paper: baseline.paper_id,
    final_paper: last.paper_id,
    baseline_modify_rate: baseline.modify_rate,
    final_approve_rate: last.approve_rate,
    final_modify_rate: last.modify_rate,
    relative_modify: Number(relModify.toFixed(3)),
    threshold_approve: threshold,
    threshold_relative_modify: relative,
    PASS: papers.length >= 2 && rateOk && modifyOk,
    note: 'simulated-user convergence (step7 模拟用户逐篇收敛) + real profile accumulation; 真人审查曲线待后续真实使用验证',
  }

  if (asJson) {
    console.log(JSON.stringify({ papers, verdict }, null, 2))
    process.exit(0)
  }

  console.log('== paper-highlight · v0.3 Phase 4 逐篇收敛指标（D4 口径）==')
  console.log('')
  console.log('paper_id'.padEnd(34) + ' 节数   decided  approved  认可率   修改率   修改类型(acc/rej/rec/res/add/pend)')
  console.log('-'.repeat(110))
  for (const p of papers) {
    const ck = p.change_kinds || {}
    const kinds = [ck.accepted || 0, ck.rejected || 0, ck.recolored || 0, ck.rescoped || 0, ck.user_added || 0, ck.pending || 0].join('/')
    console.log(
      String(p.paper_id).padEnd(34) +
      String(p.sections_reviewed || 0).padStart(4) +
      String(p.decided).padStart(9) +
      String(p.approved).padStart(9) +
      String((p.approve_rate * 100).toFixed(0) + '%').padStart(7) +
      String((p.modify_rate * 100).toFixed(0) + '%').padStart(8) +
      '   ' + kinds,
    )
  }
  console.log('')
  if (papers.length >= 2) {
    console.log(`== 收敛判定 ==`)
    console.log(`基线（第 1 篇）${baseline.paper_id}: 修改率 ${(baseline.modify_rate * 100).toFixed(0)}%`)
    console.log(`末篇（第 ${papers.length} 篇）${last.paper_id}: 认可率 ${(last.approve_rate * 100).toFixed(0)}% · 修改率 ${(last.modify_rate * 100).toFixed(0)}%`)
    console.log(`末篇修改率 / 基线修改率 = ${relModify.toFixed(2)}（要求 ≤ ${relative}）`)
    console.log(`末篇认可率 ≥ ${threshold * 100}%：${rateOk ? '✅' : '❌'} · 相对下降达标：${modifyOk ? '✅' : '❌'}`)
    console.log(`判定：${verdict.PASS ? '✅ PASS — 收敛指标达标' : '❌ 未达标（记录差距，可调阈值或补充画像后复测）'}`)
    console.log(`口径说明：${verdict.note}`)
  } else {
    console.log('论文数 < 2，无法判定收敛（至少需基线 + 1 篇对比）')
  }
  process.exit(0)
}

main()
