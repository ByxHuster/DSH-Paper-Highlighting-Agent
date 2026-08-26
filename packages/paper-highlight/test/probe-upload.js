'use strict'

/** Round-2 probes: v4 files shapes, v4 URL mode, v1 multipart. */

const fs = require('node:fs')
const https = require('node:https')

function call(method, url, { body, token, headers } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const h = { ...(headers || {}) }
    if (body !== undefined && !Buffer.isBuffer(body)) {
      h['Content-Type'] = 'application/json'
      body = JSON.stringify(body)
    }
    if (token) h['Authorization'] = `Bearer ${token}`
    const req = https.request(u, { method, headers: h }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 600) }))
    })
    req.on('error', (e) => resolve({ err: e.message }))
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function multipart(fields, boundary) {
  const parts = []
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

async function main() {
  const token = process.env.MINERU_API || process.env.MinerU_API
  const boundary = '----ph' + Date.now()

  const probes = [
    // v4 files as string array / string
    ['POST', 'https://mineru.net/api/v4/file-urls/batch', { body: { files: ['demo.pdf'] }, token }],
    ['POST', 'https://mineru.net/api/v4/file-urls/batch', { body: { files: 'demo.pdf' }, token }],
    ['POST', 'https://mineru.net/api/v4/file-urls/batch', { body: { files: [{ name: 'demo.pdf' }], model_version: 'pipeline' }, token }],
    // v4 URL mode with auth
    ['POST', 'https://mineru.net/api/v4/extract/task', { body: { url: 'https://cdn-mineru.openxlab.org.cn/demo/example.pdf', model_version: 'vlm' }, token }],
  ]
  for (const [m, url, o] of probes) {
    const r = await call(m, url, o)
    console.log(JSON.stringify({ label: url.split('/api/')[1], status: r.status, err: r.err, body: r.body }))
  }

  // v1 multipart: file_name field + binary file
  const pdf = fs.readFileSync(process.env.PDF_PATH || 'D:\\aa\\Mikolov 等 - 2013 - 2013.1 Word2Vec.pdf')
  const b1 = boundary + '1'
  const mp = multipart({ file_name: 'demo.pdf', file: pdf.toString('latin1') }, b1)
  // NOTE: binary via latin1 in a text part is wrong; do a proper file part below
  const b2 = boundary + '2'
  const parts = [
    Buffer.from(`--${b2}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\ndemo.pdf\r\n`),
    Buffer.from(`--${b2}\r\nContent-Disposition: form-data; name="file"; filename="demo.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    pdf,
    Buffer.from(`\r\n--${b2}--\r\n`),
  ]
  const mp2 = Buffer.concat(parts)
  const r2 = await new Promise((resolve) => {
    const u = new URL('https://mineru.net/api/v1/agent/parse/file')
    const req = https.request(u, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${b2}`, 'Content-Length': mp2.length },
    }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 600) }))
    })
    req.on('error', (e) => resolve({ err: e.message }))
    req.write(mp2)
    req.end()
  })
  console.log(JSON.stringify({ label: 'v1/agent/parse/file multipart', status: r2.status, err: r2.err, body: r2.body }))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
