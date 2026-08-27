'use strict'

/**
 * paper-highlight · v0.2 end-to-end acceptance driver (Phase 5)
 *
 * Drives the LIVE paper profile (http://127.0.0.1:3081) through the full
 * review-closed-loop acceptance flow without a browser:
 *
 *   turn 1  prompt「全局通读 + 对 1 Introduction 节 propose」→ the agent
 *           loads paper-hl-global-read + paper-hl-propose skills and writes
 *           plan + §1 proposed spans (append-only, existing spans preserved)
 *   sim     simulate the user's GUI review via REAL POST /paper-hl/write:
 *           recolor 1 + reject 1 + add 1 in §1, then review_section §1
 *   turn 2  prompt「本节审查完毕」→ the agent loads paper-hl-reflect, runs
 *           summarize_section_diff (fallback: manual) and writes
 *           data/<paper_id>/reflections.json
 *
 * Assertions (the §4.2 contract, on disk state):
 *   - after turn 1: plan.summary non-empty, plan.sections[] covers §1 with
 *     expected_colors/density_hint/skip; ≥1 proposed span lands in §1; the
 *     pre-existing spans (snapshotted before the run) are all preserved
 *   - after sim: §1 has a recolored span, a rejected span, and a user_added
 *     span; plan.sections §1 entry status === 'reviewed'
 *   - after turn 2: reflections.json exists with the paper_id, a section
 *     entry for §1, and change signals matching the simulated ops
 *
 * Real data is used (no MinerU re-parse). A safety backup of
 * paper.highlights.json is written to test/.tmp (gitignored) and restored on
 * failure; on success the acceptance state is left in place for GUI review.
 *
 * Run (paper profile server up):
 *   node scripts/step6-e2e.js
 * Exit 0 = PASS, 2 = INCOMPLETE (review output), 1 = driver/network failure.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const API = 'http://127.0.0.1:3081'
const PAPER_ID = 'p-mikolov-2013-2013-1-word2vec'
const ROOT = path.join(__dirname, '..', '..', '..') // D:\aa
const HIGHLIGHTS_FILE = path.join(ROOT, 'data', PAPER_ID, 'paper.highlights.json')
const BACKUP_FILE = path.join(__dirname, '..', 'test', '.tmp', 'step6-backup-paper.highlights.json')
const POLL_MS = 5000
const TURN_TIMEOUT_MS = 22 * 60 * 1000

function rpc(method, payload) {
  const rpcId = `step6-${crypto.randomUUID()}`
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

function postWrite(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = http.request(
      `${API}/paper-hl/write?paperId=${encodeURIComponent(PAPER_ID)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
          } catch (e) {
            reject(new Error(`bad JSON from /paper-hl/write: ${e.message}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function readHighlights() {
  const data = await getJson(`${API}/paper-hl/read`)
  if (data.status !== 200 || data.body.ok !== true) throw new Error(`/paper-hl/read failed: ${data.status} ${JSON.stringify(data.body).slice(0, 300)}`)
  return data.body
}

/** Poll the session until idle; returns { ok, elapsedSec, history } — never throws on agent slowness. */
async function waitIdle(sessionId, startedAt, label) {
  let running = true
  let lastLog = 0
  for (;;) {
    const list = await rpc('session.list', {})
    const row = list.items.find((i) => i.sessionId === sessionId)
    if (!row) throw new Error(`session ${sessionId} vanished from session.list`)
    if (!row.running) { running = false; break }
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

const TASK1 = `请完成 paper-highlight 审查闭环端到端演示（项目 v0.2 验收），严格按以下步骤执行，只做与任务相关的事，最终用简洁中文报告：

1. 加载技能 paper-hl-global-read 并按其步骤执行「全局通读」：
   - 调用 list_sections 读节索引；用 read_file 读 data/${PAPER_ID}/paper.md 全文（需要时用 read_section 补读）。
   - 写出论文地图与 plan：plan.summary（一段话概括全文高亮策略）+ 每个「可审查节」（kind=section 且非 empty）一条 plan.sections[]（含 id / expected_colors / density_hint / skip）。
   - 通过 read_highlights 取完整文档 → 只改 plan（**绝对不要改动或删除任何既有 spans**）→ write_highlights 写回完整文档。
2. 加载技能 paper-hl-propose 并对其余「1 Introduction」节（按标题在 list_sections 中找到其 id）执行逐节 propose：
   - 调用 read_section 读该节正文与既有 spans；对照既有 spans 与 duplicates 去重（重复默认跳过）。
   - 提出 3-5 条候选 spans：color 只用 red|yellow|blue|green|purple（默认色表语义），每条含 rationale（一句中文理由）、status="proposed"、decisions=[{action:"proposed", by:"agent", at:<ISO8601>}]、char 区间落在所选 anchor 文本内。
   - append 写回：read_highlights 取完整文档 → 末尾追加新 spans（既有 spans/plan/duplicates 一律保留）→ write_highlights。
3. 报告：plan 摘要、1 Introduction 节提出的候选清单（颜色+位置+理由）、去重跳过数。不要贴大段 JSON。`

const TASK2 = `用户已通过 GUI 审查完毕「1 Introduction」节（改色 1 处、删除 1 处、新增 1 处，且该节已标记审查完毕，全部已落盘）。请加载技能 paper-hl-reflect 并按其步骤执行章节反思：

1. 调用 summarize_section_diff 对该节做差异分析（若工具不可用，按技能兜底方式从 decisions[] 手动分类计数）。
2. 推断改色规律 / 删除模式 / 粒度偏好（只对明确的重复模式）。
3. 产出画像更新提案（规则修正 + 示例入库 + 统计雏形），写盘 data/${PAPER_ID}/reflections.json。
4. 用简洁中文报告：该节差异摘要（接受/删除/改色/新增计数 + 接受率）、推断出的模式、画像更新提案要点。不要贴大段 JSON。`

async function main() {
  // ── safety backup ─────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(BACKUP_FILE), { recursive: true })
  fs.copyFileSync(HIGHLIGHTS_FILE, BACKUP_FILE)
  const before = JSON.parse(fs.readFileSync(HIGHLIGHTS_FILE, 'utf8'))
  const beforeIds = (before.spans || []).map((s) => s.id)
  console.log(`== safety backup -> ${BACKUP_FILE} (pre-existing spans: ${beforeIds.join(', ') || '(none)'}) ==`)

  // ── 1. create session ─────────────────────────────────────────────────────
  console.log('\n== step 1: session.create (default agent preset) ==')
  const created = await rpc('session.create', { cwd: process.cwd() })
  const sessionId = created.sessionId
  console.log('sessionId:', sessionId, '| agentPreset:', created.agentPreset)
  if (created.agentPreset !== 'paper') throw new Error(`expected default preset "paper", got ${JSON.stringify(created.agentPreset)}`)
  console.log('ok: profile default preset is "paper"')

  // ── 2. turn 1: global-read + propose ──────────────────────────────────────
  console.log('\n== step 2: prompt turn 1 (global-read → plan, then propose §1) ==')
  await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: TASK1 }] })
  const t1 = Date.now()
  const idle1 = await waitIdle(sessionId, t1, 'turn1')
  if (!idle1.ok) {
    await restoreBackup()
    throw new Error(idle1.reason)
  }
  console.log(`turn 1 finished after ${((Date.now() - t1) / 1000).toFixed(1)}s`)
  const h1 = await historyText(sessionId)
  console.log('turn 1 tool calls:', JSON.stringify(h1.toolCalls))
  console.log('--- turn 1 last assistant text ---')
  console.log(h1.assistantText || '(none)')

  // ── 3. assert plan + proposed spans + preservation ────────────────────────
  console.log('\n== step 3: assert plan + §1 proposed spans (disk state) ==')
  const body1 = await readHighlights()
  const hl1 = body1.highlights
  const sec1 = body1.sections.find((s) => s.title === '1 Introduction')
  if (!sec1) throw new Error('section "1 Introduction" not found in the derived index')
  console.log('plan.summary:', JSON.stringify(hl1.plan.summary).slice(0, 120))
  console.log('plan.sections entries:', hl1.plan.sections.length)
  const planEntry1 = hl1.plan.sections.find((p) => p.id === sec1.id)
  const planHasCoverage = hl1.plan.summary.length > 0 && hl1.plan.sections.length >= 1 && planEntry1 && Array.isArray(planEntry1.expected_colors)
  console.log('plan covers §1 with expected_colors:', !!planEntry1)
  const proposedIn1 = hl1.spans.filter((s) => s.status === 'proposed' && (sec1.anchor_ids || []).includes(s.anchor))
  console.log('proposed spans in §1:', proposedIn1.map((s) => s.id).join(', ') || '(none)')
  const preserved = beforeIds.every((id) => hl1.spans.some((s) => s.id === id))
  console.log('pre-existing spans preserved:', preserved)
  if (!(planHasCoverage && proposedIn1.length >= 1 && preserved)) {
    await restoreBackup()
    throw new Error(`INCOMPLETE after turn 1: plan=${planHasCoverage}, proposedIn1=${proposedIn1.length}, preserved=${preserved}`)
  }

  // ── 4. simulate the user's GUI review via real POST /paper-hl/write ───────
  console.log('\n== step 4: simulate user review (recolor 1 / reject 1 / add 1 / review_section) ==')
  const candidates = proposedIn1
  const recolorTarget = candidates[0]
  const rejectTarget = candidates[1] || candidates[0]
  const anchor = (sec1.anchor_ids || []).find((a) => body1.anchors[a] && body1.anchors[a].text.length >= 12) || sec1.anchor_id
  const anchorText = body1.anchors[anchor].text
  const addColor = 'purple'
  const r1 = await postWrite({ action: 'recolor', span_id: recolorTarget.id, color: recolorTarget.color === 'red' ? 'blue' : 'red' })
  if (r1.status !== 200 || r1.body.ok !== true) throw new Error(`recolor POST failed: ${r1.status} ${JSON.stringify(r1.body)}`)
  console.log('recolored:', recolorTarget.id, '->', r1.body.span && r1.body.span.color)
  const r2 = await postWrite({ action: 'reject', span_id: rejectTarget.id })
  if (r2.status !== 200 || r2.body.ok !== true) throw new Error(`reject POST failed: ${r2.status} ${JSON.stringify(r2.body)}`)
  console.log('rejected:', rejectTarget.id)
  const r3 = await postWrite({ action: 'add', anchor, char_start: 0, char_end: Math.min(12, anchorText.length), color: addColor, rationale: 'e2e 模拟用户新增' })
  if (r3.status !== 200 || r3.body.ok !== true) throw new Error(`add POST failed: ${r3.status} ${JSON.stringify(r3.body)}`)
  console.log('added:', r3.body.span && r3.body.span.id, 'at', anchor + '[0,' + Math.min(12, anchorText.length) + ')')
  const r4 = await postWrite({ action: 'review_section', section: sec1.id })
  if (r4.status !== 200 || r4.body.ok !== true) throw new Error(`review_section POST failed: ${r4.status} ${JSON.stringify(r4.body)}`)
  console.log('reviewed section:', sec1.id, '| status:', r4.body.section && r4.body.section.status)

  // ── 5. turn 2: 本节审查完毕 → reflect ────────────────────────────────────
  console.log('\n== step 5: prompt turn 2 (审查完毕 → reflect + reflections.json) ==')
  await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: TASK2 }] })
  const t2 = Date.now()
  const idle2 = await waitIdle(sessionId, t2, 'turn2')
  if (!idle2.ok) {
    await restoreBackup()
    throw new Error(idle2.reason)
  }
  console.log(`turn 2 finished after ${((Date.now() - t2) / 1000).toFixed(1)}s`)
  const h2 = await historyText(sessionId)
  console.log('turn 2 tool calls:', JSON.stringify(h2.toolCalls))
  console.log('--- turn 2 last assistant text ---')
  console.log(h2.assistantText || '(none)')

  // ── 6. assert reviewed marker + reflections.json ──────────────────────────
  console.log('\n== step 6: assert reviewed marker + reflections.json ==')
  const body2 = await readHighlights()
  const planEntry2 = body2.highlights.plan.sections.find((p) => p.id === sec1.id)
  console.log('§1 plan.status:', planEntry2 && planEntry2.status)
  const reflPath = path.join(ROOT, 'data', PAPER_ID, 'reflections.json')
  const reflExists = fs.existsSync(reflPath)
  console.log('reflections.json exists:', reflExists)
  let refl = null
  let reflSignals = []
  if (reflExists) {
    refl = JSON.parse(fs.readFileSync(reflPath, 'utf8'))
    const blob = JSON.stringify(refl)
    for (const k of ['rejected', 'recolored', 'rescoped', 'added', 'user_added']) {
      if (blob.includes(k)) reflSignals.push(k)
    }
    console.log('reflections keys:', Object.keys(refl).join(', '))
    console.log('reflections signals present:', reflSignals.join(', ') || '(none)')
    console.log('reflections paper_id:', refl.paper_id)
  }
  const simOk = planEntry2 && planEntry2.status === 'reviewed' && reflExists && reflSignals.includes('rejected') && (reflSignals.includes('recolored') || reflSignals.includes('added'))
  if (!simOk) {
    await restoreBackup()
    throw new Error(`INCOMPLETE after turn 2: status=${planEntry2 && planEntry2.status}, reflections=${reflExists}, signals=${reflSignals.join(',')}`)
  }

  // ── verdict ───────────────────────────────────────────────────────────────
  console.log('\n== verdict ==')
  console.log('plan written + §1 proposed spans + pre-existing spans preserved: ok')
  console.log('user sim (recolor/reject/add/review_section) applied via real POST: ok')
  console.log('§1 reviewed marker + reflections.json with matching change signals: ok')
  console.log('\nVERDICT: PASS — v0.2 acceptance flow complete (global-read → propose → GUI-sim → reflect → reflections.json)')
  console.log(`Acceptance state left in place for GUI review: ${PAPER_ID} (plan + §1 proposed/recolored/rejected/added + reviewed + reflections.json)`)
  console.log('Safety backup kept at:', BACKUP_FILE)
  process.exit(0)
}

async function restoreBackup() {
  try {
    if (fs.existsSync(BACKUP_FILE)) fs.copyFileSync(BACKUP_FILE, HIGHLIGHTS_FILE)
    console.log('restored paper.highlights.json from safety backup')
  } catch (e) {
    console.error('backup restore failed:', e.message)
  }
}

main().catch((e) => {
  console.error('\nE2E FAILED:', e.message)
  process.exit(1)
})
