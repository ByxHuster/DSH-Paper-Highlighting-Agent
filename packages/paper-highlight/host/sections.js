'use strict'

/**
 * paper-highlight · section index (v0.2 Phase 1)
 *
 * Builds the chapter tree from the paper's title anchors + markdown heading
 * levels. It is a PURE function of { paperMd, anchors } and is NOT persisted —
 * /paper-hl/read derives it on every request so it can never drift from the
 * normalized data (design doc §8 v0.2, decision #3).
 *
 * Section model:
 *   { id, title, level, anchor_id, md_offset, anchor_ids[], empty, kind }
 *   - id            stable within a paper: s1, s2, … in reading order
 *   - title         heading text (anchor.text)
 *   - level         markdown heading depth (1 = paper title, 2+ = sections)
 *   - anchor_id     the heading's own anchor id
 *   - anchor_ids    every anchor belonging to this section (heading + body),
 *                   in reading order, via md_offset ranges
 *   - empty         true when the section has no body (heading only, e.g. an
 *                   empty "## References" that normalize skipped)
 *   - kind          'paper_title' for the first heading, 'section' otherwise
 */

function cmpAnchor(a, b) {
  return a.page - b.page || a.block - b.block || a.par - b.par
}

/**
 * Markdown heading level at a character offset: count leading '#' on the line
 * containing mdOffset, requiring a following space (a real ATX heading). 0 when
 * the line is not a heading (defensive: title blocks could be plain text).
 */
function headingLevelOf(paperMd, mdOffset) {
  if (!Number.isInteger(mdOffset) || mdOffset < 0 || mdOffset >= paperMd.length) return 0
  const lineStart = paperMd.lastIndexOf('\n', mdOffset - 1) + 1
  let i = lineStart
  while (i < paperMd.length && paperMd[i] === '#') i++
  const hashes = i - lineStart
  if (hashes === 0 || paperMd[i] !== ' ') return 0
  return Math.min(hashes, 6)
}

/**
 * @param {object} opts { paperMd: string, anchors: object<anchor_id, anchor> }
 * @returns {Array<object>} sections in reading order
 */
function buildSections({ paperMd, anchors }) {
  if (typeof paperMd !== 'string') throw new Error('sections: paperMd must be a string')
  if (typeof anchors !== 'object' || anchors === null || Array.isArray(anchors)) {
    throw new Error('sections: anchors must be an object map')
  }
  const titles = Object.entries(anchors)
    .filter(([, a]) => a.type === 'title')
    .sort((x, y) => cmpAnchor(x[1], y[1]))

  const sections = []
  let prevLevel = 1
  for (let i = 0; i < titles.length; i++) {
    const [id, a] = titles[i]
    const next = titles[i + 1]
    const endOffset = next ? next[1].md_offset : Infinity
    const anchorIds = Object.keys(anchors)
      .filter((aid) => {
        const aa = anchors[aid]
        return aa.md_offset >= a.md_offset && aa.md_offset < endOffset
      })
      .sort((x, y) => cmpAnchor(anchors[x], anchors[y]))

    let level = headingLevelOf(paperMd, a.md_offset)
    if (!level) level = i === 0 ? 1 : Math.min(prevLevel + 1, 6)
    prevLevel = level

    sections.push({
      id: 's' + (i + 1),
      title: a.text,
      level,
      anchor_id: id,
      md_offset: a.md_offset,
      anchor_ids: anchorIds,
      empty: anchorIds.length <= 1,
      kind: i === 0 ? 'paper_title' : 'section',
    })
  }
  return sections
}

module.exports = { buildSections, headingLevelOf }
