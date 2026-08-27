'use strict'

/**
 * paper-highlight · Step 8 export end-to-end acceptance (v0.4 Phase 5)
 *
 * Runs the FULL v0.4 delivery chain over a real reviewed paper
 * (p-bahdanau-2016-attention) with no human intervention, using the same host
 * tools the agent would call (exportPaperTool / reflectPaperTool — pure host
 * logic over data/, no live 3081 needed):
 *
 *   1. read the real highlights + anchors → derive expected export counts via
 *      the canonical buildExportSpans
 *   2. export_paper html (file) → assert the artifact: exists, <mark> count =
 *      exported spans, legend items = L1 colors keys, self-contained (no
 *      http(s)/<script>), title header
 *   3. export_paper md (file)  → assert artifact readable + <mark> count
 *   4. export_paper html include_pending → assert count grows when proposed
 *      spans exist (and stays equal otherwise)
 *   5. reflect_paper (file) → assert data/<paper_id>/paper-reflection.md exists
 *      and carries the 7 structured sections
 *
 * Backup/restore: the export/ dir and paper-reflection.md are backed up before
 * the run and restored on any failure (they are regenerated artifacts, but the
 * script must never leave the data tree in a half-written state).
 *
 * Run:  node scripts/step8-export-e2e.js
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const ROOT = process.env.PAPER_HL_ROOT || 'D:/aa'
const PAPER = 'p-bahdanau-2016-attention'

const { exportPaperTool, reflectPaperTool } = require('../host/tools')
const { readHighlights, readAnchors, readMeta } = require('../host/store')
const { readProfile, profileExists } = require('../host/profile')
const { buildExportSpans, resolveColors, exportFileName } = require('../host/export')
const { paperReflectionFile } = require('../host/reflection')

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ok:', msg)
}

async function main() {
  console.log(`step8-export-e2e · root=${ROOT} · paper=${PAPER}`)

  const dir = path.join(ROOT, 'data', PAPER)
  const exportDir = path.join(dir, 'export')
  const reflFile = paperReflectionFile(ROOT, PAPER)
  const backupRoot = path.join(path.dirname(__dirname), 'test', '.tmp', 'step8-backup')
  await fsp.rm(backupRoot, { recursive: true, force: true })
  await fsp.mkdir(backupRoot, { recursive: true })

  // ── backup regenerated artifacts ──────────────────────────────────────────
  async function backup() {
    await fsp.rm(backupRoot, { recursive: true, force: true })
    await fsp.mkdir(backupRoot, { recursive: true })
    // only the regenerated export/ dir needs backup (paper-reflection.md is
    // validated in place, never rewritten by this e2e)
    for (const src of [exportDir]) {
      if (!fs.existsSync(src)) continue
      const rel = path.relative(dir, src)
      const dest = path.join(backupRoot, rel)
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.cp(src, dest, { recursive: true })
    }
  }
  async function restore() {
    for (const src of [exportDir]) {
      if (fs.existsSync(src)) await fsp.rm(src, { recursive: true, force: true })
      const rel = path.relative(dir, src)
      const dest = path.join(backupRoot, rel)
      if (fs.existsSync(dest)) await fsp.cp(dest, src, { recursive: true })
    }
  }

  await backup()
  try {
    // ── 1. expected counts from the canonical export path ───────────────────
    const highlights = await readHighlights(ROOT, PAPER)
    const anchors = await readAnchors(ROOT, PAPER)
    const meta = await readMeta(ROOT, PAPER).catch(() => null)
    const full = Object.assign({}, highlights, { anchors })
    const expectedDefault = buildExportSpans(full).length
    const expectedPending = buildExportSpans(full, { include_pending: true }).length
    const has = await profileExists(ROOT)
    const colors = has ? (await readProfile(ROOT)).colors : null
    const paletteKeys = Object.keys(resolveColors(colors))
    const title = (highlights.paper && highlights.paper.title) || (meta && meta.title) || PAPER
    assert(expectedDefault > 0, `derived expected exported spans = ${expectedDefault} (pending-incl ${expectedPending})`)
    assert(paletteKeys.length > 0, `L1 colors = ${paletteKeys.length} keys`)

    // ── 2. export_paper html (file) ─────────────────────────────────────────
    const html = await exportPaperTool().execute({ paper_id: PAPER, format: 'html', output: 'file', root: ROOT })
    assert(html.ok === true && html.output === 'file' && /\.html$/.test(html.file), 'export_paper html → file path')
    assert(html.stats.exported_marks === expectedDefault, `html tool stats.exported_marks = ${html.stats.exported_marks} (=${expectedDefault})`)
    const htmlText = await fsp.readFile(html.file, 'utf8')
    assert(htmlText.startsWith('<!DOCTYPE html>'), 'html artifact starts with <!DOCTYPE html>')
    assert(htmlText.includes('<title>' + escapeRegExp(title) + '</title>') || htmlText.includes(title), 'html artifact carries the paper title')
    const markCount = (htmlText.match(/<mark/g) || []).length
    assert(markCount === expectedDefault, `html <mark> count = ${markCount} (=${expectedDefault})`)
    const legendCount = (htmlText.match(/class="phl-legend-item"/g) || []).length
    assert(legendCount === paletteKeys.length, `html legend items = ${legendCount} (=${paletteKeys.length})`)
    assert(!/https?:\/\//.test(htmlText) && !/<script/i.test(htmlText), 'html is self-contained (no external http(s) / <script>)')
    const colorClsOk = paletteKeys.every((k) => new RegExp(`hl-${k}`).test(htmlText))
    assert(colorClsOk, 'html carries a .hl-<color> class per L1 color')

    // ── 3. export_paper md (file) ───────────────────────────────────────────
    const md = await exportPaperTool().execute({ paper_id: PAPER, format: 'md', output: 'file', root: ROOT })
    assert(md.ok === true && md.output === 'file' && /\.md$/.test(md.file), 'export_paper md → file path')
    assert(md.file !== html.file && md.file === path.join(exportDir, exportFileName(PAPER, 'md')), 'md artifact path is the canonical export file')
    const mdText = await fsp.readFile(md.file, 'utf8')
    assert(mdText.startsWith('# '), 'md artifact starts with an H1 title')
    assert(mdText.includes('## 图例'), 'md artifact carries the 图例 legend section')
    const mdMarkCount = (mdText.match(/<mark/g) || []).length
    assert(mdMarkCount === expectedDefault, `md <mark> count = ${mdMarkCount} (=${expectedDefault})`)
    assert(mdText.includes('hl-' + paletteKeys[0]), 'md carries at least one hl-<color> class')

    // ── 4. include_pending ──────────────────────────────────────────────────
    const pendingHtml = await exportPaperTool().execute({ paper_id: PAPER, format: 'html', include_pending: true, output: 'inline', root: ROOT })
    assert(pendingHtml.ok === true && typeof pendingHtml.content === 'string', 'export_paper include_pending → inline content')
    const pendingMarks = (pendingHtml.content.match(/<mark/g) || []).length
    assert(pendingMarks === expectedPending, `include_pending <mark> = ${pendingMarks} (=${expectedPending})`)
    assert(expectedPending >= expectedDefault, 'include_pending count >= default count')

    // ── 5. reflect_paper (inline) + paper-level reflection artifact ─────────
    // reflect_paper inline proves the tool renders a valid scaffold without
    // touching the committed artifact; the artifact file is validated as-is so
    // re-running the e2e never clobbers the (Agent-filled) sample.
    const rp = await reflectPaperTool().execute({ paper_id: PAPER, output: 'inline', root: ROOT })
    assert(rp.ok === true && typeof rp.content === 'string' && rp.content.startsWith('# 论文级反思 — '), 'reflect_paper inline → valid scaffold (tool works)')
    for (const sec of ['1. 论文概述', '2. 审查进度', '3. 整篇差异汇总', '4. 沉淀偏好', '5. 领域地图增补点', '6. 未来工作方向', '7. 导出状态']) {
      assert(rp.content.includes(sec), `reflect_paper inline carries section "${sec}"`)
    }
    assert(fs.existsSync(reflFile), 'paper-reflection.md artifact exists on disk')
    const refl = await fsp.readFile(reflFile, 'utf8')
    assert(refl.startsWith('# 论文级反思 — '), 'paper-reflection.md starts with the 论文级反思 H1')
    for (const sec of ['1. 论文概述', '2. 审查进度', '3. 整篇差异汇总', '4. 沉淀偏好', '5. 领域地图增补点', '6. 未来工作方向', '7. 导出状态']) {
      assert(refl.includes(sec), `paper-reflection.md carries section "${sec}"`)
    }
    assert(refl.includes('认可率（accepted/decided）'), 'paper-reflection.md carries the whole-paper accept rate')

    console.log(`\nSTEP8 PASS — v0.4 交付链端到端（无人工介入）：html+md 导出产物校验通过（${expectedDefault} 处高亮 / ${paletteKeys.length} 色图例 / 自包含）、include_pending 语义正确、reflect_paper 脚手架 + 论文级反思产物结构完整（7 节）`)
  } catch (err) {
    await restore()
    console.error('STEP8 FAILED (backup restored):', err.message)
    process.exit(1)
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

main().catch((err) => {
  console.error('STEP8 FAILED:', err && err.message ? err.message : err)
  process.exit(1)
})
