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

  // 8) summarize_section_diff (Phase 4): classify each span's proposed→final
  //    trajectory from decisions[], aggregate counts/accept_rate, sample spans.
  const { summarizeSectionDiffTool } = require('../host/tools')
  const iso = (n) => new Date(Date.UTC(2026, 7, 27, 0, 0, n)).toISOString()
  const dsec = { ...(await secRead.execute({ paper_id: secPaperId, root: secRoot })).highlights }
  dsec.spans = [
    // plain accept
    { id: 's-001', anchor: 'a-0001-03-01', char_start: 0, char_end: 8, color: 'red', rationale: 'core', status: 'accepted', decisions: [{ action: 'proposed', by: 'agent', at: iso(1) }, { action: 'accepted', by: 'user', at: iso(2) }] },
    // rejected
    { id: 's-002', anchor: 'a-0001-03-01', char_start: 8, char_end: 13, color: 'yellow', rationale: 'fluff', status: 'rejected', decisions: [{ action: 'proposed', by: 'agent', at: iso(3) }, { action: 'rejected', by: 'user', at: iso(4) }] },
    // recolored then accepted
    { id: 's-003', anchor: 'a-0001-03-01', char_start: 13, char_end: 19, color: 'blue', rationale: 'method', status: 'accepted', decisions: [{ action: 'proposed', by: 'agent', at: iso(5) }, { action: 'recolored', by: 'user', at: iso(6), from: 'yellow', to: 'blue' }, { action: 'accepted', by: 'user', at: iso(7) }] },
    // rescoped
    { id: 's-004', anchor: 'a-0001-03-01', char_start: 9, char_end: 15, color: 'green', rationale: 'takeaway', status: 'accepted', decisions: [{ action: 'proposed', by: 'agent', at: iso(8) }, { action: 'rescoped', by: 'user', at: iso(9), from: { anchor: 'a-0001-03-01', char_start: 9, char_end: 18 }, to: { anchor: 'a-0001-03-01', char_start: 9, char_end: 15 } }] },
    // user added
    { id: 's-005', anchor: 'a-0001-03-01', char_start: 5, char_end: 12, color: 'purple', rationale: '', status: 'user_added', decisions: [{ action: 'added', by: 'user', at: iso(10) }] },
    // pending (no user decision)
    { id: 's-006', anchor: 'a-0001-03-01', char_start: 13, char_end: 16, color: 'yellow', rationale: 'open', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: iso(11) }] },
  ]
  await secWrite.execute({ paper_id: secPaperId, highlights: dsec, root: secRoot })

  const diffTool = summarizeSectionDiffTool()
  const diffOut = await diffTool.execute({ paper_id: secPaperId, section: 's2', root: secRoot })
  assert(diffOut.ok === true && diffOut.scope.kind === 'section' && diffOut.scope.section.id === 's2', 'summarize_section_diff: resolves section scope')
  assert(diffOut.total === 6 && diffOut.pending === 1 && diffOut.decided === 5, 'summarize_section_diff: total/pending/decided counts')
  assert(diffOut.counts.accepted === 1 && diffOut.counts.rejected === 1 && diffOut.counts.recolored === 1,
    'summarize_section_diff: accepted/rejected/recolored primary counts')
  assert(diffOut.counts.rescoped === 1 && diffOut.counts.added === 1 && diffOut.counts.pending === 1,
    'summarize_section_diff: rescoped/added/pending primary counts')
  assert(Math.abs(diffOut.accept_rate - 0.2) < 1e-9, 'summarize_section_diff: accept_rate = accepted/decided (1/5)')
  assert(diffOut.samples.recolored.length === 1 && diffOut.samples.recolored[0].recolor.from === 'yellow' && diffOut.samples.recolored[0].recolor.to === 'blue',
    'summarize_section_diff: recolored sample carries from/to')
  assert(diffOut.samples.rescoped.length === 1 && diffOut.samples.rescoped[0].rescope.to.char_start === 9 && diffOut.samples.rescoped[0].rescope.to.char_end === 15,
    'summarize_section_diff: rescoped sample carries the to-range')
  assert(diffOut.samples.added.length === 1 && diffOut.samples.added[0].span_id === 's-005', 'summarize_section_diff: added sample')
  assertLosslessJson(diffOut, 'summarize_section_diff output')
  const diffPaper = await diffTool.execute({ paper_id: secPaperId, root: secRoot })
  assert(diffPaper.ok === true && diffPaper.scope.kind === 'paper' && diffPaper.total === 6, 'summarize_section_diff: paper-wide scope when section omitted')
  const diffBad = await diffTool.execute({ paper_id: secPaperId, section: 's99', root: secRoot })
  assert(diffBad.ok === false && typeof diffBad.error === 'string', 'summarize_section_diff: unknown section ok:false')
  assertLosslessJson(diffPaper, 'summarize_section_diff paper-wide output')

  // 9) duplicates append-only contract (Phase 4): schema validates entries.
  const dupDoc = { ...(await secRead.execute({ paper_id: secPaperId, root: secRoot })).highlights }
  dupDoc.duplicates = [
    { claim: 'transformer parallelization advantage', highlighted_at: 's-001', repeats_at: ['a-0002-01-03', 'a-0009-04-01'] },
  ]
  const dupOk = await secWrite.execute({ paper_id: secPaperId, highlights: dupDoc, root: secRoot })
  assert(dupOk.ok === true, 'duplicates: valid entry accepted')
  const dupBad = { ...dupDoc, duplicates: [{ claim: '' }] }
  let dupThrew = false
  try {
    await secWrite.execute({ paper_id: secPaperId, highlights: dupBad, root: secRoot })
  } catch (err) {
    dupThrew = true
    assert(/claim must be a non-empty string/.test(err.message), `duplicates: invalid entry error message: ${err.message}`)
  }
  assert(dupThrew, 'duplicates: entry without claim rejected')
  const dupBad2 = { ...dupDoc, duplicates: [{ claim: 'x', repeats_at: 'a-1' }] }
  let dupThrew2 = false
  try {
    await secWrite.execute({ paper_id: secPaperId, highlights: dupBad2, root: secRoot })
  } catch (err) {
    dupThrew2 = true
    assert(/repeats_at must be an array/.test(err.message), `duplicates: bad repeats_at error message: ${err.message}`)
  }
  assert(dupThrew2, 'duplicates: non-array repeats_at rejected')

  // 10) profile tools (v0.3 Phase 0): read_profile + confirm_proposal
  const { readProfileTool, confirmProposalTool } = require('../host/tools')
  const { writeReflections, ensureProfile, writeProfile } = require('../host/profile')
  const pDefs = [readProfileTool(), confirmProposalTool()].map(defineTool)
  for (const d of pDefs) {
    assert(typeof d.name === 'string' && d.name.length > 0, `profile tool name missing: ${JSON.stringify(d)}`)
    assert(d.parameters && d.parameters.type === 'object', `profile tool ${d.name}: parameters convert to object JSON schema`)
    assert(d.output && typeof d.output.render === 'function', `profile tool ${d.name}: output.render must be a function`)
  }
  const profRead = await readProfileTool().execute({ root })
  assert(profRead.ok === true && profRead.has_profile === false, 'read_profile: no profile yet (cold start)')
  assert(profRead.summary && profRead.summary.has_profile === false && Object.keys(profRead.summary.colors).length === 5,
    'read_profile: pre-onboarding summary falls back to the 5 built-in color defaults')
  assert(profRead.pending_proposals === 0, 'read_profile: no pending proposals before any reflections')
  assertLosslessJson(profRead, 'read_profile output')

  // confirm_proposal: cold-start creates the profile, applies the proposal once
  const profProposal = {
    paper_id: paperId,
    updated_at: '2026-08-27T00:00:00.000Z',
    sections: [{ section_id: 's1', counts: { accepted: 1, rejected: 0, recolored: 0, rescoped: 0, user_added: 0, pending: 0 } }],
    profile_proposal: {
      rules: [{ rule: 'granularity: 短语级短片段', confidence: 'medium', from: 's-001 rescope' }],
      exemplars: [{ span_id: 's-001', suggested: { color: 'red' }, user_decision: { action: 'accepted' }, section: 's1', note: 'x' }],
      stats: { sections_reviewed: 1 },
    },
  }
  await writeReflections(root, paperId, profProposal)
  const profConfirm = await confirmProposalTool().execute({ paper_id: paperId, decisions: { accept: 'all' }, root })
  assert(profConfirm.ok === true && profConfirm.applied.rules === 1 && profConfirm.applied.exemplars === 1,
    'confirm_proposal: proposal applied (1 rule + 1 exemplar)')
  assert(profConfirm.confirmation && profConfirm.confirmation.accepted === true, 'confirm_proposal: confirmation recorded')
  assertLosslessJson(profConfirm, 'confirm_proposal output')
  const profConfirm2 = await confirmProposalTool().execute({ paper_id: paperId, decisions: { accept: 'all' }, root })
  assert(profConfirm2.ok === false && /already confirmed/.test(profConfirm2.error), 'confirm_proposal: second confirm rejected (one-shot)')
  const profRead2 = await readProfileTool().execute({ root })
  assert(profRead2.ok === true && profRead2.has_profile === true, 'read_profile: profile now exists (cold-start created by confirm)')
  assert(profRead2.profile.rules.length === 1 && profRead2.profile.exemplars.length === 1, 'read_profile: merged rules + exemplars visible')
  assert(profRead2.summary.rules.length === 1 && profRead2.pending_proposals === 0, 'read_profile: summary carries the rule; proposal consumed')
  assertLosslessJson(profRead2, 'read_profile after confirm output')

  // 11) export_paper (v0.4 Phase 1): inline content + stats + lossless + file write.
  //    p-sections spans at this point: s-001 accepted / s-002 rejected /
  //    s-003 accepted / s-004 accepted / s-005 user_added / s-006 proposed.
  const { exportPaperTool } = require('../host/tools')
  const expDef = await exportPaperTool().execute({ paper_id: secPaperId, format: 'html', root: secRoot })
  assert(expDef.ok === true && expDef.format === 'html' && expDef.title === 'Title', 'export_paper: html inline ok with title')
  assert(expDef.stats.exported_marks === 4, 'export_paper: default excludes rejected + proposed (4 marks)')
  assert(expDef.output === 'inline' && typeof expDef.content === 'string' && (expDef.content.match(/<mark/g) || []).length === 4,
    'export_paper: inline returns content string with 4 <mark>')
  assertLosslessJson(expDef, 'export_paper inline output')

  const expPend = await exportPaperTool().execute({ paper_id: secPaperId, format: 'html', include_pending: true, root: secRoot })
  assert(expPend.ok === true && expPend.stats.exported_marks === 5, 'export_paper: include_pending adds proposed (5 marks)')

  const expMd = await exportPaperTool().execute({ paper_id: secPaperId, format: 'md', root: secRoot })
  assert(expMd.ok === true && expMd.format === 'md' && expMd.content.startsWith('# Title'), 'export_paper: md format routing')

  const expFile = await exportPaperTool().execute({ paper_id: secPaperId, format: 'html', output: 'file', root: secRoot })
  assert(expFile.ok === true && expFile.output === 'file' && typeof expFile.file === 'string' && /p-sections\.html$/.test(expFile.file),
    'export_paper: file output returns data/<paper_id>/export/p-sections.html path')
  assert(expFile.content === null && typeof expFile.content_chars === 'number', 'export_paper: file output omits inline content')
  const fileText = await fsp.readFile(expFile.file, 'utf8')
  assert(fileText.startsWith('<!DOCTYPE html>') && (fileText.match(/<mark/g) || []).length === 4, 'export_paper: written file readable + 4 marks')
  assertLosslessJson(expFile, 'export_paper file output')

  const expBad = await exportPaperTool().execute({ paper_id: secPaperId, format: 'pdf', root: secRoot })
  assert(expBad.ok === false && /unsupported export format/.test(expBad.error), 'export_paper: unknown format ok:false')
  const expGhost = await exportPaperTool().execute({ paper_id: 'p-ghost', format: 'html', root: secRoot })
  assert(expGhost.ok === false && typeof expGhost.error === 'string', 'export_paper: unknown paper ok:false')
  assertLosslessJson(expBad, 'export_paper unknown-format output')

  // 12) read_field_map (v0.4 Phase 2, D4): read-only domain-map injection +
  //     not-found hint + root resolution + lossless.
  const { readFieldMapTool } = require('../host/tools')
  const fmRoot = path.join(__dirname, '.tmp', 'tools-fm-root')
  await fsp.rm(fmRoot, { recursive: true, force: true })
  await fsp.mkdir(fmRoot, { recursive: true })

  const fmMissing = await readFieldMapTool().execute({ root: fmRoot })
  assert(fmMissing.ok === false && fmMissing.exists === false && typeof fmMissing.path === 'string' && /propose creating it/.test(fmMissing.error),
    'read_field_map: missing file -> ok:false with create-hint')
  assertLosslessJson(fmMissing, 'read_field_map missing output')

  await fsp.writeFile(path.join(fmRoot, 'field-map.md'), '# 领域地图\n\n## 空白区\n\n（待后续论文累积）\n', 'utf8')
  const fmRead = await readFieldMapTool().execute({ root: fmRoot })
  assert(fmRead.ok === true && fmRead.exists === true && fmRead.chars > 0 && fmRead.content.includes('领域地图'),
    'read_field_map: exists -> content + metadata')
  assert(fmRead.path === path.join(fmRoot, 'field-map.md'), 'read_field_map: path resolved under the given root')
  assertLosslessJson(fmRead, 'read_field_map output')
  await fsp.rm(fmRoot, { recursive: true, force: true })

  // 13) reflect_paper (v0.4 Phase 3, D5): paper-level reflection scaffold —
  //     inline content + stats + lossless + file write + unknown paper.
  const { reflectPaperTool } = require('../host/tools')
  const rp = await reflectPaperTool().execute({ paper_id: secPaperId, root: secRoot })
  assert(rp.ok === true && rp.title === 'Title' && typeof rp.content === 'string' && rp.content.startsWith('# 论文级反思 — Title'),
    'reflect_paper: inline scaffold with title')
  assert(rp.stats.total === 6 && rp.stats.decided === 5 && rp.stats.pending === 1, 'reflect_paper: stats from whole-paper diff')
  assert(rp.content.includes('整篇差异汇总') && rp.content.includes('认可率（accepted/decided）'), 'reflect_paper: diff summary section')
  assert(rp.content.includes('| s2 |') && rp.content.includes('| s3 |'), 'reflect_paper: per-section table rows')
  assert(rp.content.includes('画像现状：'), 'reflect_paper: profile line rendered')
  assert(rp.content.includes('领域地图增补点') && rp.content.includes('导出状态'), 'reflect_paper: field-map + export sections')
  assertLosslessJson(rp, 'reflect_paper inline output')

  const rpFile = await reflectPaperTool().execute({ paper_id: secPaperId, output: 'file', root: secRoot })
  assert(rpFile.ok === true && rpFile.output === 'file' && typeof rpFile.file === 'string' && /paper-reflection\.md$/.test(rpFile.file),
    'reflect_paper: file output returns paper-reflection.md path')
  assert(rpFile.content === null && typeof rpFile.content_chars === 'number', 'reflect_paper: file output omits inline content')
  const rpText = await fsp.readFile(rpFile.file, 'utf8')
  assert(rpText.startsWith('# 论文级反思 — Title'), 'reflect_paper: written file readable')
  assertLosslessJson(rpFile, 'reflect_paper file output')

  const rpGhost = await reflectPaperTool().execute({ paper_id: 'p-ghost', root: secRoot })
  assert(rpGhost.ok === false && typeof rpGhost.error === 'string', 'reflect_paper: unknown paper ok:false')

  // 14) format_all (v0.5): one-click factory reset tool — confirm guard +
  //     clears spans/plan + deletes reflections/paper-reflection/export + the
  //     profile. secRoot state at this point: p-sections 6 spans, a written
  //     paper-reflection.md (from rpFile), no profile / reflections yet.
  const { formatAllTool } = require('../host/tools')
  const fDef = defineTool(formatAllTool())
  assert(fDef.name === 'format_all' && fDef.parameters.type === 'object'
    && Array.isArray(fDef.parameters.required) && fDef.parameters.required.includes('confirm'),
    'format_all: defineTool conversion with required confirm')
  const fmtNo = await formatAllTool().execute({ confirm: false, root: secRoot })
  assert(fmtNo.ok === false && /confirm: true/.test(fmtNo.error), 'format_all: without confirm -> ok:false')
  const fmtBadScope = await formatAllTool().execute({ confirm: true, scope: 'nuke', root: secRoot })
  assert(fmtBadScope.ok === false && /unsupported scope/.test(fmtBadScope.error), 'format_all: unknown scope -> ok:false')
  // seed a profile + reflections, then format everything
  await ensureProfile(secRoot)
  await writeProfile(secRoot, {
    colors: {
      red: { color: '#ff9c94', label: '核心洞见/贡献' }, yellow: { color: '#fff3a0', label: '关键定义/方法' },
      blue: { color: '#8fd0f7', label: '局限/风险' }, green: { color: '#b0e3a8', label: '可借鉴/启发' }, purple: { color: '#d9b8f2', label: '待深挖/存疑' },
    },
    rules: [{ id: 'rule-1', rule: 'density: 3-5', confidence: 'medium', enabled: true }],
    exemplars: [{ span_id: 's-001', user_decision: { action: 'accepted' } }],
    stats: { papers: [], overall: { papers_reviewed: 0, decided: 0, approved: 0, approve_rate: 0, modify_rate: 0 } },
    reflection_notes: '# n',
  })
  await writeReflections(secRoot, secPaperId, {
    paper_id: secPaperId,
    updated_at: '2026-08-27T00:00:00.000Z',
    profile_proposal: { rules: [{ rule: 'x' }], exemplars: [], stats: {} },
  })
  const fmtAll = await formatAllTool().execute({ confirm: true, scope: 'all', root: secRoot })
  assert(fmtAll.ok === true && fmtAll.scope === 'all' && typeof fmtAll.at === 'string', 'format_all: confirm + all scope ok')
  assert(fmtAll.papers_processed === 1 && fmtAll.spans_cleared === 6 && fmtAll.plans_cleared === 2,
    'format_all: cleared the 6 fixture spans + 2 plan entries')
  assert(fmtAll.reflections_removed === 1 && fmtAll.paper_reflections_removed === 1, 'format_all: removed reflections + paper-reflection.md')
  assert(fmtAll.profile_removed === true && fmtAll.rules_cleared === 1 && fmtAll.exemplars_cleared === 1,
    'format_all: removed the profile (1 rule + 1 exemplar counted)')
  const fmtAfter = await readHighlightsTool().execute({ paper_id: secPaperId, root: secRoot })
  assert(fmtAfter.ok === true && fmtAfter.spans === 0 && fmtAfter.highlights.plan.sections.length === 0,
    'format_all: highlights reset on disk (paper + anchors kept)')
  assertLosslessJson(fmtAll, 'format_all output')
  assertLosslessJson(fmtNo, 'format_all no-confirm output')

  console.log(JSON.stringify({
    step: 'tools',
    result: 'PASS',
    tools: [...defs.map((d) => d.name), 'list_sections', 'read_section', 'summarize_section_diff', 'read_profile', 'confirm_proposal', 'export_paper', 'read_field_map', 'reflect_paper', 'format_all'],
    defineTool_conversion: 'parameters->object json schema, output.render ok',
    read_write_round_trip: 'ok',
    invalid_span_rejected: true,
    lossless_output: 'parse_pdf / read_highlights / write_highlights / list_sections / read_section / summarize_section_diff / read_profile / confirm_proposal all lossless JSON',
    append_mode: 'write_highlights preserves existing spans + decisions when adding',
    section_tools: 'list_sections (index + plan/span merge) + read_section (body text + filtered spans, unknown -> ok:false)',
    diff_tool: 'summarize_section_diff — decisions[]-driven classification (accepted/rejected/recolored/rescoped/added/pending) + counts/accept_rate + samples (Phase 4)',
    duplicates_contract: 'schema validates duplicates entries (claim non-empty, repeats_at string array); append-only registration (Phase 4)',
    profile_tools: 'read_profile (has_profile/summary/pending, cold-start defaults) + confirm_proposal (one-shot host merge: rules/exemplars applied, confirmation append-only, double-confirm rejected) (v0.3 Phase 0)',
    export_tool: 'export_paper — inline (content + stats, lossless) / file (data/<paper_id>/export/<paper_id>.<ext>), format html|md, include_pending effect (4→5 marks), unknown format/paper ok:false (v0.4 Phase 1)',
    field_map_tool: 'read_field_map — read-only domain-map injection (content+path+chars), missing -> ok:false with create-hint, root resolution, lossless (v0.4 Phase 2)',
    reflect_paper_tool: 'reflect_paper — paper-level reflection scaffold (D5): whole-paper diff stats + per-section table + profile line + field-map/export sections; inline/file output, lossless, unknown paper ok:false (v0.4 Phase 3)',
    format_all_tool: 'format_all — one-click factory reset (v0.5): confirm guard (ok:false without), scope all/highlights/profile, clears spans/plan + deletes reflections/paper-reflection + removes the profile (rules/exemplars counted); paper + anchors kept, lossless',
  }, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('TOOLS TEST FAILED:', err && err.message ? err.message : err)
    process.exit(1)
  })
