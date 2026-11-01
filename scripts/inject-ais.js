#!/usr/bin/env node
// Inject a Class-A AIS target near own-ship onto can0 for Zeus lab Call tests.
const { spawnSync } = require('child_process')
const { toPgn } = require('@canboat/canboatjs')
const { encodeCanId } = require('../lib/cli-can')

const CAN = process.env.CAN_DEVICE || 'can0'
const SRC = Number(process.env.AIS_SRC || 43)
const MMSI = Number(process.env.AIS_MMSI || 244123456)
const NAME = process.env.AIS_NAME || 'LAB CALL TARGET'
const INTERVAL_MS = Number(process.env.AIS_INTERVAL_MS || 2000)

// Own-ship lab fix ~ Markermeer (from live 129025 on homepi)
const OWN_LAT = Number(process.env.OWN_LAT || 52.48759)
const OWN_LON = Number(process.env.OWN_LON || 5.06360)
// ~0.5 nm NE of own ship
const LAT = Number(process.env.AIS_LAT || OWN_LAT + 0.008)
const LON = Number(process.env.AIS_LON || OWN_LON + 0.012)

function sendRaw(canId, data) {
  const idHex = ('00000000' + (canId >>> 0).toString(16)).slice(-8)
  const frame = idHex + '#' + Buffer.from(data).toString('hex')
  spawnSync('cansend', [CAN, frame], { stdio: 'ignore' })
}

function sendPgn(pgn, data, prio) {
  const src = SRC
  const dst = 255
  const canIdFor = () => encodeCanId(pgn, src, dst, prio)
  if (data.length <= 8) {
    const padded = Buffer.alloc(8, 0xff)
    data.copy(padded)
    sendRaw(canIdFor(), padded)
    return
  }
  let seq = (sendPgn._seq = ((sendPgn._seq || 0) + 1) & 7)
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
    sendRaw(canIdFor(), out)
    frame++
  }
}

function positionReport() {
  return {
    pgn: 129038,
    prio: 4,
    dst: 255,
    src: SRC,
    'Message ID': 1,
    'Repeat Indicator': 0,
    'User ID': MMSI,
    Longitude: LON,
    Latitude: LAT,
    'Position Accuracy': 1,
    RAIM: 0,
    'Time Stamp': Math.floor(Date.now() / 1000) % 60,
    COG: 1.2,
    SOG: 4.5,
    'Communication State': 0,
    'AIS Transceiver information': 2,
    'Special Maneuver Indicator': 0,
  }
}

function staticData() {
  return {
    pgn: 129794,
    prio: 6,
    dst: 255,
    src: SRC,
    'Message ID': 5,
    'Repeat Indicator': 0,
    'User ID': MMSI,
    'IMO Number': 0,
    Callsign: 'PITEST',
    Name: NAME,
    'Type of ship': 70,
    Length: 24,
    Beam: 6,
    'Position reference from Starboard': 3,
    'Position reference from Bow': 12,
    Draft: 1.8,
    Destination: 'LAB',
    AIS: 0,
    'AIS Transceiver information': 2,
  }
}

function tick() {
  const pos = toPgn(positionReport())
  const st = toPgn(staticData())
  if (!pos || !st) {
    console.error('toPgn failed')
    return
  }
  sendPgn(129038, pos, 4)
  sendPgn(129794, st, 6)
  console.log(
    new Date().toISOString(),
    'AIS',
    MMSI,
    NAME,
    LAT.toFixed(5),
    LON.toFixed(5),
    'pos',
    pos.length,
    'static',
    st.length
  )
}

tick()
setInterval(tick, INTERVAL_MS)
