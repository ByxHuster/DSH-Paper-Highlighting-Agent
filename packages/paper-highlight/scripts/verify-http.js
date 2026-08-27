'use strict'
const http = require('http')

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    }).on('error', reject)
  })
}

async function main() {
  const root = await get('http://127.0.0.1:3081/')
  console.log('GET / ->', root.status, 'bytes', root.body.length, '| has __DSH_BOOT__:', root.body.includes('__DSH_BOOT__'))

  const bundle = await get('http://127.0.0.1:3081/plugins/paper-highlight/client.js')
  console.log('GET /plugins/paper-highlight/client.js ->', bundle.status, 'bytes', bundle.body.length,
    '| ModuleLoader:', bundle.body.includes('__ModuleLoader__.load'),
    '| id paper-highlight/client:', bundle.body.includes('"paper-highlight/client"'))

  const data = await get('http://127.0.0.1:3081/paper-hl/read')
  console.log('GET /paper-hl/read ->', data.status)
  let parsed = null
  try {
    parsed = JSON.parse(data.body.toString('utf8'))
  } catch (e) {
    console.log('  JSON parse failed:', e.message, '| body head:', data.body.toString('utf8').slice(0, 200))
  }
  if (parsed) {
    console.log('  ok:', parsed.ok, '| paperId:', parsed.paperId, '| papers:', JSON.stringify(parsed.papers))
    console.log('  paperMd chars:', parsed.paperMd ? parsed.paperMd.length : '-',
      '| anchors:', parsed.anchors ? Object.keys(parsed.anchors).length : '-',
      '| highlights spans:', parsed.highlights ? parsed.highlights.spans.length : '-')
  }

  const dataById = await get('http://127.0.0.1:3081/paper-hl/read?paperId=p-mikolov-2013-2013-1-word2vec')
  const p2 = JSON.parse(dataById.body.toString('utf8'))
  console.log('GET /paper-hl/read?paperId=... ->', dataById.status, '| ok:', p2.ok, '| id:', p2.paperId, '| anchors:', p2.anchors ? Object.keys(p2.anchors).length : '-')

  // v0.4 Phase 1 probe: export route (needs the host restarted to be live; an
  // old host returns 404 which is reported as informational, not a failure).
  const exp = await get('http://127.0.0.1:3081/paper-hl/export?paperId=p-mikolov-2013-2013-1-word2vec&format=html')
  console.log('GET /paper-hl/export ->', exp.status,
    '| Content-Type:', exp.headers['content-type'] || '-',
    '| bytes:', exp.body.length)
  if (exp.status === 200) {
    const html = exp.body.toString('utf8')
    console.log('  html ok:', html.startsWith('<!DOCTYPE html>'),
      '| marks:', (html.match(/<mark/g) || []).length,
      '| legend:', (html.match(/class="phl-legend-item"/g) || []).length)
  }
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
