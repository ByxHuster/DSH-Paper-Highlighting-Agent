'use strict'

/**
 * Offline verification of the agent tool definitions (host/tools.js):
 *   - defineTool conversion (parameters → JSON schema, output render)
 *   - read_highlights / write_highlights execute against a real store
 *   - schema rejection of an invalid span
 *   - append-mode regression: write_highlights preserves existing spans when
 *     adding new ones (Phase 3 propose skill's append contract)
 *   - list_sections / read_section (Phase 3): section index + body text with
 *     plan/span merge, lossless JSON, unknown-section ok:false
 *
 * Run:  node test/run-tools.js   (deps are installed locally in the package)
 */

const fsp = require('node:fs/promises')
const path = require('node:path')

const { defineTool } = require('@deepseek-ai/dsh-tools')

const { buildMockZip } = require('./fixtures/make-mock-zip')
const { normalizeMineruZip } = require('../host/normalize')
const { writePaper } = require('../host/store')
const { parsePdfTool, readHighlightsTool, writeHighlightsTool, listSectionsTool, readSectionTool } = require('../host/tools')
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

  // 6) append-mode regression (Phase 3 propose skill contract): starting from
  //    the doc with s-001, append s-002; the original span + decisions must
  //    survive untouched and the new one lands last.
  const readTool2 = readHighlightsTool()
  const writeTool2 = writeHighlightsTool()
  const cur = await readTool2.execute({ paper_id: paperId, root })
  const secondAnchor = Object.keys(anchors)[1] || Object.keys(anchors)[0]
  const appended = { ...cur.highlights }
  appended.spans = [
    ...appended.spans,
    {
      id: 's-002', anchor: secondAnchor, char_start: 0, char_end: 6, color: 'blue',
      rationale: 'append regression span', status: 'proposed',
      decisions: [{ action: 'proposed', by: 'agent', at: new Date().toISOString() }],
    },
  ]
  const appendedWritten = await writeTool2.execute({ paper_id: paperId, highlights: appended, root })
  assert(appendedWritten.spans === 2, 'append write should report 2 spans')
  const afterAppend = await readTool2.execute({ paper_id: paperId, root })
  assert(afterAppend.spans === 2, 'read back after append should report 2 spans')
  assert(afterAppend.highlights.spans[0].id === 's-001' && afterAppend.highlights.spans[0].decisions.length === 1,
    'append must preserve the original span + its decisions untouched')
  assert(afterAppend.highlights.spans[1].id === 's-002' && afterAppend.highlights.spans[1].status === 'proposed',
    'append must land the new span last with status proposed')
  assertLosslessJson(afterAppend, 'read_highlights after append')

  // 7) list_sections / read_section (Phase 3): plan + span merge over the
  //    derived section index, unknown-section ok:false, lossless output.
  //    Uses a dedicated fixture (like run-plugin's seedFixture) with real
  //    section headings so the section index is deterministic.
  const secRoot = path.join(__dirname, '.tmp', 'tools-sections-root')
  await fsp.rm(secRoot, { recursive: true, force: true })
  const secPaperId = 'p-sections'
  const secMd = ['# Title', '', '## Abstract', '', 'Abstract body text.', '', '## References', ''].join('\n')
  const secFind = (s) => secMd.indexOf(s)
  const secAnchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: secFind('Title') },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'title', text: 'Abstract', md_offset: secFind('Abstract') },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'Abstract body text.', md_offset: secFind('Abstract body text.') },
    'a-0001-04-01': { page: 1, block: 4, par: 1, type: 'title', text: 'References', md_offset: secFind('References') },
  }
  await writePaper(secRoot, secPaperId, {
    paperMd: secMd,
    anchors: secAnchors,
    meta: { id: secPaperId, title: 'Title', source_pdf: 's.pdf', mineru_task: 'm', stats: { kept_blocks: 4 } },
  })
  const secRead = readHighlightsTool()
  const secWrite = writeHighlightsTool()
  const secDoc = { ...(await secRead.execute({ paper_id: secPaperId, root: secRoot })).highlights }
  secDoc.plan.sections = [
    { id: 's2', section: 'Abstract', expected_colors: ['red', 'blue'], density_hint: '2-3 处', skip: false },
    { id: 's3', section: 'References', expected_colors: [], density_hint: '', skip: true },
  ]
  secDoc.spans = [
    { id: 's-001', anchor: 'a-0001-03-01', char_start: 0, char_end: 7, color: 'red', rationale: 'core', status: 'proposed', decisions: [] },
    { id: 's-002', anchor: 'a-0001-01-01', char_start: 0, char_end: 5, color: 'blue', rationale: 'title', status: 'proposed', decisions: [] },
  ]
  await secWrite.execute({ paper_id: secPaperId, highlights: secDoc, root: secRoot })

  const listTool = listSectionsTool()
  const listOut = await listTool.execute({ paper_id: secPaperId, root: secRoot })
  assert(listOut.ok === true && listOut.total === 3, 'list_sections: 3 sections (title + Abstract + References)')
  assert(listOut.reviewable === 1, 'list_sections: only Abstract is reviewable (title + empty References excluded)')
  const s2row = listOut.sections.find((s) => s.id === 's2')
  assert(s2row && s2row.kind === 'section' && s2row.empty === false, 'list_sections: s2 Abstract is a non-empty section')
  assert(s2row.anchor_count === 2 && s2row.span_count === 1, 'list_sections: s2 has 2 anchors and 1 span (abstract body only, not title)')
  assert(s2row.status === 'pending' && s2row.expected_colors.join(',') === 'red,blue' && s2row.density_hint === '2-3 处', 'list_sections: plan entry merged into s2')
  const s3row = listOut.sections.find((s) => s.id === 's3')
  assert(s3row && s3row.empty === true && s3row.skip === true, 'list_sections: empty References carries skip:true')
  assertLosslessJson(listOut, 'list_sections output')

  const secTool = readSectionTool()
  const secOut = await secTool.execute({ paper_id: secPaperId, section: 's2', root: secRoot })
  assert(secOut.ok === true && secOut.section.id === 's2' && secOut.section.anchor_count === 2, 'read_section: resolves s2')
  assert(secOut.text === 'Abstract\nAbstract body text.', 'read_section: body text is anchor texts concatenated in reading order')
  assert(secOut.char_count === secOut.text.length, 'read_section: char_count matches text length')
  assert(secOut.plan && secOut.plan.id === 's2' && secOut.plan.density_hint === '2-3 处', 'read_section: returns the section plan entry')
  assert(Array.isArray(secOut.spans) && secOut.spans.length === 1 && secOut.spans[0].id === 's-001',
    'read_section: spans filtered to the section anchors only')
  const badSec = await secTool.execute({ paper_id: secPaperId, section: 's99', root: secRoot })
  assert(badSec.ok === false && typeof badSec.error === 'string' && /s1, s2, s3/.test(badSec.error),
    'read_section: unknown section returns ok:false with available ids')
  assertLosslessJson(secOut, 'read_section output')
  assertLosslessJson(badSec, 'read_section unknown-section output')

  console.log(JSON.stringify({
    step: 'tools',
    result: 'PASS',
    tools: [...defs.map((d) => d.name), 'list_sections', 'read_section'],
    defineTool_conversion: 'parameters->object json schema, output.render ok',
    read_write_round_trip: 'ok',
    invalid_span_rejected: true,
    lossless_output: 'parse_pdf / read_highlights / write_highlights / list_sections / read_section all lossless JSON',
    append_mode: 'write_highlights preserves existing spans + decisions when adding',
    section_tools: 'list_sections (index + plan/span merge) + read_section (body text + filtered spans, unknown -> ok:false)',
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('TOOLS TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
