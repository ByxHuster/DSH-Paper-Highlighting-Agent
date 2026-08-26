'use strict'
const fs = require('fs')
const path = require('path')

function gate(code, label) {
  const run = new Function('return (async () => {\n' + code + '\n})()')
  const promise = run()
  return Promise.resolve(promise).then(
    (p) => {
      const ok = (typeof p === 'object' && p !== null && Array.isArray(p.inject) && typeof p.apply === 'function') ||
        (typeof p === 'function')
      console.log(label, '-> returns plugin:', ok)
      return ok
    },
    (err) => {
      console.log(label, '-> REJECTED:', String(err && err.message || err))
      return false
    }
  )
}

async function main() {
  const hostText = fs.readFileSync(path.join(__dirname, '..', 'dynamic', 'host-half.js'), 'utf8')
  const start = hostText.indexOf('String.raw`') + 'String.raw`'.length
  const end = hostText.indexOf('`', start)
  const hostCode = hostText.slice(start, end)
  console.log('host body length', hostCode.length)
  console.log('host self-contained (no require/process):', !hostCode.includes('require') && !hostCode.includes('process'))
  await gate(hostCode, 'host half')

  const clientCode = fs.readFileSync(path.join(__dirname, '..', 'dynamic', 'client-half.js'), 'utf8')
  console.log('client body length', clientCode.length)
  await gate(clientCode, 'client half')
}

main()
