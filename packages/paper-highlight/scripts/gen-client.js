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
const { BODY } = require('../client/render-body')

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
  // v0.2 Phase 2 (P2-a): durable review write transport. `callWrite(action,
  // paperId)` inside the shared BODY posts to POST /paper-hl/write?paperId=…
  // with the JSON-encoded action body. Only the durable bundle wires this;
  // the dynamic half (generateDynamicClientHalf) deliberately stays read-only.
  lines.push(`\t\tconst writeData = async (url, body) => {`)
  lines.push(`\t\t\tconst res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body });`)
  lines.push(`\t\t\tif (!res.ok) throw new Error("POST " + url + " -> " + res.status);`)
  lines.push(`\t\t\treturn res.json();`)
  lines.push(`\t\t};`)
  // v0.3 Phase 1: profile transport. `callProfile(method, url, body)` inside
  // the shared BODY posts/gets /paper-hl/profile* (read / init / apply). Only
  // the durable bundle wires this; the dynamic half stays read-only (callProfile
  // rejects cleanly, exactly like callWrite).
  lines.push(`\t\tconst profileData = async (method, url, body) => {`)
  lines.push(`\t\t\tconst headers = { Accept: "application/json" };`)
  lines.push(`\t\t\tconst opts = { method, headers };`)
  lines.push(`\t\t\tif (method !== "GET" && body != null) { headers["Content-Type"] = "application/json"; opts.body = body; }`)
  lines.push(`\t\t\tconst res = await fetch(url, opts);`)
  lines.push(`\t\t\tif (!res.ok) throw new Error(method + " " + url + " -> " + res.status);`)
  lines.push(`\t\t\treturn res.json();`)
  lines.push(`\t\t};`)
  // v0.5: format transport. `callFormat(payload)` inside the shared BODY POSTs
  // the one-click factory reset to /paper-hl/format with {confirm:true, scope}.
  // Only the durable bundle wires this; the dynamic half stays read-only
  // (callFormat rejects cleanly, exactly like callWrite / callProfile).
  lines.push(`\t\tconst formatData = async (body) => {`)
  lines.push(`\t\t\tconst res = await fetch("/paper-hl/format", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body });`)
  lines.push(`\t\t\tif (!res.ok) throw new Error("POST /paper-hl/format -> " + res.status);`)
  lines.push(`\t\t\treturn res.json();`)
  lines.push(`\t\t};`)
  for (const line of BODY.split('\n')) lines.push('\t\t' + line)
  lines.push(`\t\texports.apply = apply;`)
  lines.push(`\t\texports.inject = inject;`)
  // P2-d: expose the embedded pure helpers so headless tests (simulate-render)
  // can drive the same code that runs in the browser to derive expected ranges.
  lines.push(`\t\texports.buildBlocks = buildBlocks;`)
  lines.push(`\t\texports.buildBlockSegments = buildBlockSegments;`)
  lines.push(`\t\texports.buildSegmentMap = buildSegmentMap;`)
  lines.push(`\t\texports.mapSelection = mapSelection;`)
  lines.push(`\t\texports.selectionToNorm = selectionToNorm;`)
  lines.push(`\t\texports.nodeOffsetToSeg = nodeOffsetToSeg;`)
  // P2-e: section-status + current-section helpers for headless tests.
  lines.push(`\t\texports.sectionList = sectionList;`)
  lines.push(`\t\texports.currentSectionId = currentSectionId;`)
  // v0.4 Phase 4: keyboard-shortcut mapper + review progress + export URL.
  lines.push(`\t\texports.keyAction = keyAction;`)
  lines.push(`\t\texports.reviewProgress = reviewProgress;`)
  lines.push(`\t\texports.buildExportUrl = buildExportUrl;`)
  // v0.5.1: batch section-approve optimistic helper for headless tests.
  lines.push(`\t\texports.localApproveSectionSpans = localApproveSectionSpans;`)
  // v0.5.3: batch section-revert-to-pending (反选 = 批量恢复待审, NOT reject)
  // optimistic helper for headless tests.
  lines.push(`\t\texports.localRevertSectionSpans = localRevertSectionSpans;`)
  // v0.3 Phase 1: colors.yml-driven palette helper for headless tests.
  lines.push(`\t\texports.colorLegend = colorLegend;`)
  lines.push(`\t\texports.callProfile = callProfile;`)
  // v0.5: one-click format data function for headless tests.
  lines.push(`\t\texports.callFormat = callFormat;`)
  // v0.3 Phase 3: profile edit-panel model + save payload builders.
  lines.push(`\t\texports.profilePanelModel = profilePanelModel;`)
  lines.push(`\t\texports.profilePanelColors = profilePanelColors;`)
  lines.push(`\t\texports.profileSavePayload = profileSavePayload;`)
  // v0.3 Phase 2: pending-proposal panel model + decisions payload builder.
  lines.push(`\t\texports.proposalCardModel = proposalCardModel;`)
  lines.push(`\t\texports.buildApplyDecisions = buildApplyDecisions;`)
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
