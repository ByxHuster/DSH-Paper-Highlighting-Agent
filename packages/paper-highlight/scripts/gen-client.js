'use strict'

/**
 * paper-highlight · client artifact generator (single source of truth)
 *
 * Emits two files from client/render-body.js so the render logic lives once:
 *
 *   1. client/client.js        — durable `__ModuleLoader__` bundle; `callData`
 *      fetches the Step-4 host webserver route `/paper-hl/read`, `styles` is a
 *      style-tag shim (the ModuleLoader env has no `styles` global).
 *   2. dynamic/client-half.js  — the dynamic dual-half plugin's browser half
 *      (a self-contained async-function body for `cordis_define code.client`);
 *      `callData` = `host.call('paper.read', …)`, `styles` is the closure's.
 *
 * Run:  node scripts/gen-client.js
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const BODY = require('../client/render-body')

function generateBundle() {
  const lines = []
  lines.push(`window.__ModuleLoader__.load({`)
  lines.push(`\tid: "paper-highlight/client",`)
  lines.push(`\tfactory: (require) => {`)
  lines.push(`\t\tvar module = { exports: {} };`)
  lines.push(`\t\tvar exports = module.exports;`)
  lines.push(`\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`)
  lines.push(`\t\tconst React = require("react");`)
  lines.push(`\t\tconst styles = {`)
  lines.push(`\t\t\tinsert(css) {`)
  lines.push(`\t\t\t\tconst tagId = "paper-highlight/client.css";`)
  lines.push(`\t\t\t\tif (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {`)
  lines.push(`\t\t\t\t\tconst tag = document.createElement("style");`)
  lines.push(`\t\t\t\t\ttag.dataset.plugin = "paper-highlight";`)
  lines.push(`\t\t\t\t\ttag.dataset.pluginCss = tagId;`)
  lines.push(`\t\t\t\t\ttag.textContent = css;`)
  lines.push(`\t\t\t\t\tdocument.head.appendChild(tag);`)
  lines.push(`\t\t\t\t}`)
  lines.push(`\t\t\t}`)
  lines.push(`\t\t};`)
  lines.push(`\t\tconst callData = async (q) => {`)
  lines.push(`\t\t\tconst url = "/paper-hl/read" + (q && q.paperId ? "?paperId=" + encodeURIComponent(q.paperId) : "");`)
  lines.push(`\t\t\tconst res = await fetch(url, { headers: { Accept: "application/json" } });`)
  lines.push(`\t\t\tif (!res.ok) throw new Error("GET " + url + " -> " + res.status);`)
  lines.push(`\t\t\treturn res.json();`)
  lines.push(`\t\t};`)
  for (const line of BODY.split('\n')) lines.push('\t\t' + line)
  lines.push(`\t\texports.apply = apply;`)
  lines.push(`\t\texports.inject = inject;`)
  lines.push(`\t\treturn module.exports;`)
  lines.push(`\t}`)
  lines.push(`});`)
  lines.push(``)
  return lines.join('\n')
}

function generateDynamicClientHalf() {
  const lines = []
  lines.push(`const callData = (q) => host.call('paper.read', q)`)
  for (const line of BODY.split('\n')) lines.push(line)
  lines.push(`return { inject, apply }`)
  lines.push(``)
  return lines.join('\n')
}

const bundlePath = path.join(ROOT, 'client', 'client.js')
const dynamicPath = path.join(ROOT, 'dynamic', 'client-half.js')
fs.writeFileSync(bundlePath, generateBundle(), 'utf8')
fs.writeFileSync(dynamicPath, generateDynamicClientHalf(), 'utf8')
console.log('wrote', bundlePath, fs.statSync(bundlePath).size, 'bytes')
console.log('wrote', dynamicPath, fs.statSync(dynamicPath).size, 'bytes')
