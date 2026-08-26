'use strict'

/**
 * Extract the plain-text API documentation (curl examples + parameter tables)
 * from the MinerU docs page, sliced around each endpoint.
 */

const https = require('node:https')

function get(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    }).on('error', (e) => resolve({ err: e.message }))
  })
}

async function main() {
  const html = (await get('https://mineru.net/apiManage/docs')).body
  // strip scripts/styles
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  // keep code blocks as-is then strip other tags
  text = text.replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')

  // 批量文件解析 section: file-urls/batch request + extract/task/batch + extract-results/batch
  const bIdx = text.indexOf('2.批量文件解析')
  console.log('\n\n######## 批量文件解析 (file-urls/batch → upload → task/batch → results) ########')
  console.log(text.slice(bIdx, bIdx + 9000))
  // Write the whole plain text to a local file for grepping.
  const fs = require('node:fs')
  fs.writeFileSync(require('node:path').join(__dirname, 'fixtures', 'mineru-docs.txt'), text, 'utf8')
  console.log('saved plain text:', text.length, 'chars')
}

main().then(() => process.exit(0)).catch((e) => { console.error('failed:', e.message); process.exit(1) })
