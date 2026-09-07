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
  callProfile, callFormat, callProposeRequest, colorLegend,
  excludeRejected, localApplySpans, spanActiveStyle,
  markStyle, reconcileSpan,
  buildBlockSegments, buildSegmentMap, mapSelection,
  nodeOffsetToSeg, blockChildToSeg, selectionToNorm,
  sectionList, currentSectionId,
  keyAction, reviewProgress, buildExportUrl,
  profilePanelModel, profilePanelColors, profileSavePayload,
  proposalCardModel, buildApplyDecisions,
  localApproveSectionSpans, localRevertSectionSpans,
  repairMath, splitMathPieces, mathConvert, katexRender, segLen, buildTextPieces,
  BODY,
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
    }).then(() => {
      // ══════════════════ v0.5: callFormat (format transport) ══════════════════
      const fmtCalls = []
      const okFormatTransport = async (body) => { fmtCalls.push(body); return { ok: true, scope: 'all', spans_cleared: 5 } }
      return callFormat({ confirm: true, scope: 'all' }, okFormatTransport).then((res) => {
        assert(res && res.ok === true && res.scope === 'all' && res.spans_cleared === 5, 'callFormat resolves the ok transport response')
        assert(fmtCalls.length === 1, 'callFormat sends exactly one POST body')
        const sent = JSON.parse(fmtCalls[0])
        assert(sent.confirm === true && sent.scope === 'all', 'callFormat sends {confirm:true, scope} JSON body')
      }).then(() => {
        return callFormat({ confirm: true }, async () => ({ ok: false, error: 'format requires confirm' })).then(
          () => { throw new Error('callFormat should reject on ok:false') },
          (err) => assert(/format requires confirm/.test(err.message), 'callFormat rejects an ok:false payload with its error'),
        )
      }).then(() => {
        return callFormat({ confirm: true }).then(
          () => { throw new Error('callFormat without transport should reject') },
          (err) => assert(/format transport not available/.test(err.message), 'callFormat without transport rejects cleanly'),
        )
      }).then(() => {
        // ══════════════════ v0.5.4: callProposeRequest (重新提出高亮 transport) ══════════════════
        const prcalls = []
        const okProposeTransport = async (url, body) => { prcalls.push({ url, body }); return { ok: true, paper_id: 'p-x', requested_at: 't', status: 'pending' } }
        return callProposeRequest('p-x', okProposeTransport).then((res) => {
          assert(res && res.ok === true && res.status === 'pending' && res.paper_id === 'p-x', 'callProposeRequest resolves the ok transport response')
          assert(prcalls.length === 1 && prcalls[0].url === '/paper-hl/propose-request?paperId=p-x', 'callProposeRequest targets /paper-hl/propose-request?paperId=…')
          assert(JSON.parse(prcalls[0].body).paper_id === 'p-x', 'callProposeRequest sends {paper_id} JSON body')
        }).then(() => {
          return callProposeRequest('p-x', async () => ({ ok: false, error: 'no papers' })).then(
            () => { throw new Error('callProposeRequest should reject on ok:false') },
            (err) => assert(/no papers/.test(err.message), 'callProposeRequest rejects an ok:false payload with its error'),
          )
        }).then(() => {
          return callProposeRequest('p-x').then(
            () => { throw new Error('callProposeRequest without transport should reject') },
            (err) => assert(/propose-request transport not available/.test(err.message), 'callProposeRequest without transport rejects cleanly'),
          )
        })
      })
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

    // ══════════════════ v0.4 Phase 4: keyAction ══════════════════
    const ev = (key, extra) => Object.assign({ key, target: { tagName: 'BODY' }, ctrlKey: false, metaKey: false, altKey: false }, extra || {})
    const paperState = {
      panelView: 'paper', menuOpen: true, activeSpanId: 's-001',
      addDraft: null, rescueTarget: null, currentSection: 's3',
      sectionItems: [{ id: 's2' }, { id: 's3' }, { id: 's4' }],
    }
    const palette5 = ['yellow', 'red', 'blue', 'green', 'purple']
    assert(keyAction(ev('a'), paperState, { palette: palette5 }).type === 'accept'
      && keyAction(ev('a'), paperState, { palette: palette5 }).span_id === 's-001', 'keyAction: a → accept active span')
    assert(keyAction(ev('d'), paperState, { palette: palette5 }).type === 'reject', 'keyAction: d → reject')
    assert(keyAction(ev('r'), paperState, { palette: palette5 }).type === 'rescope', 'keyAction: r → rescope mode')
    assert(keyAction(ev('3'), paperState, { palette: palette5 }).type === 'recolor'
      && keyAction(ev('3'), paperState, { palette: palette5 }).color === 'blue', 'keyAction: 3 → recolor to palette[2]=blue')
    assert(keyAction(ev('e'), paperState, { palette: palette5 }).type === 'toggleExport', 'keyAction: e → toggle export dialog')
    assert(keyAction(ev('Escape'), paperState, { palette: palette5 }).type === 'cancel', 'keyAction: Escape → cancel')
    // v0.5.4.3: 「标记本节审查完毕」按钮 + Ctrl+Enter 快捷键已下线（由章节标签
    // 点击一键审批取代）—— 修饰键组合一律忽略，Ctrl+Enter 不再是 action
    const ctrlEnter = ev('Enter', { ctrlKey: true })
    assert(keyAction(ctrlEnter, paperState, { palette: palette5 }) === null, 'keyAction: Ctrl+Enter ignored (review-shortcut removed)')
    // no active span (menu closed) → a/d/r/1-5 no-op
    const noSpan = Object.assign({}, paperState, { menuOpen: false })
    assert(keyAction(ev('a'), noSpan, { palette: palette5 }) === null, 'keyAction: no active span → a ignored')
    assert(keyAction(ev('1'), noSpan, { palette: palette5 }) === null, 'keyAction: no active span → 1 ignored')
    // palette index out of range / non-paper view / input focus / modifier
    assert(keyAction(ev('5'), paperState, { palette: ['yellow', 'red'] }) === null, 'keyAction: digit beyond palette length ignored')
    const profView = Object.assign({}, paperState, { panelView: 'profile' })
    assert(keyAction(ev('a'), profView, { palette: palette5 }) === null, 'keyAction: profile panel view → ignored')
    const inputEv = ev('a', { target: { tagName: 'INPUT' } })
    assert(keyAction(inputEv, paperState, { palette: palette5 }) === null, 'keyAction: input focus → ignored')
    const altEv = ev('a', { altKey: true })
    assert(keyAction(altEv, paperState, { palette: palette5 }) === null, 'keyAction: alt-modified → ignored')
    assert(keyAction(null, paperState, { palette: palette5 }) === null, 'keyAction: null event → null')

    // ══════════════════ v0.4 Phase 4: reviewProgress ══════════════════
    const progItems = [
      { id: 's2', reviewed: true }, { id: 's3', reviewed: false }, { id: 's4', reviewed: true }, { id: 's5', reviewed: false },
    ]
    const p1 = reviewProgress(progItems)
    assert(p1.total === 4 && p1.done === 2 && p1.ratio === 50 && p1.nextId === 's3', 'reviewProgress: partial reviewed → score + first unreviewed')
    const p2 = reviewProgress([{ id: 's2', reviewed: true }, { id: 's3', reviewed: true }])
    assert(p2.done === 2 && p2.ratio === 100 && p2.nextId === null, 'reviewProgress: all reviewed → ratio 100, no next')
    const p3 = reviewProgress([{ id: 's2', status: 'reviewed' }, { id: 's3', status: 'pending', skip: true }, { id: 's4', status: 'pending' }])
    assert(p3.total === 2 && p3.done === 1 && p3.nextId === 's4', 'reviewProgress: plan.sections entries honored + skip excluded from total/next')
    assert(reviewProgress(null).total === 0 && reviewProgress(null).done === 0 && reviewProgress(null).ratio === 0 && reviewProgress(null).nextId === null, 'reviewProgress: null/empty → all-zero fallback')
    assert(reviewProgress([]).ratio === 0 && reviewProgress([]).nextId === null, 'reviewProgress: empty list → zero')

    // ══════════════════ v0.4 Phase 4: buildExportUrl ══════════════════
    assert(buildExportUrl('p-1', 'html', true, true) === '/paper-hl/export?paperId=p-1&format=html&include_pending=1&download=1', 'buildExportUrl: full params')
    assert(buildExportUrl('p-1', 'md', false, true) === '/paper-hl/export?paperId=p-1&format=md&download=1', 'buildExportUrl: md + download, no include_pending')
    assert(buildExportUrl('p-1', '', false, false) === '/paper-hl/export?paperId=p-1', 'buildExportUrl: minimal (paperId only)')
    assert(buildExportUrl('p x/y', 'html', true, true).indexOf('p%20x%2Fy') >= 0, 'buildExportUrl: paperId encoded')
    // regression guard: every pure helper referenced by the embedded
    // functions must be embedded into BODY (a missing toString() embed would
    // only surface at runtime as a ReferenceError → blank page).
    const EMBED_HELPERS = ['clampRange', 'sortAnchorIds', 'buildBlocks', 'renderText', 'buildWriteUrl', 'encodeWriteBody', 'callWrite', 'callProfile', 'callFormat', 'callProposeRequest', 'colorLegend', 'buildBlockSegments', 'buildSegmentMap', 'mapSelection', 'nodeOffsetToSeg', 'blockChildToSeg', 'selectionToNorm', 'sectionList', 'currentSectionId', 'keyAction', 'reviewProgress', 'buildExportUrl', 'profilePanelModel', 'profilePanelColors', 'profileSavePayload', 'proposalCardModel', 'buildApplyDecisions', 'localApproveSectionSpans', 'localRevertSectionSpans', 'repairMath', 'splitMathPieces', 'mathConvert', 'katexRender', 'segLen', 'buildTextPieces']
    for (const name of EMBED_HELPERS) {
      assert(typeof BODY === 'string' && BODY.includes('function ' + name), 'bundle embed completeness: function ' + name + ' embedded into BODY')
    }

    // ══════════════════ v0.5.1: section TOC batch approve ══════════════════
    const apSpans = [
      { id: 's-001', anchor: 'a-x', status: 'proposed' },
      { id: 's-002', anchor: 'a-y', status: 'proposed' },
      { id: 's-003', anchor: 'a-x', status: 'accepted' },
      { id: 's-004', anchor: 'a-x', status: 'user_added' },
      { id: 's-005', anchor: 'a-x', status: 'rejected' },
      { id: 's-006', anchor: 'a-z', status: 'proposed' },
    ]
    const apApproved = localApproveSectionSpans(apSpans, ['a-x', 'a-y'])
    const apStatus = (arr, id) => arr.find((s) => s.id === id).status
    assert(apStatus(apApproved, 's-001') === 'accepted' && apStatus(apApproved, 's-002') === 'accepted', 'approve: proposed spans in section anchors → accepted')
    assert(apStatus(apApproved, 's-003') === 'accepted' && apStatus(apApproved, 's-004') === 'user_added' && apStatus(apApproved, 's-005') === 'rejected', 'approve: accepted/user_added/rejected untouched')
    assert(apStatus(apApproved, 's-006') === 'proposed', 'approve: proposed span outside section untouched')
    assert(apApproved[2] === apSpans[2] && apApproved[0] !== apSpans[0], 'approve: already-accepted keeps identity, newly-accepted gets a copy')
    const apEmpty = localApproveSectionSpans(apSpans, [])
    assert(apEmpty.every((s) => s.status === apSpans.find((x) => x.id === s.id).status), 'approve: empty anchor set → no change')
    assert(localApproveSectionSpans(null, ['a-x']).length === 0, 'approve: null spans → empty array')

    // ══════════════════ v0.5.3: section TOC 反选 (batch revert to 待审) ══════════════════
    // localRevertSectionSpans is the inverse of approve: ACCEPTED spans in the
    // section anchors → proposed (待审); proposed / user_added / rejected spans
    // and outside anchors untouched; identity preserved for untouched spans;
    // empty set / null safe. The user asked explicitly that 反选 = 批量设置为
    // 待审状态 (undo the one-click approve) — NOT batch reject.
    const rvReverted = localRevertSectionSpans(apSpans, ['a-x', 'a-y'])
    const rvStatus = (arr, id) => arr.find((s) => s.id === id).status
    assert(rvStatus(rvReverted, 's-003') === 'proposed', 'revert: accepted span in section anchors → proposed (待审)')
    assert(rvStatus(rvReverted, 's-001') === 'proposed' && rvStatus(rvReverted, 's-002') === 'proposed', 'revert: proposed spans stay proposed (untouched)')
    assert(rvStatus(rvReverted, 's-004') === 'user_added' && rvStatus(rvReverted, 's-005') === 'rejected', 'revert: user_added/rejected untouched')
    assert(rvStatus(rvReverted, 's-006') === 'proposed', 'revert: span outside section untouched')
    assert(rvReverted[0] === apSpans[0] && rvReverted[2] !== apSpans[2], 'revert: untouched spans keep identity, reverted gets a copy')
    assert(localRevertSectionSpans(apSpans, []).every((s) => s.status === apSpans.find((x) => x.id === s.id).status), 'revert: empty anchor set → no change')
    assert(localRevertSectionSpans(null, ['a-x']).length === 0, 'revert: null spans → empty array')

    // ══════════════════ v0.6.1: math rendering pipeline ══════════════════
    // ── repairMath: A1 brace-spacing, A2 \cmd {, A3/A3b script spacing, A4
    // spaced words, A5 OCR dots, A7 digit runs, A6 ~ / \: — conservative, and
    // never touches what it cannot confidently repair.
    assert(repairMath('\\mathbf { y } \\mid \\textbf { x }') === '\\mathbf{y} \\mid \\textbf{x}', 'repair A1+A2: brace + cmd spacing collapsed')
    assert(repairMath('x _ { 1 } , y ^ { 2 }') === 'x_{1} , y^{2}', 'repair A3+A3b: script spacing collapsed (x_ {1} → x_{1})')
    assert(repairMath('l o g _ { 2 } ( V ) .') === 'log_{2} ( V ) .', 'repair A4: spaced word log rebuilt, script tightened')
    assert(repairMath('i . e . , \\ a r g \\ m a x') === 'i.e., \\ arg \\ max', 'repair A4+A5: i.e., + arg/max rebuilt')
    assert(repairMath('N \\times D \\times H') === 'N \\times D \\times H', 'repair: clean LaTeX untouched')
    assert(repairMath('2 0 1 1') === '2011', 'repair A7: spaced digit run collapsed')
    assert(repairMath('s = \\| g \\| _ { 2 } ,') === 's = \\| g \\|_{2} ,', 'repair: norm + script tightened')
    assert(repairMath('4 \\cdot 5') === '4 \\cdot 5', 'repair guard: decimal/\\cdot NOT collapsed')

    // ── splitMathPieces: math runs found, prose left alone, full coverage ──
    const sp1 = splitMathPieces('is computed by \\alpha _ { i j } of each annotation h _ { j }')
    assert(sp1.length === 4, 'splitMathPieces: plain/math/plain/math = 4 pieces (math run reaches end)')
    assert(sp1[0].isMath === false && sp1[0].start === 0 && sp1[0].end === 15, 'splitMathPieces: leading prose [0,15) "is computed by "')
    assert(sp1[1].isMath === true && sp1[1].start === 15 && sp1[1].end === 31 && sp1[1].end - sp1[1].start === 16, 'splitMathPieces: math run \\alpha _ { i j } [15,31)')
    assert(sp1[2].isMath === false && sp1[2].start === 31 && sp1[2].end === 51, 'splitMathPieces: prose gap (of each annotation)')
    assert(sp1[3].isMath === true && sp1[3].start === 51 && sp1[3].end === 60, 'splitMathPieces: math run h _ { j } reaches text end')
    const sp2 = splitMathPieces('This is plain prose with no math at all.')
    assert(sp2.length === 1 && sp2[0].isMath === false && sp2[0].end === sp2[0].start + 40, 'splitMathPieces: pure prose → single plain piece')
    const sp3 = splitMathPieces('')
    assert(sp3.length === 1 && sp3[0].end === 0, 'splitMathPieces: empty text → one empty piece')
    const sp4 = splitMathPieces('1 { - } 0 \\mathbf { f } { - } V coding')
    assert(sp4[0].isMath === true && sp4[0].start === 0 && sp4[0].end === 31 && sp4[0].end - sp4[0].start === 31, 'splitMathPieces: OCR braces + bold command one run, stops before "coding"')
    assert(sp4.length === 2, 'splitMathPieces: "coding" stays prose (word boundary)')

    // ── mathConvert: Unicode/CSS display, no data loss ──
    assert(mathConvert('\\mathbf { x } \\mid \\textbf { x }').text === '𝐱 | 𝐱', 'mathConvert: bold + mid')
    assert(mathConvert('\\mathbb { R } ^ { n }').text === 'ℝⁿ', 'mathConvert: double-struck R + superscript n')
    assert(mathConvert('\\alpha _ { i j }').text === 'αᵢⱼ', 'mathConvert: greek + multi-letter subscript')
    assert(mathConvert('x _ { 1 } , \\cdot \\cdot \\cdot , x _ { T _ { x } }').text === 'x₁ , · · · , xTₓ', 'mathConvert: subscripts + dots + nested')
    assert(mathConvert('h _ { t } \\in \\mathbb { R } ^ { n }').text === 'hₜ ∈ ℝⁿ', 'mathConvert: script + ∈ + ℝⁿ')
    assert(mathConvert('\\bar { U } \\acute { n }').text === 'U\u0304 n\u0301', 'mathConvert: combining accents (U+macron, n+acute)')
    assert(mathConvert('\\overrightarrow { h } _ { j }').text === 'h⃗ⱼ', 'mathConvert: overrightarrow + script')
    assert(mathConvert('\\vec { \\boldsymbol { f } }').text === '𝐟⃗', 'mathConvert: vec over bold surrogate-safe')
    assert(mathConvert('\\frac { a } { b }').text === 'a⁄b', 'mathConvert: fraction')
    assert(mathConvert('l o g _ { 2 } ( V )').text === 'log₂ ( V )', 'mathConvert: repaired log + subscript')
    assert(mathConvert('\\left( y _ { 1 } , \\right)').text === '( y₁ , )', 'mathConvert: left/right dropped')
    assert(mathConvert('\\begin { array } { r } { g } \\end { array }').text.indexOf('\\begin') === -1, 'mathConvert: begin/end env markers dropped')
    assert(mathConvert('\\smash { \\vec { U } _ { r } }').text === ' U⃗ᵣ ', 'mathConvert: smash renders its content (no info loss)')
    assert(mathConvert('\\alpha , \\beta , \\gamma').text === 'α , β , γ', 'mathConvert: greek list')
    assert(mathConvert('\\breve { n }').text === 'n̆', 'mathConvert: breve accent')
    assert(mathConvert('s = \\| g \\| _ { 2 }').text === 's = ‖ g ‖₂', 'mathConvert: norm ‖·‖')
    assert(mathConvert('\\foo { bar }').text === '\\foo{bar}', 'mathConvert: unknown command + arg preserved with braces (never dropped)')
    assert(mathConvert('\\mathfrak { e } ^ { } c').text === 'e c', 'mathConvert: empty script contributes nothing')
    const mc = mathConvert('\\mathbf { y } = \\left( y _ { 1 } , \\cdot \\cdot \\cdot , y _ { T } \\right) .')
    assert(mc.text.length === mc.text.length && mc.html.length > 0, 'mathConvert: returns html + text')
    assert(mathConvert('0 . 0 0 1 ^ { 2 }').text === '0.001²', 'mathConvert: repaired decimal + superscript')

    // ── segLen: plain = length, math = dlen ──
    assert(segLen({ start: 3, end: 8 }) === 5, 'segLen: plain segment uses start..end')
    assert(segLen({ start: 3, end: 40, math: true, dlen: 7 }) === 7, 'segLen: math segment uses dlen')
    assert(segLen(null) === 0, 'segLen: null → 0')

    // ── buildTextPieces / buildBlockSegments: math segments carry dlen ──
    const mtText = 'H \\times V is size'
    const mtPieces = buildTextPieces(mtText, [])
    assert(mtPieces.length === 2 && mtPieces[0].math === true && mtPieces[1].math === false, 'buildTextPieces: math run + plain tail')
    const mtSegs = buildBlockSegments('a-m', mtText, [])
    assert(mtSegs.length === 2, 'buildBlockSegments: math + plain segments')
    assert(mtSegs[0].math === true && mtSegs[0].dlen === mathConvert('H \\times V').text.length && mtSegs[0].dlen === 5, 'buildBlockSegments: math segment dlen = display length (H × V = 5)')
    assert(mtSegs[1].math === undefined && mtSegs[1].dlen === undefined && mtSegs[1].end - mtSegs[1].start === 8, 'buildBlockSegments: plain segment has no dlen')

    // ── mapSelection: math segment maps to its WHOLE original range ──
    const msSegments = buildBlockSegments('a-m', mtText, [])
    const mid = mapSelection(msSegments, { start: { seg: 0, offset: 2 }, end: { seg: 0, offset: 4 } })
    assert(mid.ok === true && mid.anchor === 'a-m' && mid.char_start === 0 && mid.char_end === 10, 'mapSelection: selection inside a math segment clamps to the whole original range [0,10)')
    const crossSel = mapSelection(msSegments, { start: { seg: 0, offset: 9 }, end: { seg: 1, offset: 3 } })
    assert(crossSel.ok === true && crossSel.char_start === 0 && crossSel.char_end === 13, 'mapSelection: math→plain cross selection: math whole + plain linear')
    const plainSel = mapSelection(msSegments, { start: { seg: 1, offset: 1 }, end: { seg: 1, offset: 5 } })
    assert(plainSel.ok === true && plainSel.char_start === 11 && plainSel.char_end === 15, 'mapSelection: plain segment stays linear')

    // ── renderText: math node emits .phl-math + data-phl-dlen (G2: never empty) ──
    const rtOut = renderText('H \\times V is size', [], { withSegments: true, segBase: 3, anchorId: 'a-r' })
    assert(rtOut.length === 2, 'renderText: math + plain nodes with segments')
    assert(rtOut[0].props.className === 'phl-math' && rtOut[0].props['data-phl-seg'] === '3' && rtOut[0].props['data-phl-dlen'] === '5', 'renderText: math node carries class + seg + dlen')
    assert(rtOut[0].props.dangerouslySetInnerHTML && typeof rtOut[0].props.dangerouslySetInnerHTML.__html === 'string' && rtOut[0].props.dangerouslySetInnerHTML.__html.indexOf('×') >= 0, 'renderText: math node innerHTML contains converted symbol')
    assert(rtOut[1].props['data-phl-seg'] === '4' && rtOut[1].children.join('') === ' is size', 'renderText: plain node follows with next seg')
    // G2 guard: a math piece whose display folds to empty never emits a grey box
    const g2Out = renderText('\\mathrm { }', [], {})
    assert(g2Out.length === 1 && typeof g2Out[0] === 'string' && g2Out[0].indexOf('phl-math') === -1, 'G2: empty-display math folds to plain text (no grey box)')
    // G3: non-math text renders byte-identical (single plain node)
    const g3Out = renderText('Plain prose stays plain.', [], { withSegments: true, segBase: 0, anchorId: 'a-3' })
    assert(g3Out.length === 1 && g3Out[0].children.join('') === 'Plain prose stays plain.', 'G3: non-math layout byte-identical to pre-v0.6.1')
    // math inside a highlight mark: mark wraps the math span
    const rtMark = renderText('H \\times V', [{ id: 's-m1', char_start: 0, char_end: 10, color: 'red', status: 'accepted' }], {})
    assert(rtMark.length === 1 && rtMark[0].type === 'mark' && rtMark[0].children[0].props.className === 'phl-math', 'renderText: math inside a mark wraps the math span')

    // ══════════════════ v0.6.1+ · KaTeX render branch ══════════════════
    // katexRender prefers the real KaTeX engine when a global `katex` exists
    // (the shipped bundles inline it); Node module tests lack it by default, so
    // we inject/remove the global around these assertions to exercise BOTH
    // branches. KaTeX renders with its own math fonts → no tofu boxes.
    let katexMod = null
    try { katexMod = require('katex') } catch (e) { /* katex not installed → skip KaTeX-branch asserts */ }
    if (katexMod) {
      const hadKatex = typeof global.katex !== 'undefined'
      const saved = global.katex
      global.katex = katexMod
      try {
        const k1 = katexRender('\\alpha _ { i j }')
        assert(k1.engine === 'katex' && k1.html.indexOf('katex') >= 0 && k1.html.indexOf('katex-error') === -1, 'KaTeX branch: clean input renders without error markers')
        const k2 = katexRender('\\begin { array } { r c l } { h _ { t } } & = & \\mathrm { s i g m } \\left( x \\right) \\end { array }')
        assert(k2.engine === 'katex' && k2.html.indexOf('katex') >= 0 && k2.html.indexOf('katex-error') === -1, 'KaTeX branch: OCR-spaced \\begin{array} renders after repairMath (no error)')
        const k3 = katexRender('\\vec { \\boldsymbol { f } }')
        assert(k3.engine === 'katex' && k3.html.indexOf('katex') >= 0, 'KaTeX branch: vec-over-bold renders')
        const k4 = katexRender('\\foo { bar }')
        assert(k4.engine === 'katex' && typeof k4.html === 'string', 'KaTeX branch: unknown command does not throw (throwOnError:false)')
        const k5 = katexRender('2 0 1 1')
        assert(k5.engine === 'katex' && k5.text === '2011', 'KaTeX branch: repaired digits feed KaTeX, dlen stays approximate text')
        const kMark = renderText('H \\times V', [], {})
        assert(kMark.length === 1 && kMark[0].props && kMark[0].props.className === 'phl-math' && kMark[0].props.dangerouslySetInnerHTML.__html.indexOf('katex') >= 0, 'renderText: math node emits KaTeX HTML when katex global present')
      } finally {
        if (hadKatex) global.katex = saved
        else delete global.katex
      }
      // fallback branch: no global katex → approximate Unicode/CSS (Node default)
      const f1 = katexRender('\\mathbb { R } ^ { n }')
      assert(f1.engine === 'approx' && f1.text === 'ℝⁿ', 'katexRender fallback: no katex global → approximate engine')
    } else {
      const f1 = katexRender('\\mathbb { R } ^ { n }')
      assert(f1.engine === 'approx' && f1.text === 'ℝⁿ', 'katexRender fallback: katex not installed → approximate engine')
    }

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
      v04p4: 'keyAction matrix (a/d/r/1-5/e/Escape; modifiers ignored incl. Ctrl+Enter — review-shortcut removed; no-span / out-of-range / non-paper view / input focus / modifier / null ignored) + reviewProgress (partial/all/none, plan+skip honored, zero fallback) + buildExportUrl (params + encoding)',
      v05: 'callFormat — POST {confirm:true, scope} body to /paper-hl/format; ok resolve / ok:false reject / no-transport reject (one-click format transport)',
      v051b: 'section TOC batch approve — localApproveSectionSpans (proposed-in-section → accepted; accepted/user_added/rejected/outside untouched; identity preserved; empty set / null safe) + bundle embed completeness (32 helpers in BODY)',
      v053: 'section TOC 反选 (batch revert to 待审) — localRevertSectionSpans (accepted-in-section → proposed; proposed/user_added/rejected/outside untouched; identity preserved; empty set / null safe) — the inverse of approve (undo the one-click approve), NOT batch reject',
      v054: 'callProposeRequest — POST /paper-hl/propose-request?paperId=… {paper_id} body; ok resolve / ok:false reject / no-transport reject (重新提出高亮 transport)',
      v061: 'math render pipeline — repairMath (A1-A7 + guards) + splitMathPieces (math runs / prose untouched / full coverage) + mathConvert (Unicode/CSS, ℝ/subscripts/accents/fonts/frac/env-drop/unknown-preserved/empty-script) + segLen (dlen-aware) + buildTextPieces/buildBlockSegments (math segments carry dlen) + mapSelection (math whole-range clamp) + renderText (.phl-math + data-phl-dlen, G2 empty-fold, G3 byte-identical plain)',
    }, null, 2))
    return null
  })
}

main().catch((err) => {
  console.error('RENDER HELPERS TEST FAILED:', err && err.message ? err.message : err)
  process.exit(1)
})
