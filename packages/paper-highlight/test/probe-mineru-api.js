'use strict'

/**
 * MinerU API contract probe with auth token.
 * Hits candidate endpoints with X-Token and reports status + body, so
 * validation errors reveal the expected request shape.
 */

const https = require('node:https')

function call(method, url, { token, body } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['X-Token'] = token
    const req = https.request(u, { method, headers }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 400) }))
    })
    req.on('error', (e) => resolve({ err: e.message }))
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

async function main() {
  const token = process.env.MINERU_API || process.env.MinerU_API
  const base = 'https://mineru.net'
  const probes = [
    ['POST', '/api/v4/extract/task', { file_ids: [] }],
    ['POST', '/api/v4/extract/task', { url: 'https://example.com/x.pdf' }],
    ['POST', '/api/v4/file/batch', { files: [] }],
    ['POST', '/api/v4/file/urls', { files: [] }],
    ['GET', '/api/v4/extract/task/abc'],
    ['GET', '/api/v4/extract/task/batch/abc'],
    ['POST', '/api/v4/upload', {}],
    ['GET', '/api/v4/docs'],
    ['GET', '/openapi.json'],
    ['GET', '/api/openapi.json'],
    ['GET', '/apiManage/openapi.json'],
  ]
  for (const [m, path, body] of probes) {
    const r = await call(m, base + path, { token, body })
    console.log(JSON.stringify({ m, path, status: r.status, err: r.err, body: r.body && r.body.slice(0, 250) }))
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
