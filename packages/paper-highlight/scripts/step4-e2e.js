'use strict'

/**
 * paper-highlight · Step 4 end-to-end acceptance driver (v0.1)
 *
 * Drives the LIVE paper profile (http://127.0.0.1:3081) through the exact
 * v0.1 acceptance flow without a browser:
 *
 *   1. session.create (no agentPreset) → asserts the profile default is `paper`
 *   2. session.prompt → the agent runs the real pipeline with its own tools:
 *      parse_pdf (real MinerU) → read_highlights (skeleton) →
 *      write_highlights (5 spans) → read_highlights (roundtrip check)
 *   3. polls session.list until the turn goes idle
 *   4. prints the turn summary from session.history
 *   5. hits GET /paper-hl/read and reports the GUI data path state
 *
 * Run while the paper profile server is up:
 *   node scripts/step4-e2e.js
 *
 * Exit 0 when: default preset = paper, the agent parsed the PDF, wrote at
 * least one span, and /paper-hl/read serves them.
 */

const http = require('http')
const crypto = require('crypto')

const API = 'http://127.0.0.1:3081'
const PDF_PATH = 'D:\\aa\\Mikolov 等 - 2013 - 2013.1 Word2Vec.pdf'
const POLL_MS = 5000
const TURN_TIMEOUT_MS = 25 * 60 * 1000

function rpc(method, payload) {
  const rpcId = `step4-${crypto.randomUUID()}`
  const body = JSON.stringify({ type: 'client-request', rpcId, method, payload })
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${API}/api/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TASK = `请完成论文高亮管线的端到端演示（项目 v0.1 验收），严格按以下步骤执行，不要做与任务无关的事：

1. 调用 parse_pdf 解析 PDF：${PDF_PATH}
   （不传 paper_id 让它从文件名推导；不传 root 用默认值；这是真实 MinerU 云 API 解析）
2. 调用 read_highlights 读取刚生成的 paper.highlights.json，确认它是空骨架（spans 为空数组）。
3. 基于步骤 2 读到的完整文档，调用 write_highlights 写入 5 条高质量 spans（从论文 Abstract / Introduction / Conclusion 中挑选真正有语义价值的句子，避免关键词堆砌），要求：
   - color 只用 red|yellow|blue|green|purple，语义：red=核心洞见/贡献，yellow=关键定义/方法，blue=局限/风险，green=可借鉴/启发，purple=待深挖/存疑；5 条 spans 至少使用 3 种不同颜色
   - 每条 span 必须有：rationale（一句中文理由）、status="proposed"、decisions=[{action:"proposed", by:"agent", at:<ISO8601 时间>}]
   - char_start / char_end 必须落在所选 anchor 的 text 范围内（0 起始、半开区间 [start,end)）
   - write_highlights 需要传完整文档：从步骤 2 read_highlights 的输出开始修改，保留 paper / anchors / plan / duplicates 等字段原样，只追加 spans
4. 调用 read_highlights 回读，确认返回的 spans 与步骤 3 写入的完全一致（数量、id、anchor、颜色、rationale）。
5. 输出最终总结：paper_id、data_dir、锚点数、spans 数量与各颜色分布、4 个产物文件路径。用简洁的中文报告，不要贴大段 JSON。`

async function main() {
  // ── 1. create a fresh session with the DEFAULT preset ─────────────────────
  console.log('== step 1: session.create (default agent preset) ==')
  const created = await rpc('session.create', { cwd: process.cwd() })
  const sessionId = created.sessionId
  console.log('sessionId:', sessionId, '| agentPreset:', created.agentPreset ?? '(none)')
  if (created.agentPreset !== 'paper') {
    console.warn('WARN: expected default preset "paper", got', JSON.stringify(created.agentPreset))
  } else {
    console.log('ok: profile default preset is "paper"')
  }

  // ── 2. prompt the agent ───────────────────────────────────────────────────
  console.log('\n== step 2: session.prompt (agent runs the real pipeline) ==')
  const prompted = await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: TASK }],
  })
  console.log('prompt accepted:', prompted.accepted)
  const startedAt = Date.now()

  // ── 3. poll until idle ────────────────────────────────────────────────────
  console.log(`\n== step 3: waiting for the turn to finish (timeout ${TURN_TIMEOUT_MS / 60000} min) ==`)
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
      console.log(`  ...still running (${elapsedMin} min elapsed)`)
      lastLog = Date.now()
    }
    await sleep(POLL_MS)
  }
  if (running) throw new Error('turn did not finish within the timeout; check the GUI for approvals')
  console.log(`turn finished after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

  // ── 4. summarize the history ──────────────────────────────────────────────
  console.log('\n== step 4: turn summary (session.history tail) ==')
  const history = await rpc('session.history', { sessionId, maxMessages: 400 })
  const events = history.events.map((e) => e.event)
  let assistantText = ''
  const toolCalls = []
  for (const ev of events) {
    const d = ev.data ?? {}
    if (ev.type === 'message' && d.role === 'assistant') {
      const blocks = Array.isArray(d.blocks) ? d.blocks : []
      const text = blocks
        .filter((b) => b && b.type === 'text')
        .map((b) => (typeof b.text === 'string' ? b.text : ''))
        .join('')
      if (text) assistantText = text // keep the last assistant text block
    }
    if (ev.type === 'assistant/message') {
      const content = Array.isArray(d.message?.content) ? d.message.content : []
      const text = content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('')
      if (text) assistantText = text // keep the last assistant text block
    }
    if (ev.type === 'tool/call' || ev.type === 'tool_call') {
      toolCalls.push(typeof d.name === 'string' ? d.name : JSON.stringify(d).slice(0, 120))
    }
  }
  const counts = {}
  for (const t of toolCalls) counts[t] = (counts[t] || 0) + 1
  console.log('tool calls:', JSON.stringify(counts))
  console.log('--- last assistant text ---')
  console.log(assistantText || '(none)')

  // ── 5. GUI data path ──────────────────────────────────────────────────────
  console.log('\n== step 5: GET /paper-hl/read (GUI data path) ==')
  const data = await getJson(`${API}/paper-hl/read`)
  if (data.status !== 200 || data.body.ok !== true) {
    throw new Error(`/paper-hl/read failed: ${data.status} ${JSON.stringify(data.body).slice(0, 300)}`)
  }
  const b = data.body
  console.log('paperId:', b.paperId, '| papers:', JSON.stringify(b.papers))
  console.log('paperMd chars:', b.paperMd.length, '| anchors:', Object.keys(b.anchors).length, '| spans:', b.highlights.spans.length)
  const colors = {}
  for (const s of b.highlights.spans) colors[s.color] = (colors[s.color] || 0) + 1
  console.log('span colors:', JSON.stringify(colors))
  const statuses = {}
  for (const s of b.highlights.spans) statuses[s.status] = (statuses[s.status] || 0) + 1
  console.log('span statuses:', JSON.stringify(statuses))

  // ── verdict ───────────────────────────────────────────────────────────────
  const ok = created.agentPreset === 'paper' && counts.parse_pdf > 0 && counts.write_highlights > 0 && counts.read_highlights >= 2 && b.highlights.spans.length >= 3
  console.log('\nVERDICT:', ok ? 'PASS — v0.1 acceptance flow complete (agent parse → write → read-back → GUI data path)' : 'INCOMPLETE — review the output above')
  process.exit(ok ? 0 : 2)
}

main().catch((e) => {
  console.error('E2E FAILED:', e.message)
  process.exit(1)
})
