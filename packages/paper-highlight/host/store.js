'use strict'

/**
 * paper-highlight · data store (design doc §4.1)
 *
 * All paper artifacts live under <root>/data/<paper_id>/ so the agent's own
 * fs tools can reach them directly. Writes are atomic-ish: write to a temp
 * file, then rename over the target.
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const { validateAnchors, validateHighlights, newHighlightsSkeleton } = require('./schema')

function paperDir(root, paperId) {
  return path.join(root, 'data', paperId)
}

function paperFile(root, paperId, name) {
  return path.join(paperDir(root, paperId), name)
}

async function ensurePaperDir(root, paperId) {
  const dir = paperDir(root, paperId)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

async function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

async function atomicWriteText(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  await fsp.writeFile(tmp, text, 'utf8')
  await fsp.rename(tmp, file)
}

/**
 * Persist the full normalized output of one paper.
 * @param root workspace root
 * @param paperId stable paper id
 * @param files { paperMd, anchors, meta, images? }
 */
async function writePaper(root, paperId, { paperMd, anchors, meta, images }) {
  validateAnchors(anchors)
  const dir = await ensurePaperDir(root, paperId)
  await atomicWriteText(paperFile(root, paperId, 'paper.md'), paperMd)
  await atomicWriteJson(paperFile(root, paperId, 'anchors.json'), anchors)
  await atomicWriteJson(paperFile(root, paperId, 'meta.json'), meta)

  // v0.6.4: extracted image/chart rasters → data/<paper_id>/images/<name>.
  if (Array.isArray(images) && images.length > 0) {
    const imgDir = path.join(dir, 'images')
    await fsp.mkdir(imgDir, { recursive: true })
    for (const im of images) {
      if (!/^[a-zA-Z0-9._-]+$/.test(im.name) || im.name.includes('..')) continue
      const tmp = path.join(imgDir, `.${im.name}.tmp`)
      await fsp.writeFile(tmp, im.data)
      await fsp.rename(tmp, path.join(imgDir, im.name))
    }
  }

  // Self-contained highlights document per design §4.2: skeleton + embedded anchors.
  const skeleton = newHighlightsSkeleton({
    id: paperId,
    title: meta.title,
    sourcePdf: meta.source_pdf,
    mineruTask: meta.mineru_task,
  })
  skeleton.anchors = anchors
  await writeHighlights(root, paperId, skeleton)
  return dir
}

async function readPaperMd(root, paperId) {
  return fsp.readFile(paperFile(root, paperId, 'paper.md'), 'utf8')
}

async function readAnchors(root, paperId) {
  const raw = await fsp.readFile(paperFile(root, paperId, 'anchors.json'), 'utf8')
  return JSON.parse(raw)
}

async function readMeta(root, paperId) {
  const raw = await fsp.readFile(paperFile(root, paperId, 'meta.json'), 'utf8')
  return JSON.parse(raw)
}

async function readHighlights(root, paperId) {
  const raw = await fsp.readFile(paperFile(root, paperId, 'paper.highlights.json'), 'utf8')
  const parsed = JSON.parse(raw)
  validateHighlights(parsed)
  return parsed
}

async function writeHighlights(root, paperId, highlights) {
  validateHighlights(highlights)
  await ensurePaperDir(root, paperId)
  await atomicWriteJson(paperFile(root, paperId, 'paper.highlights.json'), highlights)
  return highlights
}

module.exports = {
  paperDir,
  paperFile,
  ensurePaperDir,
  writePaper,
  readPaperMd,
  readAnchors,
  readMeta,
  readHighlights,
  writeHighlights,
  atomicWriteJson,
  atomicWriteText,
}
