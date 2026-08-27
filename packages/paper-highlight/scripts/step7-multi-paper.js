'use strict'

/**
 * paper-highlight · v0.3 Phase 4 multi-paper convergence driver (design §8)
 *
 * Drives the LIVE paper profile (http://127.0.0.1:3081) through the full
 * propose → review → reflect → confirm loop on the 2nd/3rd same-domain papers
 * (Sutskever 2014 Seq2Seq, Bahdanau 2016 Attention), while the 1st paper
 * (p-mikolov-2013-2013-1-word2vec) serves as the pre-profile baseline from its
 * existing v0.2 review record (no re-run).
 *
 * Per paper:
 *   turn A   global-read (with read_profile 画像摘要) → plan
 *   turn B.. propose on the representative sections (Abstract/Introduction/
 *            core-method), one section per turn (paper-hl-propose is per-section)
 *   sim      simulated user review via REAL POST /paper-hl/write — action
 *            intensity converges per paper (medium → low) to model habit
 *            learning: medium = accept all + recolor 1 + reject 1 per section,
 *            low = accept all + at most a light tweak; then review_section
 *   turn N   reflect (summarize_section_diff → reflections.json)
 *   confirm  REAL POST /paper-hl/profile/apply {decisions:{accept:'all'}} —
 *            the profile accumulates rules/exemplars/stats (NOT restored; that
 *            is the point of the convergence run)
 *
 * Metrics are derived from reflections.json sections[].counts (D4) and the
 * final summary reuses scripts/profile-stats.js to print the per-paper curve
 * and the v0.3 verdict (final approve_rate ≥ 70% and modify_rate ≤ 50% of the
 * baseline). The simulated-user convergence note is recorded in the verdict.
 *
 * Safety: per-paper backup of paper.highlights.json / reflections.json /
 * highlight-profile to test/.tmp (gitignored), restored only on failure.
 *
 * Run (paper profile server up; the two new papers already parsed):
 *   node scripts/step7-multi-paper.js
 * Exit 0 = PASS (loop + metrics), 2 = METRICS FAIL (loop ran, verdict not met),
 * 1 = driver failure.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const API = 'http://127.0.0.1:3081'
const ROOT = path.join(__dirname, '..', '..', '..') // D:\aa
const TMP = path.join(__dirname, '..', 'test', '.tmp', 'step7')
const POLL_MS = 5000
const TURN_TIMEOUT_MS = 22 * 60 * 1000

const BASELINE_PAPER = 'p-mikolov-2013-2013-1-word2vec'

const PAPERS = [
  {
    label: '第 2 篇',
    paper_id: 'p-sutskever-2014-seq2seq',
    title: 'Sequence to Sequence Learning with Neural Networks',
    sim: 'medium', // accept all + recolor 1 + reject 1 per section (habit still adjusting)
    sections: [
      { id: 's2', title: 'Abstract' },
      { id: 's3', title: '1 Introduction' },
      { id: 's4', title: '2 The model' },
    ],
  },
  {
    label: '第 3 篇',
    paper_id: 'p-bahdanau-2016-attention',
    title: 'Neural Machine Translation by Jointly Learning to Align and Translate',
    sim: 'low', // accept all, light tweak only (profile captured the habits)
    sections: [
      { id: 's2', title: 'ABSTRACT' },
      { id: 's3', title: '1 INTRODUCTION' },
      { id: 's6', title: '3 LEARNING TO ALIGN AND TRANSLATE' },
    ],
  },
]

// ── RPC + HTTP helpers (same contract as step6-e2e.js) ─────────────────────

function rpc(method, payload) {
  const rpcId = `step7-${crypto.randomUUID()}`
  const body = JSON.stringify({ type: 'client-request', rpcId, method, payload })
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${API}/api/${method}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch (e) {
            reject(new Error(`bad JSON from ${method}: ${e.message}`))
            return
          }
          if (parsed.type !== 'server-response') {
            reject(new Error(`unexpected envelope from ${method}: ${JSON.stringify(parsed).slice(0, 300)}`))
            return
          }
          if (parsed.result?.ok !== true) {
            reject(new Error(`${method} failed: ${JSON.stringify(parsed.result?.error ?? parsed.result).slice(0, 500)}`))
            return
          }
          resolve(parsed.result.value)
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch (e) {
          reject(new Error(`bad JSON from ${url}: ${e.message}`))
        }
      })
    }).on('error', reject)
  })
}

function postJson(url, payload) {
  const body = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
          } catch (e) {
            reject(new Error(`bad JSON from ${url}: ${e.message}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function readPaper(paperId) {
  const data = await getJson(`${API}/paper-hl/read?paperId=${encodeURIComponent(paperId)}`)
  if (data.status !== 200 || data.body.ok !== true) throw new Error(`/paper-hl/read failed: ${data.status} ${JSON.stringify(data.body).slice(0, 300)}`)
  return data.body
}

async function waitIdle(sessionId, startedAt, label) {
  let running = true
  let lastLog = 0
  for (;;) {
    const list = await rpc('session.list', {})
    const row = list.items.find((i) => i.sessionId === sessionId)
    if (!row) throw new Error(`session ${sessionId} vanished from session.list`)
    if (!row.running) {
      running = false
      break
    }
    if (Date.now() - startedAt > TURN_TIMEOUT_MS) break
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1)
    if (Date.now() - lastLog > 30000) {
      console.log(`  [${label}] ...still running (${elapsedMin} min)`)
      lastLog = Date.now()
    }
    await sleep(POLL_MS)
  }
  if (running) return { ok: false, reason: `turn ${label} did not finish within ${TURN_TIMEOUT_MS / 60000} min` }
  return { ok: true }
}

async function historyText(sessionId) {
  const history = await rpc('session.history', { sessionId, maxMessages: 600 })
  const events = history.events.map((e) => e.event)
  let assistantText = ''
  const toolCalls = []
  for (const ev of events) {
    const d = ev.data ?? {}
    if (ev.type === 'message' && d.role === 'assistant') {
      const blocks = Array.isArray(d.blocks) ? d.blocks : []
      const text = blocks.filter((b) => b && b.type === 'text').map((b) => (typeof b.text === 'string' ? b.text : '')).join('')
      if (text) assistantText = text
    }
    if (ev.type === 'assistant/message') {
      const content = Array.isArray(d.message?.content) ? d.message.content : []
      const text = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
      if (text) assistantText = text
    }
    if (ev.type === 'tool/call' || ev.type === 'tool_call') {
      toolCalls.push(typeof d.name === 'string' ? d.name : JSON.stringify(d).slice(0, 120))
    }
  }
  const counts = {}
  for (const t of toolCalls) counts[t] = (counts[t] || 0) + 1
  return { toolCalls: counts, assistantText }
}

async function promptTurn(sessionId, text, label) {
  console.log(`\n== prompt: ${label} ==`)
  await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text }] })
  const t0 = Date.now()
  const idle = await waitIdle(sessionId, t0, label)
  if (!idle.ok) throw new Error(idle.reason)
  console.log(`${label} finished after ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const h = await historyText(sessionId)
  console.log('tool calls:', JSON.stringify(h.toolCalls))
  console.log('--- last assistant text ---')
  console.log((h.assistantText || '(none)').slice(0, 600))
  return h
}

// ── prompts (parameterized per paper / section) ─────────────────────────────

function globalReadTask(paper) {
  return `请对论文 ${paper.paper_id}（《${paper.title}》）执行「全局通读」并写出逐节高亮计划（v0.3 Phase 4 收敛验收，第 ${paper.label}）：

1. 加载技能 paper-hl-global-read 并按其步骤执行：先调用 read_profile 取画像摘要（L1 颜色语义、L2 规则与 density/granularity 基线、L3 示例、L4 统计）——plan 的 expected_colors 与 density_hint 必须参考画像摘要；再 list_sections 读节索引、read_file 读 data/${paper.paper_id}/paper.md 全文（必要时 read_section 补读）、read_highlights 读现有 plan/spans/duplicates。
2. 写出 plan.summary + 每个可审查节一条 plan.sections[]（id/expected_colors/density_hint/skip）→ read_highlights 取完整文档 → 只改 plan（**绝对不要改动或删除任何既有 spans**）→ write_highlights 写回。
3. 用简洁中文报告：画像摘要要点（生效的颜色/密度/粒度规则）、plan 摘要、重点节与 skip 节。不要贴大段 JSON。`
}

function proposeTask(paper, sec) {
  return `请对论文 ${paper.paper_id} 的「${sec.title}」节（id=${sec.id}）执行逐节 propose（v0.3 Phase 4 收敛验收，第 ${paper.label}，本论文第 ${sec.title} 节）：

1. 加载技能 paper-hl-propose 并按步骤执行：**先调用 read_profile 取画像摘要**（L1 颜色语义 + L2 规则含 density/granularity 基线 + L3 示例 top-k + L4 统计）——候选的 color/密度/粒度必须参考画像；再 read_section(paper_id=${paper.paper_id}, section=${sec.id}) 读该节正文与既有 spans；对照既有 spans 与 duplicates 去重（重复默认跳过，R1–R4）。
2. 提出 2-4 条候选 spans：color 只用画像 L1 颜色语义的键（默认 red|yellow|blue|green|purple）；每条含 rationale（一句中文理由）、status="proposed"、decisions=[{action:"proposed", by:"agent", at:<ISO8601>}]、char 区间落在所选 anchor 文本内；粒度按画像 granularity 规则。
3. append 写回：read_highlights 取完整文档 → 末尾追加新 spans（既有 spans/plan/duplicates 一律保留）→ write_highlights。
4. 用简洁中文报告：提出的候选清单（颜色+位置摘要+理由）、画像摘要中生效的规则、去重跳过数。不要贴大段 JSON。`
}

function reflectTask(paper) {
  return `用户已通过 GUI 审查完毕论文 ${paper.paper_id} 的代表节（Abstract / Introduction / 核心方法节，含模拟用户的接受/改色/删除操作，各节均已标记审查完毕并落盘）。请加载技能 paper-hl-reflect 并按其步骤执行章节反思（v0.3 Phase 4 收敛验收，第 ${paper.label}）：

1. 调用 summarize_section_diff 对已审查节做差异分析（若工具不可用按技能兜底）。
2. 推断改色规律 / 删除模式 / 粒度偏好（只对明确的重复模式），并对照画像摘要（可先 read_profile）说明哪些既有规则被印证/修正。
3. 产出画像更新提案（规则修正 + 示例入库 + 统计雏形），写盘 data/${paper.paper_id}/reflections.json。
4. 用简洁中文报告：差异摘要（各节计数 + 认可率）、推断模式、提案要点。不要贴大段 JSON。`
}

// ── simulated user review (real POST /paper-hl/write) ───────────────────────

async function simulateReview(paper, body) {
  const paperId = paper.paper_id
  const secIds = paper.sections.map((s) => s.id)
  const anchorIdsOf = (secId) => {
    const sec = body.sections.find((s) => s.id === secId)
    return sec ? sec.anchor_ids : []
  }
  const post = (payload) => postJson(`${API}/paper-hl/write?paperId=${encodeURIComponent(paperId)}`, payload)
  let stats = { accepted: 0, rejected: 0, recolored: 0, added: 0 }
  for (const secId of secIds) {
    const anchors = anchorIdsOf(secId)
    const proposed = body.highlights.spans.filter((s) => s.status === 'proposed' && anchors.includes(s.anchor))
    if (proposed.length === 0) {
      console.log(`  sim ${paperId} ${secId}: no proposed spans, marking reviewed`)
    } else {
      const ordered = proposed.slice().sort((a, b) => a.id.localeCompare(b.id))
      if (paper.sim === 'low') {
        // profile has captured the habits: accept everything, light tweak only
        for (const s of ordered) {
          const r = await post({ action: 'accept', span_id: s.id })
          if (r.status !== 200 || r.body.ok !== true) throw new Error(`accept ${s.id} failed: ${r.status} ${JSON.stringify(r.body)}`)
          stats.accepted++
        }
      } else {
        // medium: still adjusting — accept all, recolor 1, reject 1
        for (const s of ordered) {
          const r = await post({ action: 'accept', span_id: s.id })
          if (r.status !== 200 || r.body.ok !== true) throw new Error(`accept ${s.id} failed: ${r.status} ${JSON.stringify(r.body)}`)
          stats.accepted++
        }
        const recolorTarget = ordered[0]
        const rejectTarget = ordered[ordered.length - 1]
        if (recolorTarget) {
          const to = recolorTarget.color === 'red' ? 'blue' : 'red'
          const r = await post({ action: 'recolor', span_id: recolorTarget.id, color: to })
          if (r.status !== 200 || r.body.ok !== true) throw new Error(`recolor ${recolorTarget.id} failed: ${r.status} ${JSON.stringify(r.body)}`)
          stats.recolored++
        }
        if (rejectTarget && ordered.length > 1) {
          const r = await post({ action: 'reject', span_id: rejectTarget.id })
          if (r.status !== 200 || r.body.ok !== true) throw new Error(`reject ${rejectTarget.id} failed: ${r.status} ${JSON.stringify(r.body)}`)
          stats.rejected++
        }
      }
    }
    const rv = await post({ action: 'review_section', section: secId })
    if (rv.status !== 200 || rv.body.ok !== true) throw new Error(`review_section ${secId} failed: ${rv.status} ${JSON.stringify(rv.body)}`)
  }
  console.log(`sim review done:`, JSON.stringify(stats))
  return stats
}

// ── metrics from reflections.json (D4) ──────────────────────────────────────

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
    paper_id: ref && ref.paper_id,
    sections_reviewed: sectionsReviewed,
    decided,
    approved,
    approve_rate: decided > 0 ? Number((approved / decided).toFixed(3)) : 0,
    modify_rate: decided > 0 ? Number((1 - approved / decided).toFixed(3)) : 0,
    change_kinds: { accepted, rejected, recolored, rescoped, user_added: added, pending },
  }
}

// ── per-paper backups (restore only on failure) ─────────────────────────────

function backupPaper(paperId) {
  fs.mkdirSync(TMP, { recursive: true })
  const dir = path.join(TMP, paperId)
  fs.mkdirSync(dir, { recursive: true })
  for (const name of ['paper.highlights.json', 'reflections.json']) {
    const src = path.join(ROOT, 'data', paperId, name)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name))
  }
  return dir
}

function restorePaper(backupDir) {
  for (const name of ['paper.highlights.json', 'reflections.json']) {
    const src = path.join(backupDir, name)
    const dst = path.join(ROOT, 'data', path.basename(backupDir), name)
    if (fs.existsSync(src)) fs.copyFileSync(src, dst)
  }
}

function backupProfile() {
  const dst = path.join(TMP, 'highlight-profile')
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true })
  fs.cpSync(path.join(ROOT, 'highlight-profile'), dst, { recursive: true })
  return dst
}

function restoreProfile(dst) {
  if (fs.existsSync(dst)) fs.rmSync(path.join(ROOT, 'highlight-profile'), { recursive: true, force: true })
  fs.cpSync(dst, path.join(ROOT, 'highlight-profile'), { recursive: true })
}

// ── main ────────────────────────────────────────────────────────────────────

async function runPaper(paper) {
  console.log(`\n${'='.repeat(70)}\n== ${paper.label}: ${paper.paper_id} (${paper.title}) — sim=${paper.sim} ==\n${'='.repeat(70)}`)
  const backupDir = backupPaper(paper.paper_id)
  const profileBackup = backupProfile()

  // 1. create session
  const created = await rpc('session.create', { cwd: process.cwd() })
  const sessionId = created.sessionId
  console.log('sessionId:', sessionId, '| agentPreset:', created.agentPreset)
  if (created.agentPreset !== 'paper') throw new Error(`expected default preset "paper", got ${JSON.stringify(created.agentPreset)}`)

  // 2. global-read
  await promptTurn(sessionId, globalReadTask(paper), `${paper.label} global-read`)

  // 3. propose per representative section
  for (const sec of paper.sections) {
    await promptTurn(sessionId, proposeTask(paper, sec), `${paper.label} propose ${sec.id} ${sec.title}`)
  }

  // 4. simulated user review (real POST /write)
  console.log(`\n== ${paper.label}: simulated user review ==`)
  const body = await readPaper(paper.paper_id)
  await simulateReview(paper, body)

  // 5. reflect
  await promptTurn(sessionId, reflectTask(paper), `${paper.label} reflect`)

  // 6. confirm the proposal for real (profile accumulates — NOT restored)
  const reflPath = path.join(ROOT, 'data', paper.paper_id, 'reflections.json')
  if (!fs.existsSync(reflPath)) throw new Error(`reflections.json missing for ${paper.paper_id}`)
  console.log(`\n== ${paper.label}: confirm proposal (real /profile/apply) ==`)
  const apply = await postJson(`${API}/paper-hl/profile/apply?paperId=${encodeURIComponent(paper.paper_id)}`, { decisions: { accept: 'all' } })
  if (apply.status !== 200 || apply.body.ok !== true) throw new Error(`apply failed: ${apply.status} ${JSON.stringify(apply.body)}`)
  console.log('applied:', JSON.stringify(apply.body.applied))

  // 7. metrics
  const ref = JSON.parse(fs.readFileSync(reflPath, 'utf8'))
  const metrics = metricsFromReflections(ref)
  console.log('metrics:', JSON.stringify(metrics))
  console.log(`profile after ${paper.label}:`, JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'highlight-profile', 'rules.json'), 'utf8')).map((r) => `${r.id}:${r.enabled ? 'on' : 'off'}`)))
  console.log(`[${paper.label}] PASS — loop completed (backups kept at ${backupDir})`)
  return metrics
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true })
  const metrics = []
  try {
    for (const paper of PAPERS) {
      const m = await runPaper(paper)
      metrics.push(m)
    }
  } catch (err) {
    console.error('\nSTEP7 DRIVER FAILED:', err.message)
    console.error('Restoring per-paper backups + profile (safety net)…')
    for (const paper of PAPERS) {
      const backupDir = path.join(TMP, paper.paper_id)
      if (fs.existsSync(backupDir)) restorePaper(backupDir)
    }
    const profileBackup = path.join(TMP, 'highlight-profile')
    if (fs.existsSync(profileBackup)) restoreProfile(profileBackup)
    process.exit(1)
  }

  // summary: reuse profile-stats.js to print the curve + verdict. The baseline
  // (p-mikolov v0.2 pre-profile record) is NOT in stats.json (unconfirmed), so
  // pass it explicitly to keep the processing order correct.
  console.log('\n' + '='.repeat(70))
  console.log('== 三篇收敛汇总（基线 p-mikolov v0.2 审查记录 + step7 第 2/3 篇）==')
  const statsScript = path.join(__dirname, 'profile-stats.js')
  const { execFileSync } = require('node:child_process')
  try {
    execFileSync(process.execPath, [statsScript, `--baseline=${BASELINE_PAPER}`, `--final=${PAPERS[PAPERS.length - 1].paper_id}`], { stdio: 'inherit' })
  } catch (err) {
    if (err.status === 1) throw new Error('profile-stats failed')
    process.exit(err.status === 2 ? 2 : err.status || 1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('\nSTEP7 FAILED:', e.message)
  process.exit(1)
})
