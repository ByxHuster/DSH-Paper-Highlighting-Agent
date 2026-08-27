'use strict'

/**
 * paper-highlight · render helper unit test (v0.2 Phase 0 + Phase 2 P2-a/P2-b)
 *
 * Exercises the SAME pure functions that are embedded into the shipped bundle
 * (client/render-body.js exports the module-level source, and gen-client.js
 * embeds their toString() into client.js / dynamic/client-half.js):
 *
 *   Phase 0:
 *   - buildBlocks: skips heading blocks of EMPTY sections (References) but
 *     never the paper-title section; drops spans with unknown anchors
 *   - clampRange / renderText: out-of-range spans are clamped (whitespace /
 *     normalization drift tolerance, design §10 #4) instead of throwing
 *
 *   Phase 2 P2-a (write path):
 *   - buildWriteUrl / encodeWriteBody: URL + JSON body builders
 *   - callWrite: data function over an injected transport (ok/failure paths)
 *
 *   Phase 2 P2-b (interaction state):
 *   - localApplySpans: optimistic-update reducer matrix (accept/reject/
 *     recolor/rescope/note/add, immutability, no-op tolerance)
 *   - excludeRejected: rejected spans filtered for rendering, JSON kept
 *   - spanActiveStyle: status → visual style mapping
 *
 *   Phase 2 P2-c (action bar):
 *   - markStyle: color chip + status style + selected outline / pointer cursor
 *   - renderText(opts): onMarkClick attached + active outline when selected
 *   - reconcileSpan: server-confirmed span merged into the optimistic overlay
 *
 *   Phase 2 P2-d (selection → add / rescope):
 *   - buildBlockSegments / buildSegmentMap: flat per-block segment map
 *   - mapSelection: normalized selection → anchor range (same-segment /
 *     cross-segment / reverse / out-of-range / empty / cross-anchor)
 *   - nodeOffsetToSeg / blockChildToSeg / selectionToNorm: DOM-ish boundary
 *     resolution (text node inside seg el / seg el / block element / null)
 *   - renderText(withSegments): every text node wrapped with data-phl-seg +
 *     data-phl-anchor (bare strings preserved when disabled)
 *   - reconcileSpan(3rd arg): `add` optimistic span matched by clientId
 *
 *   Phase 2 P2-e (review-complete signal):
 *   - sectionList: reviewable section filter (skip paper_title + empty) +
 *     plan/override status merge
 *   - currentSectionId: scroll state → current section (viewport middle rule,
 *     paper_title/empty never current, missing blockTop skipped)
 *
 * Run:  node test/run-render.js
 */

const {
  clampRange, sortAnchorIds, buildBlocks, renderText,
  buildWriteUrl, encodeWriteBody, callWrite,
  callProfile, colorLegend,
  excludeRejected, localApplySpans, spanActiveStyle,
  markStyle, reconcileSpan,
  buildBlockSegments, buildSegmentMap, mapSelection,
  nodeOffsetToSeg, blockChildToSeg, selectionToNorm,
  sectionList, currentSectionId,
  profilePanelModel, profilePanelColors, profileSavePayload,
  proposalCardModel, buildApplyDecisions,
} = require('../client/render-body')
const { assert } = require('./verify')

// minimal React stub so renderText can create mark nodes
const reactStub = {
  createElement(type, props, ...children) {
    const flat = []
    for (const c of children) {
      if (Array.isArray(c)) flat.push(...c)
      else if (c !== null && c !== undefined && c !== false) flat.push(c)
    }
    return { type, props: props || {}, children: flat }
  },
}
global.React = reactStub

function fixture() {
  const anchors = {
    'a-0001-01-01': { page: 1, block: 1, par: 1, type: 'title', text: 'Title', md_offset: 2 },
    'a-0001-02-01': { page: 1, block: 2, par: 1, type: 'title', text: 'Abstract', md_offset: 28 },
    'a-0001-03-01': { page: 1, block: 3, par: 1, type: 'text', text: 'Abstract body text.', md_offset: 38 },
    'a-0001-04-01': { page: 1, block: 4, par: 1, type: 'title', text: 'References', md_offset: 62 },
  }
  const sections = [
    { id: 's1', title: 'Title', kind: 'paper_title', anchor_id: 'a-0001-01-01', empty: true },
    { id: 's2', title: 'Abstract', kind: 'section', anchor_id: 'a-0001-02-01', empty: false },
    { id: 's3', title: 'References', kind: 'section', anchor_id: 'a-0001-04-01', empty: true },
  ]
  const spans = [
    { id: 's-001', anchor: 'a-0001-03-01', char_start: 0, char_end: 7, color: 'red', rationale: 'core', status: 'proposed' },
    { id: 's-002', anchor: 'a-0009-99-99', char_start: 0, char_end: 3, color: 'blue', rationale: 'ghost', status: 'proposed' },
  ]
  return { anchors, sections, spans }
}

function main() {
  // ── clampRange ─────────────────────────────────────────────────────────────
  assert(JSON.stringify(clampRange(2, 6, 10)) === '[2,6]', 'in-range span unchanged')
  assert(JSON.stringify(clampRange(20, 30, 10)) === '[10,10]', 'fully-out-of-range span clamps to end')
  assert(JSON.stringify(clampRange(-5, 3, 10)) === '[0,3]', 'negative start clamps to 0')
  assert(JSON.stringify(clampRange(8, 99, 10)) === '[8,10]', 'overflowing end clamps to len')
  assert(JSON.stringify(clampRange(6, 2, 10)) === '[6,6]', 'inverted range degrades to a point')

  // ── buildBlocks: empty-section skip + paper title kept + ghost span dropped ─
  const { anchors, sections, spans } = fixture()
  const blocks = buildBlocks(anchors, spans, sections)
  const ids = blocks.map((b) => b.id)
  assert(ids.length === 3, '3 blocks rendered (Title, Abstract, body)')
  assert(ids[0] === 'a-0001-01-01', 'paper title kept as first block')
  assert(!ids.includes('a-0001-04-01'), 'empty References heading skipped')
  assert(!ids.includes('a-0009-99-99'), 'ghost span anchor never becomes a block')
  const bodyBlock = blocks.find((b) => b.id === 'a-0001-03-01')
  assert(bodyBlock && bodyBlock.spans.length === 1 && bodyBlock.spans[0].id === 's-001', 'ghost span (unknown anchor) dropped from span list')
  assert(blocks.find((b) => b.id === 'a-0001-01-01').isFirstTitle === true, 'paper title flagged as first title (h1)')

  // without sections (dynamic-half fallback) nothing is skipped
  const noSections = buildBlocks(anchors, spans, null)
  assert(noSections.length === 4, 'without sections: no skip (4 blocks)')

  // ── renderText: clamped rendering still emits a mark ───────────────────────
  const text = 'Abstract body text.'
  const out = renderText(text, [{ id: 's-x', char_start: 100, char_end: 200, color: 'red', rationale: 'r', status: 'accepted' }])
  assert(out.length === 1, 'fully out-of-range span renders the plain text')
  assert(typeof out[0] === 'string' && out[0] === text, 'clamped-to-point span yields no mark, full text preserved')

  const out2 = renderText(text, [{ id: 's-y', char_start: 0, char_end: 200, color: 'blue', rationale: 'drift', status: 'proposed' }])
  const mark = out2.find((n) => n && n.type === 'mark')
  assert(mark && mark.children.join('') === text, 'overflowing span clamps to full text and still renders a mark')
  assert(mark.props.title.includes('drift') && mark.props.style.background === '#8fd0f7', 'mark carries rationale + blue color')

  // ── sortAnchorIds reading order ─────────────────────────────────────────────
  const sorted = sortAnchorIds(anchors)
  assert(JSON.stringify(sorted) === JSON.stringify(['a-0001-01-01', 'a-0001-02-01', 'a-0001-03-01', 'a-0001-04-01']), 'anchors in (page, block, par) order')

  // ══════════════════ P2-a: write path (buildWriteUrl / encodeWriteBody / callWrite) ══════════════════
  assert(buildWriteUrl('p-x') === '/paper-hl/write?paperId=p-x', 'buildWriteUrl appends paperId query')
  assert(buildWriteUrl(null) === '/paper-hl/write', 'buildWriteUrl without paperId -> bare path')
  assert(buildWriteUrl(undefined) === '/paper-hl/write', 'buildWriteUrl with undefined paperId -> bare path')
  assert(buildWriteUrl('a b/c') === '/paper-hl/write?paperId=a%20b%2Fc', 'buildWriteUrl encodes the paperId segment')

  const payload = { action: 'recolor', span_id: 's-001', color: 'green' }
  assert(JSON.parse(encodeWriteBody(payload)).color === 'green', 'encodeWriteBody JSON-encodes the action')
  assert(encodeWriteBody(null) === '{}' && encodeWriteBody(undefined) === '{}', 'encodeWriteBody null/undefined -> {}')

  // callWrite over an injected transport
  const seen = []
  const okTransport = async (url, body) => { seen.push({ url, body }); return { ok: true, action: 'recolor', span_count: 5 } }

  return callWrite(payload, 'p-x', okTransport).then((res) => {
    assert(res && res.ok === true && res.span_count === 5, 'callWrite resolves the ok transport response')
    assert(seen.length === 1 && seen[0].url === '/paper-hl/write?paperId=p-x', 'callWrite uses buildWriteUrl for the POST URL')
    assert(JSON.parse(seen[0].body).action === 'recolor' && JSON.parse(seen[0].body).span_id === 's-001', 'callWrite sends the encoded action body')
  }).then(() => {
    // failure: ok:false payload rejects with the server error message
    return callWrite(payload, 'p-x', async () => ({ ok: false, error: 'unknown span id' })).then(
      () => { throw new Error('callWrite should reject on ok:false') },
      (err) => assert(/unknown span id/.test(err.message), 'callWrite rejects an ok:false payload with its error'),
    )
  }).then(() => {
    // failure: transport throws (HTTP error) propagates
    return callWrite(payload, 'p-x', async () => { throw new Error('POST -> 400') }).then(
      () => { throw new Error('callWrite should propagate transport failure') },
      (err) => assert(/POST -> 400/.test(err.message), 'callWrite propagates transport errors'),
    )
  }).then(() => {
    // no transport (dynamic-half fallback): clear rejection, no crash
    return callWrite(payload, 'p-x').then(
      () => { throw new Error('callWrite without transport should reject') },
      (err) => assert(/write transport not available/.test(err.message), 'callWrite without transport rejects cleanly'),
    )
  }).then(() => {
    // ══════════════════ v0.3 Phase 1: callProfile (profile transport) ══════════════════
    const profCalls = []
    const okProfileTransport = async (method, url, body) => { profCalls.push({ method, url, body }); return { ok: true, has_profile: true } }
    return callProfile('GET', '', null, okProfileTransport).then((res) => {
      assert(res && res.ok === true && res.has_profile === true, 'callProfile resolves the ok transport response')
      assert(profCalls.length === 1 && profCalls[0].method === 'GET' && profCalls[0].url === '/paper-hl/profile' && profCalls[0].body === null,
        'callProfile GET uses /paper-hl/profile with no body')
    }).then(() => {
      return callProfile('POST', '/init', { colors: {} }, okProfileTransport).then((res) => {
        assert(res.ok === true, 'callProfile POST resolves ok')
        assert(profCalls[1].method === 'POST' && profCalls[1].url === '/paper-hl/profile/init' && JSON.parse(profCalls[1].body).colors !== undefined,
          'callProfile POST /init sends the JSON payload')
      })
    }).then(() => {
      return callProfile('GET', '', null, async () => ({ ok: false, error: 'no profile route' })).then(
        () => { throw new Error('callProfile should reject on ok:false') },
        (err) => assert(/no profile route/.test(err.message), 'callProfile rejects an ok:false payload with its error'),
      )
    }).then(() => {
      return callProfile('GET', '').then(
        () => { throw new Error('callProfile without transport should reject') },
        (err) => assert(/profile transport not available/.test(err.message), 'callProfile without transport rejects cleanly'),
      )
    })
  }).then(() => {
    // ══════════════════ v0.3 Phase 1: colorLegend (colors.yml-driven palette) ══════════════════
    const defLegend = colorLegend(null)
    assert(defLegend.length === 5, 'colorLegend(null): falls back to the 5 built-in colors')
    assert(defLegend[0].name === 'yellow' && defLegend[0].color === '#fff3a0' && defLegend[0].label === '关键定义/方法',
      'colorLegend(null): first entry matches the built-in COLOR_MAP/LABELS order')
    const custom = colorLegend({ red: { color: '#ff0000', label: '红' }, teal: { color: '#7fe0d0', label: '新颜色' } })
    assert(custom.length === 2 && custom[0].name === 'red' && custom[0].color === '#ff0000' && custom[0].label === '红',
      'colorLegend(custom): resolves custom colors/labels in map order')
    const partial = colorLegend({ blue: { color: '#123456' } })
    assert(partial.length === 1 && partial[0].color === '#123456' && partial[0].label === '局限/风险',
      'colorLegend(partial): missing label falls back to the built-in label')
    const empty = colorLegend({})
    assert(empty.length === 5 && empty[0].color === '#fff3a0', 'colorLegend({}): empty map falls back to the defaults')
    const unknown = colorLegend({ x: {} })
    assert(unknown.length === 1 && unknown[0].color === '#cccccc' && unknown[0].label === 'x',
      'colorLegend: unknown color name + missing data → neutral chip + name label')
    assert(colorLegend(undefined).length === 5 && colorLegend(null).length === 5, 'colorLegend: null/undefined → defaults')

    // markStyle resolves the chip background through the profile colors (4th arg)
    const ms1 = markStyle({ id: 's-1', color: 'red', status: 'proposed' }, false, false, { red: { color: '#ff0000', label: '红' } })
    assert(ms1.background === '#ff0000', 'markStyle(colors): chip background resolved via the profile color map')
    const ms2 = markStyle({ id: 's-1', color: 'red', status: 'proposed' }, false, false, null)
    assert(ms2.background === '#ff9c94', 'markStyle(colors=null): falls back to the built-in COLOR_MAP')
    const ms3 = markStyle({ id: 's-1', color: 'teal', status: 'accepted' }, true, true, { teal: { color: '#7fe0d0', label: '新颜色' } })
    assert(ms3.background === '#7fe0d0' && ms3.opacity === 1 && ms3.outline !== undefined, 'markStyle(colors): custom color + status style + outline')
    const ms4 = markStyle({ id: 's-1', color: 'nope', status: 'proposed' }, false, false, { red: { color: '#ff0000' } })
    assert(ms4.background === 'nope', 'markStyle(colors): unknown span color renders its literal value (no crash)')

    // renderText passes opts.colors through to markStyle
    const coloredOut = renderText('hello world', [
      { id: 's-1', anchor: 'a-1', char_start: 0, char_end: 5, color: 'red', status: 'proposed' },
    ], { colors: { red: { color: '#ff0000', label: '红' } } })
    const cMark = coloredOut.find((n) => n && n.type === 'mark')
    assert(cMark && cMark.props.style.background === '#ff0000', 'renderText(opts.colors): mark background from the profile palette')
    const defaultOut = renderText('hello world', [
      { id: 's-1', anchor: 'a-1', char_start: 0, char_end: 5, color: 'red', status: 'proposed' },
    ])
    const dMark = defaultOut.find((n) => n && n.type === 'mark')
    assert(dMark && dMark.props.style.background === '#ff9c94', 'renderText without opts.colors: built-in color (backward compat)')
  }).then(() => {
    // ══════════════════ v0.3 Phase 3: profile edit-panel model + save payload ══════════════════
    const pnlNull = profilePanelModel(null)
    assert(pnlNull.colors.length === 5 && pnlNull.colors[0].name === 'yellow', 'profilePanelModel(null): 5 default color rows')
    assert(pnlNull.rules.length === 0 && pnlNull.exemplars.length === 0 && pnlNull.notes === '', 'profilePanelModel(null): empty rules/exemplars/notes fallback')
    assert(pnlNull.stats && Array.isArray(pnlNull.stats.papers), 'profilePanelModel(null): stats skeleton present')

    const prof = {
      colors: { red: { color: '#ff0000', label: '红核心' }, blue: { color: '#8fd0f7', label: '局限/风险' } },
      rules: [{ id: 'rule-1', rule: 'density: 3-5', enabled: true }, { id: 'rule-2', rule: 'granularity: 句子级', enabled: false }],
      exemplars: [{ span_id: 's-001', note: 'x' }],
      stats: { papers: [{ paper_id: 'p-1', approve_rate: 0.5, modify_rate: 0.5, change_kinds: { accepted: 1 } }], overall: { papers_reviewed: 1, approve_rate: 0.5, modify_rate: 0.5 } },
      reflection_notes: '# 笔记',
    }
    const pnl = profilePanelModel(prof)
    assert(pnl.colors.length === 2 && pnl.colors[0].name === 'red' && pnl.colors[0].color === '#ff0000' && pnl.colors[0].label === '红核心',
      'profilePanelModel(profile): flat color rows from the profile map')
    assert(pnl.rules.length === 2 && pnl.rules[0].id === 'rule-1', 'profilePanelModel(profile): rules passed through')
    assert(pnl.exemplars.length === 1 && pnl.notes === '# 笔记', 'profilePanelModel(profile): exemplars + notes passed through')
    assert(profilePanelColors(prof).length === 2, 'profilePanelColors: color rows only')

    const drafts = {
      colors: [{ name: 'red', color: '#ff0000', label: '红核心' }, { name: 'blue', color: '#001122', label: '蓝' }],
      rules: [{ id: 'rule-1', rule: 'density: 2-4', enabled: true }],
      exemplars: [{ span_id: 's-001' }],
      notes: '新笔记',
    }
    const payload = profileSavePayload(drafts)
    assert(payload.colors.red.color === '#ff0000' && payload.colors.red.label === '红核心' && payload.colors.blue.color === '#001122',
      'profileSavePayload: flat rows re-encoded into the {name:{color,label}} map')
    assert(payload.rules.length === 1 && payload.rules[0].rule === 'density: 2-4', 'profileSavePayload: rules passed through')
    assert(payload.exemplars.length === 1 && payload.reflection_notes === '新笔记', 'profileSavePayload: exemplars + notes')
    const partial = profileSavePayload({ colors: [{ name: 'red', color: '#ff0000', label: 'r' }] })
    assert(partial.colors && partial.rules === undefined && partial.exemplars === undefined && partial.reflection_notes === undefined,
      'profileSavePayload: absent draft layers omitted from the payload')
    assert(JSON.stringify(profileSavePayload({})) === '{}', 'profileSavePayload: empty drafts → empty payload')
  }).then(() => {
    // ══════════════════ v0.3 Phase 2: proposal panel model + decisions ══════════════════
    const entry = {
      paper_id: 'p-apply',
      updated_at: '2026-08-27T00:00:00.000Z',
      proposal: {
        rules: [
          { rule: 'color_semantics: 问题/动机归 red', confidence: 'low', from: 's3 改色' },
          { rule: 'granularity: 短语级', confidence: 'medium', from: 's-003 rescope' },
        ],
        exemplars: [
          { span_id: 's-009', suggested: { color: 'blue' }, user_decision: { color: 'red' }, section: 's3', note: '问题/动机归 red' },
        ],
        stats: { sections_reviewed: 1, overall_accept_rate: 0, recolor_events: 1 },
      },
    }
    const card = proposalCardModel(entry)
    assert(card.paper_id === 'p-apply', 'proposalCardModel: paper_id from the entry')
    assert(card.rules.length === 2 && card.rules[0].id === 'rule-0' && card.rules[1].id === 'rule-1', 'proposalCardModel: rules get proposal-relative ids')
    assert(card.rules[0].text.indexOf('color_semantics') === 0 && card.rules[0].confidence === 'low' && card.rules[0].from === 's3 改色', 'proposalCardModel: rule text/confidence/from')
    assert(card.exemplars.length === 1 && card.exemplars[0].id === 'exemplar-0', 'proposalCardModel: exemplars get proposal-relative ids')
    assert(card.exemplars[0].summary.indexOf('s-009') === 0, 'proposalCardModel: exemplar summary from span_id + decision + note')
    assert(card.stats_text.indexOf('已审节 1') === 0 && card.stats_text.indexOf('接受率 0%') >= 0, 'proposalCardModel: stats one-liner')
    const emptyCard = proposalCardModel({ paper_id: 'p-x', proposal: { rules: [], exemplars: [], stats: null } })
    assert(emptyCard.rules.length === 0 && emptyCard.exemplars.length === 0 && emptyCard.stats_text === '（无统计雏形）', 'proposalCardModel: empty proposal → empty card')

    assert(JSON.stringify(buildApplyDecisions(['rule-0', 'exemplar-0'], [])) === '{"accept":["rule-0","exemplar-0"]}', 'buildApplyDecisions: accept-only payload')
    assert(JSON.stringify(buildApplyDecisions([], ['rule-1'])) === '{"reject":["rule-1"]}', 'buildApplyDecisions: reject-only payload')
    assert(JSON.stringify(buildApplyDecisions(['rule-0'], ['exemplar-1'])) === '{"accept":["rule-0"],"reject":["exemplar-1"]}', 'buildApplyDecisions: mixed payload')
    assert(JSON.stringify(buildApplyDecisions([], [])) === '{}', 'buildApplyDecisions: empty selection → empty payload (no POST)')
  }).then(() => {
    // ══════════════════ P2-b: excludeRejected ══════════════════
    const mixed = [
      { id: 's-001', status: 'proposed' }, { id: 's-002', status: 'accepted' },
      { id: 's-003', status: 'user_added' }, { id: 's-004', status: 'rejected' },
    ]
    const visible = excludeRejected(mixed)
    assert(visible.length === 3 && !visible.some((s) => s.status === 'rejected'), 'excludeRejected drops rejected spans')
    assert(visible.map((s) => s.id).join(',') === 's-001,s-002,s-003', 'excludeRejected keeps proposed/accepted/user_added in order')
    assert(mixed.length === 4 && mixed[3].status === 'rejected', 'excludeRejected does not mutate the input array')
    assert(JSON.stringify(excludeRejected([])) === '[]' && JSON.stringify(excludeRejected(null)) === '[]', 'excludeRejected handles empty/null')

    // ══════════════════ P2-b: spanActiveStyle ══════════════════
    const st = spanActiveStyle
    assert(st('proposed').opacity === 0.75, 'proposed -> translucent (opacity 0.75)')
    assert(st('accepted').opacity === 1, 'accepted -> solid (opacity 1)')
    assert(typeof st('user_added').boxShadow === 'string', 'user_added -> inset outline boxShadow')
    const rej = st('rejected')
    assert(rej.opacity === 0.3 && rej.textDecoration === 'line-through', 'rejected -> dimmed + line-through visual contract')
    assert(typeof st('unknown') === 'object' && st('unknown') !== null, 'unknown status falls back to a style object (proposed default)')

    // ══════════════════ P2-b: localApplySpans (optimistic reducer) ══════════════════
    const base = [
      { id: 's-001', anchor: 'a-0001-02-01', char_start: 0, char_end: 5, color: 'red', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
      { id: 's-002', anchor: 'a-0001-04-01', char_start: 0, char_end: 7, color: 'blue', status: 'proposed', decisions: [{ action: 'proposed', by: 'agent', at: 't0' }] },
    ]
    const baseSnapshot = JSON.stringify(base)

    const acc = localApplySpans(base, { action: 'accept', span_id: 's-001' })
    assert(acc[0].status === 'accepted' && acc[1].status === 'proposed', 'accept flips only the target span status')
    assert(JSON.stringify(base) === baseSnapshot, 'localApplySpans does not mutate the input spans')

    const rej2 = localApplySpans(base, { action: 'reject', span_id: 's-002' })
    assert(rej2[1].status === 'rejected', 'reject flips status to rejected')
    assert(excludeRejected(rej2).length === 1, 'rejected span excluded from rendering after optimistic reject')

    const rec = localApplySpans(base, { action: 'recolor', span_id: 's-001', color: 'green' })
    assert(rec[0].color === 'green' && rec[0].status === 'proposed', 'recolor updates color, leaves status untouched')

    const res = localApplySpans(base, { action: 'rescope', span_id: 's-002', anchor: 'a-0001-02-01', char_start: 3, char_end: 9 })
    assert(res[1].anchor === 'a-0001-02-01' && res[1].char_start === 3 && res[1].char_end === 9, 'rescope updates anchor + range')

    const not = localApplySpans(base, { action: 'note', span_id: 's-001', note: 'check later' })
    assert(not[0].note === 'check later', 'note sets span.note')

    const add = localApplySpans(base, { action: 'add', anchor: 'a-0001-04-01', char_start: 8, char_end: 14, color: 'yellow', rationale: 'user', clientId: 'local-9' })
    assert(add.length === 3 && add[2].id === 'local-9' && add[2].status === 'user_added' && add[2].color === 'yellow', 'add appends a user_added span with clientId')
    assert(add[2].decisions.length === 0 && add[2]._local === true, 'optimistic add is marked _local with empty decisions (server is authoritative)')
    const add2 = localApplySpans(base, { action: 'add', anchor: 'a-0001-04-01', char_start: 0, char_end: 3, color: 'red' })
    assert(add2[2].id === 'local-3', 'add without clientId derives local-<n+1> id')

    // optimistic tolerance: unknown span id / unknown action / missing payload are no-ops
    assert(localApplySpans(base, { action: 'accept', span_id: 's-999' }).length === 2, 'unknown span_id is a no-op')
    assert(localApplySpans(base, { action: 'nuke', span_id: 's-001' })[0].status === 'proposed', 'unknown action is a no-op')
    assert(JSON.stringify(localApplySpans(base, null)) === baseSnapshot, 'null payload is a no-op')
    assert(localApplySpans(base, { action: 'accept' }).length === 2, 'missing span_id is a no-op')

    // ══════════════════ P2-c: markStyle ══════════════════
    const s = { id: 's-001', color: 'blue', status: 'proposed' }
    const st1 = markStyle(s, false, false)
    assert(st1.background === '#8fd0f7' && st1.cursor === 'help', 'markStyle: color chip + help cursor (not clickable)')
    assert(st1.opacity === 0.75 && !('outline' in st1), 'markStyle: proposed translucent, no outline when inactive')
    const st2 = markStyle(s, false, true)
    assert(st2.cursor === 'pointer', 'markStyle: pointer cursor when clickable')
    const st3 = markStyle(s, true, true)
    assert(st3.outline === '2px solid rgba(0,0,0,.6)' && st3.outlineOffset === 1, 'markStyle: selected outline when active')
    const st4 = markStyle({ ...s, status: 'accepted' }, false, false)
    assert(st4.opacity === 1, 'markStyle: accepted solid (opacity 1)')

    // ══════════════════ P2-c: renderText(opts) ══════════════════
    const clickTargets = []
    const out3 = renderText('Abstract body text.', [
      { id: 's-001', anchor: 'a-x', char_start: 0, char_end: 8, color: 'red', status: 'proposed' },
    ], { onMarkClick: (sp) => clickTargets.push(sp.id), activeSpanId: 's-001' })
    const m1 = out3.find((n) => n && n.type === 'mark')
    assert(typeof m1.props.onClick === 'function', 'renderText attaches onClick when onMarkClick provided')
    assert(m1.props.style.outline !== undefined, 'renderText active mark gets the selected outline')
    m1.props.onClick({ stopPropagation() {} })
    assert(clickTargets.length === 1 && clickTargets[0] === 's-001', 'renderText onClick fires onMarkClick with the span')
    const out4 = renderText('Abstract body text.', [
      { id: 's-002', anchor: 'a-x', char_start: 0, char_end: 8, color: 'blue', status: 'proposed' },
    ], { onMarkClick: () => {}, activeSpanId: 's-OTHER' })
    const m2 = out4.find((n) => n && n.type === 'mark')
    assert(m2.props.style.outline === undefined, 'renderText non-active mark has no outline')
    // backward compat: 2-arg call renders a plain (non-clickable) mark
    const out5 = renderText('Abstract body text.', [{ id: 's-003', char_start: 0, char_end: 8, color: 'green', status: 'proposed' }])
    const m3 = out5.find((n) => n && n.type === 'mark')
    assert(m3 && m3.props.onClick === undefined && m3.props.style.cursor === 'help', 'renderText 2-arg keeps non-clickable marks (backward compat)')

    // ══════════════════ P2-c: reconcileSpan ══════════════════
    const overlay = [
      { id: 's-001', anchor: 'a-1', char_start: 0, char_end: 5, color: 'red', status: 'accepted', decisions: [] },
      { id: 's-002', anchor: 'a-2', char_start: 0, char_end: 7, color: 'blue', status: 'proposed', decisions: [] },
    ]
    const serverSpan = { id: 's-001', anchor: 'a-1', char_start: 0, char_end: 5, color: 'green', status: 'accepted', decisions: [{ action: 'accepted', by: 'user', at: 't' }] }
    const rec1 = reconcileSpan(overlay, serverSpan)
    assert(rec1[0].color === 'green' && rec1[0].decisions.length === 1, 'reconcileSpan replaces the matching span with the server copy')
    assert(rec1[1].id === 's-002' && rec1[1].color === 'blue', 'reconcileSpan leaves other spans untouched')
    assert(overlay[0].color === 'red' && overlay[0].decisions.length === 0, 'reconcileSpan does not mutate the overlay input')
    const rec2 = reconcileSpan(overlay, { id: 's-999' })
    assert(rec2.length === 2 && JSON.stringify(rec2[0]) === JSON.stringify(overlay[0]), 'reconcileSpan unknown id keeps the list')
    const rec3 = reconcileSpan(overlay, null)
    assert(rec3.length === 2, 'reconcileSpan null serverSpan keeps the list')
    assert(JSON.stringify(reconcileSpan([], { id: 's-1' })) === '[]', 'reconcileSpan empty list stays empty')

    // ══════════════════ P2-d: buildBlockSegments / buildSegmentMap ══════════════════
    const segText = 'Hello world, this is a test.'
    const segSpans = [{ id: 's-001', char_start: 6, char_end: 11, color: 'red', status: 'proposed' }]
    const segs = buildBlockSegments('a-1', segText, segSpans)
    assert(segs.length === 3, 'buildBlockSegments: 3 segments (plain/mark/plain)')
    assert(segs[0].anchorId === 'a-1' && segs[0].start === 0 && segs[0].end === 6 && segs[0].spanId === null, 'buildBlockSegments: leading plain [0,6)')
    assert(segs[1].start === 6 && segs[1].end === 11 && segs[1].spanId === 's-001', 'buildBlockSegments: mark [6,11) carries spanId')
    assert(segs[2].start === 11 && segs[2].end === segText.length && segs[2].spanId === null, 'buildBlockSegments: trailing plain [11,len)')

    const unordered = buildBlockSegments('a-1', 'ABCDEFGH', [
      { id: 's-002', char_start: 4, char_end: 6 },
      { id: 's-001', char_start: 1, char_end: 3 },
    ])
    assert(unordered.length === 5, 'buildBlockSegments: two marks → 5 segments')
    assert(unordered[0].start === 0 && unordered[0].end === 1, 'buildBlockSegments: out-of-order spans sorted (plain first)')
    assert(unordered[1].spanId === 's-001' && unordered[1].start === 1 && unordered[1].end === 3, 'buildBlockSegments: first mark by start')
    assert(unordered[2].start === 3 && unordered[2].end === 4 && unordered[2].spanId === null, 'buildBlockSegments: middle plain between marks')
    assert(unordered[3].spanId === 's-002' && unordered[3].start === 4 && unordered[3].end === 6, 'buildBlockSegments: second mark')
    assert(unordered[4].start === 6 && unordered[4].end === 8, 'buildBlockSegments: trailing plain')

    assert(buildBlockSegments('a-1', '', []).length === 0, 'buildBlockSegments: empty text → no segments')
    const onlyPlain = buildBlockSegments('a-1', 'abc', [])
    assert(onlyPlain.length === 1 && onlyPlain[0].start === 0 && onlyPlain[0].end === 3, 'buildBlockSegments: no spans → one plain segment')
    const clampedSeg = buildBlockSegments('a-1', 'abc', [{ id: 's-9', char_start: 0, char_end: 99 }])
    assert(clampedSeg.length === 1 && clampedSeg[0].spanId === 's-9' && clampedSeg[0].end === 3, 'buildBlockSegments: overflowing span clamps')

    const flat = buildSegmentMap([
      { id: 'a-1', anchor: { text: 'AB' }, spans: [] },
      { id: 'a-2', anchor: { text: 'CDEF' }, spans: [{ id: 's-1', char_start: 1, char_end: 3 }] },
    ])
    assert(flat.length === 4, 'buildSegmentMap: 1 (a-1) + 3 (a-2) = 4 flat segments')
    assert(flat[0].anchorId === 'a-1' && flat[0].start === 0 && flat[0].end === 2, 'buildSegmentMap: a-1 single plain segment')
    assert(flat[1].anchorId === 'a-2' && flat[1].start === 0 && flat[1].end === 1 && flat[1].spanId === null, 'buildSegmentMap: a-2 leading plain')
    assert(flat[2].anchorId === 'a-2' && flat[2].start === 1 && flat[2].end === 3 && flat[2].spanId === 's-1', 'buildSegmentMap: a-2 mark range preserved')
    assert(flat[3].anchorId === 'a-2' && flat[3].start === 3 && flat[3].end === 4, 'buildSegmentMap: a-2 trailing plain')
    assert(buildSegmentMap([]).length === 0, 'buildSegmentMap: empty blocks → empty')

    // ══════════════════ P2-d: mapSelection matrix ══════════════════
    const mSegs = buildSegmentMap([
      { id: 'a-1', anchor: { text: segText }, spans: segSpans },           // 3 segments
      { id: 'a-2', anchor: { text: 'second paragraph here' }, spans: [] }, // 1 segment
    ])
    const same = mapSelection(mSegs, { start: { seg: 0, offset: 1 }, end: { seg: 0, offset: 4 } })
    assert(same.ok === true && same.anchor === 'a-1' && same.char_start === 1 && same.char_end === 4, 'mapSelection: same-segment selection → [1,4) in a-1')
    const cross = mapSelection(mSegs, { start: { seg: 0, offset: 3 }, end: { seg: 2, offset: 5 } })
    assert(cross.ok === true && cross.anchor === 'a-1' && cross.char_start === 3 && cross.char_end === 16, 'mapSelection: cross-segment same-anchor → [3,16)')
    const rev = mapSelection(mSegs, { start: { seg: 2, offset: 5 }, end: { seg: 0, offset: 3 } })
    assert(rev.ok === true && rev.anchor === 'a-1' && rev.char_start === 3 && rev.char_end === 16, 'mapSelection: reverse selection normalized (swapped)')
    const ca = mapSelection(mSegs, { start: { seg: 0, offset: 0 }, end: { seg: 3, offset: 3 } })
    assert(ca.ok === false && ca.reason === 'cross-anchor', 'mapSelection: cross-anchor selection rejected')
    const oob = mapSelection(mSegs, { start: { seg: 99, offset: 0 }, end: { seg: 0, offset: 3 } })
    assert(oob.ok === false && oob.reason === 'out-of-range', 'mapSelection: out-of-range seg index rejected')
    const clmp = mapSelection(mSegs, { start: { seg: 1, offset: 0 }, end: { seg: 1, offset: 999 } })
    assert(clmp.ok === true && clmp.anchor === 'a-1' && clmp.char_start === 6 && clmp.char_end === 11, 'mapSelection: overflowing offset clamps to segment length')
    const empty = mapSelection(mSegs, { start: { seg: 0, offset: 2 }, end: { seg: 0, offset: 2 } })
    assert(empty.ok === false && empty.reason === 'empty', 'mapSelection: empty selection rejected')
    const bnd = mapSelection(mSegs, { start: { seg: 0, offset: 0 }, end: { seg: 1, offset: 5 } })
    assert(bnd.ok === true && bnd.char_start === 0 && bnd.char_end === 11, 'mapSelection: boundary offsets (0 and segment length)')
    assert(mapSelection(mSegs, null).ok === false && mapSelection(mSegs, null).reason === 'empty', 'mapSelection: null selection → empty')
    assert(mapSelection(mSegs, { start: null, end: { seg: 0, offset: 1 } }).ok === false, 'mapSelection: missing boundary rejected')

    // ══════════════════ P2-d: nodeOffsetToSeg / selectionToNorm (DOM-ish model) ══════════════════
    const makeEl = (attrs, parent) => ({ nodeType: 1, getAttribute: (n) => (n in attrs ? attrs[n] : null), parentElement: parent || null, childNodes: [] })
    const makeText = (parent) => ({ nodeType: 3, parentElement: parent })
    const segEl0 = makeEl({ 'data-phl-seg': '0', 'data-phl-anchor': 'a-1' })
    const segEl1 = makeEl({ 'data-phl-seg': '1', 'data-phl-anchor': 'a-1' })
    const segEl2 = makeEl({ 'data-phl-seg': '2', 'data-phl-anchor': 'a-1' })
    const blockEl = makeEl({ 'data-phl-anchor': 'a-1' })
    blockEl.childNodes = [segEl0, segEl1, segEl2]
    segEl0.parentElement = blockEl
    segEl1.parentElement = blockEl
    segEl2.parentElement = blockEl

    const n0 = nodeOffsetToSeg(makeText(segEl0), 2, mSegs)
    assert(n0 && n0.seg === 0 && n0.offset === 2, 'nodeOffsetToSeg: text node inside seg el → seg 0 offset 2')
    const n1 = nodeOffsetToSeg(makeText(segEl2), 5, mSegs)
    assert(n1 && n1.seg === 2 && n1.offset === 5, 'nodeOffsetToSeg: text node inside trailing seg → seg 2 offset 5')
    const e0 = nodeOffsetToSeg(segEl0, 0, mSegs)
    assert(e0 && e0.seg === 0 && e0.offset === 0, 'nodeOffsetToSeg: seg el boundary 0 → offset 0')
    const e1 = nodeOffsetToSeg(segEl0, 1, mSegs)
    assert(e1 && e1.seg === 0 && e1.offset === 6, 'nodeOffsetToSeg: seg el boundary 1 → full plain length')
    const b0 = nodeOffsetToSeg(blockEl, 0, mSegs)
    assert(b0 && b0.seg === 0 && b0.offset === 0, 'nodeOffsetToSeg: block boundary 0 → first seg offset 0')
    const b1 = nodeOffsetToSeg(blockEl, 1, mSegs)
    assert(b1 && b1.seg === 1 && b1.offset === 0, 'nodeOffsetToSeg: block boundary 1 → second seg offset 0')
    const b2 = nodeOffsetToSeg(blockEl, 2, mSegs)
    assert(b2 && b2.seg === 2 && b2.offset === 0, 'nodeOffsetToSeg: block boundary 2 → third seg offset 0')
    const b3 = nodeOffsetToSeg(blockEl, 3, mSegs)
    assert(b3 && b3.seg === 2 && b3.offset === 17, 'nodeOffsetToSeg: block boundary at end → trailing seg full length')
    assert(nodeOffsetToSeg({ nodeType: 3, parentElement: makeEl({}) }, 1, mSegs) === null, 'nodeOffsetToSeg: node without seg ancestry → null')
    assert(nodeOffsetToSeg(null, 0, mSegs) === null, 'nodeOffsetToSeg: null node → null')

    const selOK = {
      isCollapsed: false,
      anchorNode: makeText(segEl0), anchorOffset: 1,
      focusNode: makeText(segEl2), focusOffset: 5,
    }
    const normSel = selectionToNorm(selOK, mSegs)
    assert(normSel && normSel.start.seg === 0 && normSel.start.offset === 1 && normSel.end.seg === 2 && normSel.end.offset === 5, 'selectionToNorm: resolves both boundaries into normalized form')
    assert(selectionToNorm({ isCollapsed: true }, mSegs) === null, 'selectionToNorm: collapsed selection → null')
    const selUnresolvable = { isCollapsed: false, anchorNode: { nodeType: 3, parentElement: makeEl({}) }, anchorOffset: 0, focusNode: { nodeType: 3, parentElement: makeEl({}) }, focusOffset: 1 }
    assert(selectionToNorm(selUnresolvable, mSegs) && selectionToNorm(selUnresolvable, mSegs).ok === false, 'selectionToNorm: unresolvable selection → ok:false (silent no-seg)')
    assert(selectionToNorm(null, mSegs) === null, 'selectionToNorm: null selection → null')

    // ══════════════════ P2-d: renderText withSegments ══════════════════
    const segOut = renderText('Hello world!', [
      { id: 's-1', anchor: 'a-1', char_start: 6, char_end: 11, color: 'blue', status: 'proposed' },
    ], { withSegments: true, segBase: 0, anchorId: 'a-1' })
    assert(segOut.length === 3, 'renderText withSegments: 3 nodes (span/mark/span)')
    assert(segOut[0].type === 'span' && segOut[0].props['data-phl-seg'] === '0' && segOut[0].props['data-phl-anchor'] === 'a-1' && segOut[0].children.join('') === 'Hello ', 'renderText withSegments: plain span carries seg 0 + anchor')
    assert(segOut[1].type === 'mark' && segOut[1].props['data-phl-seg'] === '1' && segOut[1].props['data-phl-anchor'] === 'a-1' && segOut[1].props.key === 's-1', 'renderText withSegments: mark carries seg 1 + anchor + span id')
    assert(segOut[2].type === 'span' && segOut[2].props['data-phl-seg'] === '2', 'renderText withSegments: trailing plain span seg 2')
    const bare = renderText('Hello world!', [{ id: 's-1', char_start: 6, char_end: 11, color: 'blue', status: 'proposed' }])
    assert(typeof bare[0] === 'string' && bare[1].type === 'mark' && typeof bare[2] === 'string', 'renderText without withSegments keeps bare strings (backward compat)')
    const onlySeg = renderText('abc', [], { withSegments: true, segBase: 5, anchorId: 'a-9' })
    assert(onlySeg.length === 1 && onlySeg[0].props['data-phl-seg'] === '5' && onlySeg[0].props['data-phl-anchor'] === 'a-9', 'renderText withSegments + no spans → single span with segBase/anchor')

    // ══════════════════ P2-d: reconcileSpan clientId match for add ══════════════════
    const overlayAdd = [
      { id: 's-001', anchor: 'a-1', char_start: 0, char_end: 5, color: 'red', status: 'accepted', decisions: [] },
      { id: 'local-add-123', anchor: 'a-2', char_start: 2, char_end: 8, color: 'green', status: 'user_added', decisions: [], _local: true },
    ]
    const serverAdded = { id: 's-004', anchor: 'a-2', char_start: 2, char_end: 8, color: 'green', status: 'user_added', decisions: [{ action: 'added', by: 'user', at: 't' }] }
    const recAdd = reconcileSpan(overlayAdd, serverAdded, { action: 'add', clientId: 'local-add-123' })
    assert(recAdd.length === 2 && recAdd[1].id === 's-004' && recAdd[1]._local === undefined, 'reconcileSpan: add matched by clientId and replaced with server span')
    assert(overlayAdd[1].id === 'local-add-123', 'reconcileSpan: input overlay not mutated')
    const recAddNoPayload = reconcileSpan(overlayAdd, serverAdded)
    assert(recAddNoPayload[1].id === 'local-add-123', 'reconcileSpan: without payload no clientId match (backward compat)')

    // ══════════════════ P2-e: sectionList ══════════════════
    const secSections = [
      { id: 's1', title: 'Title', kind: 'paper_title', anchor_id: 'a-1' },
      { id: 's2', title: 'Abstract', kind: 'section', anchor_id: 'a-2', plan: { id: 's2', status: 'reviewed', reviewed_at: '2026-08-26T00:00:00.000Z' } },
      { id: 's3', title: 'Intro', kind: 'section', anchor_id: 'a-3' },
      { id: 's22', title: 'References', kind: 'section', anchor_id: 'a-22', empty: true },
    ]
    const list = sectionList(secSections, null, null)
    assert(list.length === 2, 'sectionList: skips paper_title + empty (References)')
    assert(list[0].id === 's2' && list[0].reviewed === true && list[0].reviewed_at === '2026-08-26T00:00:00.000Z', 'sectionList: plan status merged (reviewed)')
    assert(list[1].id === 's3' && list[1].reviewed === false && list[1].reviewed_at === null, 'sectionList: un-reviewed section defaults to pending')
    const overridden = sectionList(secSections, null, { s3: { status: 'reviewed', reviewed_at: 't1' } })
    assert(overridden[1].reviewed === true && overridden[1].reviewed_at === 't1', 'sectionList: optimistic override status wins over pending')
    // plan param fallback when s.plan absent (pre-merge /read shape)
    const planFallback = sectionList([{ id: 's3', title: 'Intro', kind: 'section', anchor_id: 'a-3' }], { sections: [{ id: 's3', status: 'reviewed' }] }, null)
    assert(planFallback[0].reviewed === true, 'sectionList: falls back to plan.sections lookup by id')
    assert(sectionList(null, null, null).length === 0 && sectionList([], null, null).length === 0, 'sectionList: null/empty input → empty list')

    // ══════════════════ P2-e: currentSectionId ══════════════════
    const curSections = [
      { id: 's1', title: 'T', kind: 'paper_title', anchor_id: 'a-t' },
      { id: 's2', title: 'A', kind: 'section', anchor_id: 'a-2' },
      { id: 's3', title: 'B', kind: 'section', anchor_id: 'a-3' },
      { id: 's4', title: 'C', kind: 'section', anchor_id: 'a-4' },
    ]
    const curTops = [
      { anchorId: 'a-t', top: 0 },
      { anchorId: 'a-2', top: 100 },
      { anchorId: 'a-3', top: 400 },
      { anchorId: 'a-4', top: 900 },
    ]
    assert(currentSectionId(curSections, curTops, 0, 600) === 's2', 'currentSectionId: mid-viewport (300) → last section top<=300 is s2 (paper_title excluded)')
    assert(currentSectionId(curSections, curTops, 800, 600) === 's4', 'currentSectionId: scrolled deep (mid 1100) → s4')
    assert(currentSectionId(curSections, curTops, 0, 50) === null, 'currentSectionId: no section heading above mid at the very top → null')
    const partial = curTops.filter((t) => t.anchorId !== 'a-3')
    assert(currentSectionId(curSections, partial, 0, 600) === 's2', 'currentSectionId: section without a blockTop is skipped')
    const withEmpty = curSections.concat([{ id: 's22', title: 'Refs', kind: 'section', anchor_id: 'a-22', empty: true }])
    const tops2 = curTops.concat([{ anchorId: 'a-22', top: 2000 }])
    assert(currentSectionId(withEmpty, tops2, 2000, 600) === 's4', 'currentSectionId: empty section never current')
    assert(currentSectionId(null, curTops, 0, 600) === null && currentSectionId([], curTops, 0, 600) === null, 'currentSectionId: null/empty input → null')

    console.log(JSON.stringify({
      step: 'render-helpers',
      result: 'PASS',
      phase0: 'empty References heading skipped, paper title kept, ghost spans dropped',
      clamp: 'out-of-range / negative / overflowing ranges clamp instead of throwing',
      p2a: 'buildWriteUrl/encodeWriteBody/callWrite — URL+body builders and data function over injected transport (ok / ok:false / throw / no-transport)',
      p2b: 'excludeRejected + spanActiveStyle + localApplySpans matrix — accept/reject/recolor/rescope/note/add, immutability, no-op tolerance',
      p2c: 'markStyle (color chip + status + selected outline) + renderText(opts) onClick/active + reconcileSpan (server-confirmed merge, immutability)',
      p2d: 'buildBlockSegments/buildSegmentMap (flat segment map) + mapSelection matrix (same/cross-segment, reverse, out-of-range, empty, cross-anchor) + nodeOffsetToSeg/selectionToNorm DOM-ish resolution + renderText(withSegments) data-phl-seg wrapping + reconcileSpan clientId match',
      p2e: 'sectionList (reviewable filter + plan/override status merge) + currentSectionId (viewport-middle rule, paper_title/empty excluded, missing blockTop skipped)',
      v03p1: 'callProfile (GET/POST/ok:false/no-transport) + colorLegend (null/custom/partial/empty/unknown fallbacks) + markStyle(colors 4th arg) + renderText(opts.colors) — colors.yml-driven palette',
      v03p3: 'profilePanelModel/profilePanelColors (null fallback + profile mapping) + profileSavePayload (flat rows → {name:{color,label}} map, absent layers omitted)',
      v03p2: 'proposalCardModel (pending entry → card with rule-<i>/exemplar-<i> ids + stats one-liner) + buildApplyDecisions (accept/reject/mixed/empty payloads)',
    }, null, 2))
    return null
  })
}

main().catch((err) => {
  console.error('RENDER HELPERS TEST FAILED:', err && err.message ? err.message : err)
  process.exit(1)
})
