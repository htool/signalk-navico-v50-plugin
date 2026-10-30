#!/usr/bin/env node
// Run V60 emulator + web UI without full Signal K (lab Zeus / homepi).
const http = require('http')
const fs = require('fs')
const path = require('path')
const { createRadio } = require('../lib/v50-radio')
const { mergeOptions } = require('../lib/v50-identity')

const opts = mergeOptions({
  canDevice: process.env.CAN_DEVICE || 'can0',
  preferredAddress: Number(process.env.V50_ADDR || process.env.V60_ADDR || 25),
  ownMmsi: process.env.V50_MMSI || process.env.V60_MMSI || '244060123',
  modelId: process.env.VHF_MODEL || 'V50',
  modelVersion: process.env.VHF_MODEL || 'V50',
})
const port = Number(process.env.PORT || 3099)

const app = {
  debug: function () {
    if (process.env.DEBUG) console.log.apply(console, arguments)
  },
  on: function () {},
  removeListener: function () {},
  emit: function () {},
  setPluginStatus: function (m) { console.log('[status]', m) },
}

const radio = createRadio(app, opts)
const publicDir = path.join(__dirname, '..', 'public')

function sendFile(res, file, type) {
  res.writeHead(200, { 'Content-Type': type })
  fs.createReadStream(file).pipe(res)
}

function readBody(req, cb) {
  const chunks = []
  req.on('data', function (c) { chunks.push(c) })
  req.on('end', function () {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString() || '{}')) }
    catch (e) { cb(null, {}) }
  })
}

const server = http.createServer(function (req, res) {
  const url = req.url.split('?')[0]
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    return sendFile(res, path.join(publicDir, 'index.html'), 'text/html')
  }
  if (req.method === 'GET' && url === '/app.js') {
    return sendFile(res, path.join(publicDir, 'app.js'), 'application/javascript')
  }
  if (req.method === 'GET' && url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(radio.getState()))
  }
  if (req.method === 'POST' && url === '/call') {
    return readBody(req, function (_e, body) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(radio.simulateCall(body)))
    })
  }
  if (req.method === 'POST' && url === '/options') {
    return readBody(req, function (_e, body) {
      radio.setOptions(body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(radio.getState()))
    })
  }
  res.writeHead(404)
  res.end('not found')
})

server.listen(port, '0.0.0.0', function () {
  console.log('%s emulator on can=%s web=http://0.0.0.0:%s/', opts.modelId, opts.canDevice, port)
})
