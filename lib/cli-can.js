// SocketCAN via cansend/candump — no native module. Good enough for lab V50 claim.
const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const debug = require('debug')('signalk-navico-v50:cli-can')
const { createFastPacketAssembler } = require('./fast-packet')

try {
  var canboat = require('@canboat/canboatjs')
} catch (e) {
  canboat = null
}

function encodeCanId(pgn, src, dst, prio) {
  prio = prio == null ? 6 : prio
  src = src & 0xff
  dst = dst == null ? 255 : dst & 0xff
  // ISO 29-bit: prio(3) | R(1)=0 | DP(1) | PF(8) | PS(8) | SA(8)
  const pf = (pgn >> 8) & 0xff
  const dp = (pgn >> 16) & 1
  if (pf < 240) {
    // PDU1: PS = destination; PGN number has PS=0
    return (
      ((prio & 7) << 26) |
      (dp << 24) |
      (pf << 16) |
      ((dst & 0xff) << 8) |
      (src & 0xff)
    ) >>> 0
  }
  // PDU2: PS is part of PGN
  return (
    ((prio & 7) << 26) |
    (dp << 24) |
    ((pgn & 0x1ffff) << 8) |
    (src & 0xff)
  ) >>> 0
}

function toPgnBuffer(msg) {
  if (Buffer.isBuffer(msg.data)) return msg.data
  if (canboat && canboat.toPgn) {
    const buf = canboat.toPgn(msg)
    if (buf) return buf
  }
  throw new Error('cannot encode PGN ' + msg.pgn)
}

// Minimal 60928 / 126996 encoders if toPgn unavailable for claim-only path
function encodeAddressClaim(msg) {
  if (canboat && canboat.toPgn) return canboat.toPgn(msg)
  // fallback: use toPgn from package always present after npm i
  throw new Error('need @canboat/canboatjs toPgn')
}

function createCliCan(canDevice) {
  const ee = new EventEmitter()
  let candump = null
  let address = null
  const fp = createFastPacketAssembler()

  function startDump() {
    candump = spawn('stdbuf', ['-oL', 'candump', '-L', canDevice], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    candump.stdout.setEncoding('utf8')
    let buf = ''
    candump.stdout.on('data', function (chunk) {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop()
      lines.forEach(function (line) {
        // (ts) can0 18EEFF19#DATA
        const m = line.match(/^\([^)]+\)\s+\S+\s+([0-9A-Fa-f]+)#([0-9A-Fa-f]*)/)
        if (!m) return
        const id = parseInt(m[1], 16)
        const data = Buffer.from(m[2] || '', 'hex')
        // parse NMEA can id
        const src = id & 0xff
        const pf = (id >> 16) & 0xff
        const ps = (id >> 8) & 0xff
        const dp = (id >> 24) & 1
        const pgn = pf < 240 ? (dp << 16) | (pf << 8) : (dp << 16) | (pf << 8) | ps
        const dst = pf < 240 ? ps : 255
        const assembled = fp.push({ pgn: pgn, src: src, dst: dst, data: data, canId: id })
        if (assembled) ee.emit('message', assembled)
      })
    })
    candump.on('exit', function (code) {
      debug('candump exited %s', code)
      setTimeout(startDump, 1000)
    })
  }

  function sendRaw(canId, data) {
    const idHex = ('00000000' + (canId >>> 0).toString(16)).slice(-8)
    const dataHex = Buffer.from(data).toString('hex')
    const frame = idHex + '#' + dataHex
    spawn('cansend', [canDevice, frame], { stdio: 'ignore' })
  }

  function sendPGN(msg) {
    const src = msg.src != null ? msg.src : address
    const dst = msg.dst != null ? msg.dst : 255
    const prio = msg.prio != null ? msg.prio : 6
    let data = msg.data
    if (!Buffer.isBuffer(data)) {
      data = canboat.toPgn(msg)
    }
    if (!data) throw new Error('toPgn failed for ' + msg.pgn)
    // Fast packet if >8
    const pgn = msg.pgn
    const pf = (pgn >> 8) & 0xff
    function canIdFor(dst_) {
      return encodeCanId(pgn, src, dst_, prio)
    }
    if (data.length <= 8) {
      const padded = Buffer.alloc(8, 0xff)
      data.copy(padded)
      sendRaw(canIdFor(dst), padded)
      return
    }
    // fast packet
    let seq = (sendPGN._seq = ((sendPGN._seq || 0) + 1) & 7)
    let frame = 0
    let offset = 0
    const total = data.length
    while (offset < total) {
      const out = Buffer.alloc(8, 0xff)
      out[0] = (seq << 5) | (frame & 0x1f)
      if (frame === 0) {
        out[1] = total
        const n = Math.min(6, total - offset)
        data.copy(out, 2, offset, offset + n)
        offset += n
      } else {
        const n = Math.min(7, total - offset)
        data.copy(out, 1, offset, offset + n)
        offset += n
      }
      sendRaw(canIdFor(dst), out)
      frame++
    }
  }

  startDump()

  return {
    on: ee.on.bind(ee),
    sendPGN: sendPGN,
    setAddress: function (a) { address = a },
    stop: function () {
      if (candump) {
        candump.removeAllListeners('exit')
        candump.kill('SIGTERM')
      }
    },
  }
}

module.exports = { createCliCan: createCliCan, encodeCanId: encodeCanId }
