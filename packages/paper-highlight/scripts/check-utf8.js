'use strict'
const fs = require('fs')
const samples = [
  ['dynamic/client-half.js', ['关键定义', "label: '论文'"]],
  ['client/client.js', ['关键定义', 'label: "论文"']],
  ['client/render-body.js', ['关键定义', 'label: \'论文\'']],
]
for (const [rel, needles] of samples) {
  const raw = fs.readFileSync(require('path').join(__dirname, '..', rel), 'utf8')
  console.log(rel, '->', needles.map((n) => raw.includes(n)).join(' / '), '| bytes:', Buffer.byteLength(raw))
}
