'use strict'
const fs = require('fs')
const path = require('path')

const dyn = path.join(__dirname, '..', 'dynamic')
const hostFile = fs.readFileSync(path.join(dyn, 'host-half.js'), 'utf8')
const open = hostFile.indexOf('String.raw`') + 'String.raw`'.length
const close = hostFile.lastIndexOf('`')
const hostBody = hostFile.slice(open, close)
const clientBody = fs.readFileSync(path.join(dyn, 'client-half.js'), 'utf8')
fs.writeFileSync(path.join(dyn, '.code.host.txt'), hostBody, 'utf8')
fs.writeFileSync(path.join(dyn, '.code.client.txt'), clientBody, 'utf8')
console.log('host bytes:', Buffer.byteLength(hostBody))
console.log('client bytes:', Buffer.byteLength(clientBody))
