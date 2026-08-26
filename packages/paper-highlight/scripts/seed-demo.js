'use strict'

/**
 * paper-highlight · seed demo highlight spans (Step 3 acceptance data)
 *
 * Writes a small set of semantically meaningful spans into the real paper's
 * paper.highlights.json via host/store.js — the exact code path the agent's
 * write_highlights tool uses. Idempotent: replaces the spans array with this
 * seed set each run (existing user edits would be overwritten; run only for
 * the demo paper while it is still a skeleton).
 *
 * Run: node scripts/seed-demo.js [paperId]
 */

const path = require('node:path')

const { readAnchors, writeHighlights, readHighlights } = require('../host/store')

const ROOT = path.join(__dirname, '..', '..', '..') // D:\aa
const PAPER_ID = process.argv[2] || 'p-mikolov-2013-2013-1-word2vec'

// (needle, color, rationale, status) — needles must appear verbatim in one anchor's text.
// Note: MinerU keeps line-break hyphens ("repre- sentations"), so needles avoid
// hyphenation points wherever possible.
const SEED = [
  ['We propose two novel model architectures for computing continuous vector',
    'red', '核心贡献：首次提出 CBOW 与 Skip-gram 两种新架构', 'proposed'],
  ['We observe large improvements in accuracy at much lower computational cost',
    'red', '核心结果：大幅提升精度且计算成本更低', 'proposed'],
  ['these vectors provide state-of-the-art',
    'red', '核心结果：句法/语义相似度测试上达到 SOTA', 'proposed'],
  ['The main goal of this paper is to introduce techniques that can be used for learning high-quality word vectors',
    'yellow', '关键目标：引入高质量词向量学习技术', 'proposed'],
  ['Representation of words as continuous vectors',
    'yellow', '关键概念：连续向量词表示（分布式表示的核心思想）', 'proposed'],
  ['Many current NLP systems and techniques treat words as atomic units',
    'blue', '局限/动机：现有系统把词当作原子单元，缺乏相似性', 'proposed'],
  ['can be answered by performing simple algebraic operations',
    'green', '可借鉴：king−man+woman 向量代数运算的经典结果', 'proposed'],
  ['can be used to answer very subtle semantic relationships',
    'green', '可借鉴：向量保留细粒度语义关系（后续广泛沿用）', 'proposed'],
  ['We also expect that high quality word vectors will become an important building block for future NLP applications',
    'purple', '待深挖：高质量词向量成未来 NLP 基石（预训练范式雏形）', 'proposed'],
]

async function main() {
  const anchors = await readAnchors(ROOT, PAPER_ID)
  const highlights = await readHighlights(ROOT, PAPER_ID)
  const spans = []
  const seen = new Set()
  for (const [needle, color, rationale, status] of SEED) {
    const hit = Object.entries(anchors).find(([, a]) => a.text.includes(needle))
    if (!hit) {
      console.log('  skip (no anchor contains):', JSON.stringify(needle.slice(0, 60)))
      continue
    }
    const [anchorId, a] = hit
    const charStart = a.text.indexOf(needle)
    const span = {
      id: 's-demo-' + String(spans.length + 1).padStart(3, '0'),
      anchor: anchorId,
      char_start: charStart,
      char_end: charStart + needle.length,
      color,
      rationale,
      status,
      decisions: [{ action: 'proposed', by: 'agent', at: new Date().toISOString() }],
    }
    spans.push(span)
    seen.add(anchorId)
  }
  const doc = { ...highlights, spans }
  await writeHighlights(ROOT, PAPER_ID, doc)
  console.log(JSON.stringify({
    step: 'seed-demo',
    paperId: PAPER_ID,
    spans_written: spans.length,
    anchors_covered: seen.size,
    colors: Object.fromEntries(['red', 'yellow', 'blue', 'green', 'purple'].map((c) => [c, spans.filter((s) => s.color === c).length])),
  }, null, 2))
}

main().catch((err) => { console.error('SEED FAILED:', err.message); process.exit(1) })
