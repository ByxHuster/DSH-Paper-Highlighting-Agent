'use strict'

/**
 * Offline verification of the agent tool definitions (host/tools.js):
 *   - defineTool conversion (parameters → JSON schema, output render)
 *   - read_highlights / write_highlights execute against a real store
 *   - schema rejection of an invalid span
 *
 * Run:  node test/run-tools.js   (deps are installed locally in the package)
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const { defineTool } = require('@deepseek-ai/dsh-tools')

const { buildMockZip } = require('./fixtures/make-mock-zip')
const { normalizeMineruZip } = require('../host/normalize')
const { writePaper } = require('../host/store')
const { parsePdfTool, readHighlightsTool, writeHighlightsTool } = require('../host/tools')
const { assert } = require('./verify')

/**
 * Walk a value and assert it is "lossless JSON": no undefined / NaN /
 * Infinity / BigInt anywhere, and a JSON round-trip reproduces the value.
 * Mirrors the dsh-tools output boundary (ToolOutputError INVALID_TOOL_OUTPUT)
 * that rejected parse_pdf's `task_id: undefined` in the Step 4 live run.
 */
function assertLosslessJson(value, label) {
  const seen = new Set()
  function check(node, path) {
    if (node === null) return
    const t = typeof node
    if (t === 'undefined') throw new Error(`${label}: undefined at ${path}`)
    if (t === 'number' && !Number.isFinite(node)) throw new Error(`${label}: non-finite number at ${path} (${node})`)
    if (t === 'bigint') throw new Error(`${label}: bigint at ${path}`)
    if (t === 'function' || t === 'symbol') throw new Error(`${label}: ${t} at ${path}`)
    if (t !== 'object') return
    if (seen.has(node)) throw new Error(`${label}: circular reference at ${path}`)
    seen.add(node)
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) check(node[i], `${path}[${i}]`)
    } else {
      for (const k of Object.keys(node)) check(node[k], `${path}.${k}`)
    }
    seen.delete(node)
  }
  check(value, '$')
  const round = JSON.parse(JSON.stringify(value))
  assert(JSON.stringify(round) === JSON.stringify(value), `${label}: JSON round-trip must be stable`)
}

async function main() {
  const root = path.join(__dirname, '.tmp', 'tools-root')
  await fsp.rm(root, { recursive: true, force: true })

  const zipPath = path.join(__dirname, 'fixtures', 'mock-mineru.zip')
  await buildMockZip(zipPath)
  const paperId = 'p-mock'
  const { paperMd, anchors, meta } = await normalizeMineruZip({
    zipPath, paperId, title: 'Mock Paper', sourcePdf: 'mock.pdf', mineruTask: 'task-mock',
  })
  await writePaper(root, paperId, { paperMd, anchors, meta })

  // 1) defineTool conversion
  const defs = [parsePdfTool(), readHighlightsTool(), writeHighlightsTool()].map(defineTool)
  for (const d of defs) {
    assert(typeof d.name === 'string' && d.name.length > 0, `tool name missing: ${JSON.stringify(d)}`)
    assert(d.parameters && d.parameters.type === 'object', `tool ${d.name}: parameters must convert to object JSON schema`)
    assert(d.output && typeof d.output.render === 'function', `tool ${d.name}: output.render must be a function`)
  }
  const names = defs.map((d) => d.name)
  assert(names.includes('parse_pdf') && names.includes('read_highlights') && names.includes('write_highlights'), 'tool names')

  // 2) read_highlights on a fresh skeleton
  const readTool = readHighlightsTool()
  const initial = await readTool.execute({ paper_id: paperId, root })
  assert(initial.ok === true && initial.spans === 0, 'initial highlights should have 0 spans')

  // 3) write_highlights with one valid span, then read back
  const firstId = Object.keys(anchors)[0]
  const doc = { ...initial.highlights }
  doc.spans = [{
    id: 's-001', anchor: firstId, char_start: 0, char_end: 12, color: 'red',
    rationale: 'tool test span', status: 'proposed',
    decisions: [{ action: 'proposed', by: 'agent', at: new Date().toISOString() }],
  }]
  const writeTool = writeHighlightsTool()
  const written = await writeTool.execute({ paper_id: paperId, highlights: doc, root })
  assert(written.ok === true && written.spans === 1, 'write should report 1 span')

  const after = await readTool.execute({ paper_id: paperId, root })
  assert(after.spans === 1, 'read back should report 1 span')
  assert(after.highlights.spans[0].id === 's-001' && after.highlights.spans[0].anchor === firstId, 'span content round-trip')

  // 4) invalid span must be rejected
  const badDoc = { ...doc }
  badDoc.spans = [{ ...doc.spans[0], char_start: 5, char_end: 9999 }]
  let threw = false
  try {
    await writeTool.execute({ paper_id: paperId, highlights: badDoc, root })
  } catch (err) {
    threw = true
    assert(/out of bounds/.test(err.message), `invalid span error message: ${err.message}`)
  }
  assert(threw, 'invalid span should throw')

  // 5) parse_pdf output must be lossless JSON (regression: `task_id: undefined`
  //    used to fail dsh-tools' output boundary with INVALID_TOOL_OUTPUT).
  //    Re-load tools.js fresh with a stubbed pipeline so execute() runs offline.
  const pipelinePath = require.resolve('../host/pipeline')
  const mockPipeline = {
    paperIdFromPdfPath: () => 'p-mock',
    processPdf: async () => ({
      batchId: 'batch-mock-001',
      zipPath: 'mock.zip',
      workDir: 'mock-work',
      dir: path.join(root, 'data', paperId),
      paperId,
      paperMd,
      anchors,
      meta: {
        id: paperId, title: 'Mock Paper', source_pdf: 'mock.pdf', mineru_task: 'batch-mock-001',
        middle_json: 'layout.json', created_at: '2026-08-26T00:00:00.000Z',
        stats: { pages: 1, kept_blocks: 4, kept_chars: 123, skipped: { by_type: { table: 1 }, header_footer: 0 } },
      },
    }),
  }
  const toolsPath = require.resolve('../host/tools')
  delete require.cache[toolsPath]
  delete require.cache[pipelinePath]
  require.cache[pipelinePath] = { id: pipelinePath, filename: pipelinePath, loaded: true, exports: mockPipeline }
  const { parsePdfTool: parsePdfToolFresh } = require('../host/tools')
  const parseOut = await parsePdfToolFresh().execute({ pdf_path: 'D:/mock.pdf', root })
  assert(parseOut.ok === true && parseOut.task_id === 'batch-mock-001', 'parse_pdf maps batchId to task_id')
  assertLosslessJson(parseOut, 'parse_pdf output')
  assertLosslessJson(initial, 'read_highlights output')
  assertLosslessJson(written, 'write_highlights output')

  console.log(JSON.stringify({
    step: 'tools',
    result: 'PASS',
    tools: names,
    defineTool_conversion: 'parameters->object json schema, output.render ok',
    read_write_round_trip: 'ok',
    invalid_span_rejected: true,
    lossless_output: 'parse_pdf / read_highlights / write_highlights all lossless JSON',
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('TOOLS TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
