// V60B DSC Call path (CERTAIN — Ghidra FUN_08051d28 / FUN_08028c30 / FUN_08028c44 /
// FUN_0805215a on SW_VHF_V60B_V4.60):
//
//   1) PGN 130845 Set  key group=0x11 param=0xAD  value=channel
//        → stash working channel (does not dial)
//   2) PGN 130850       key 0x6F + MMSI LE u32 at bytes [8..11]
//        → dial using stashed channel; reply PGN 130851 (key 24 6f, status byte)
//
// Legacy lab path still accepted: 130850 Simnet event id 3 (Init DSC Call) with
// short event-command layout (canboat navico_alarms_and_commands).

const EVENT_INIT_DSC_CALL = 3
const MAN_SIMRAD = 1857
const MAN_NAVICO = 275
const MAN_BG = 381 // canboat "B&G"

const KEY_WORKING_CHANNEL_GROUP = 0x11
const KEY_WORKING_CHANNEL_PARAM = 0xad
const KEY_DIAL_MMSI = 0x6f
const DIAL_FAMILY = 0x24 // byte[5] on firmware dial / dial-ACK frames

const MAN_LABELS = {
  [MAN_SIMRAD]: 'Simrad',
  [MAN_NAVICO]: 'Navico',
  [MAN_BG]: 'B&G',
}

const STATUS = {
  OK: 0,
  DSC_DISABLED: 1,
  BUSY: 2,
  IN_PROGRESS: 3,
  NO_OWN_MMSI: 4,
  INVALID_MMSI: 5,
  INVALID_CHANNEL: 6,
}

function parseOwnMmsi(mmsi) {
  const digits = String(mmsi || '').replace(/\D/g, '')
  if (digits.length < 9) return null
  return digits.slice(0, 9)
}

function decideStatus(opts, call) {
  if (!opts.dscEnabled) return STATUS.DSC_DISABLED
  if (!parseOwnMmsi(opts.ownMmsi)) return STATUS.NO_OWN_MMSI
  if (call && call.mmsi && !/^\d{9}$/.test(String(call.mmsi))) return STATUS.INVALID_MMSI
  if (call && call.channel != null) {
    const ch = Number(call.channel)
    if (!Number.isFinite(ch) || ch < 1 || ch > 88) return STATUS.INVALID_CHANNEL
  }
  if (opts.forceStatus != null && opts.forceStatus !== '') {
    return Number(opts.forceStatus)
  }
  return Number(opts.autoReplyStatus) || STATUS.OK
}

function manOk(buf, off) {
  if (buf.length < off + 2) return false
  const man = buf[off] | ((buf[off + 1] & 0x07) << 8)
  return man === MAN_SIMRAD || man === MAN_NAVICO || man === MAN_BG
}

function manCode(buf, off) {
  return buf[off] | ((buf[off + 1] & 0x07) << 8)
}

/** Legacy test layout: event id immediately after man bytes. */
function manEventAt(buf, off) {
  return manOk(buf, off) && buf.length >= off + 3 && buf[off + 2] === EVENT_INIT_DSC_CALL
}

/**
 * Simnet event-command: event id at byte 5.
 *   [0..1] man|ind  [2] address  [3] reserved  [4] display group
 *   [5] event id (=3)  [6] command
 */
function simnetEventAt(buf, off, ourAddress) {
  if (!manOk(buf, off) || buf.length < off + 6) return false
  if (buf[off + 5] !== EVENT_INIT_DSC_CALL) return false
  const addr = buf[off + 2]
  return addr === ourAddress || addr === 0xff
}

function addrOk(buf, off, ourAddress) {
  const addr = buf[off + 2]
  return addr === ourAddress || addr === 0xff
}

/**
 * V60 working-channel Set on 130845:
 *   [6]=0x11  [7]=0xad  [8]=0x00  [9]=op (1=Set, unused by fw)  [10]=channel
 */
function workingChannelAt(buf, off) {
  if (!manOk(buf, off) || buf.length < off + 11) return false
  return (
    buf[off + 6] === KEY_WORKING_CHANNEL_GROUP &&
    buf[off + 7] === KEY_WORKING_CHANNEL_PARAM &&
    buf[off + 8] === 0x00
  )
}

/**
 * V60 dial on 130850: key 0x6F at [6],[7]=0; MMSI LE u32 at [8..11].
 * Firmware also places family 0x24 at [5] on the matching ACK.
 */
function dialMmsiAt(buf, off) {
  if (!manOk(buf, off) || buf.length < off + 12) return false
  return buf[off + 6] === KEY_DIAL_MMSI && buf[off + 7] === 0x00
}

function toBuf(data) {
  if (!data) return null
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.from(data)
  if (typeof data === 'string') {
    const hex = data.replace(/[^0-9a-fA-F]/g, '')
    if (hex.length >= 2 && hex.length % 2 === 0) return Buffer.from(hex, 'hex')
  }
  return null
}

function payloadOffset(buf) {
  // Fast-packet first frame: [seq|frame=0][len][payload…]
  if (buf && (buf[0] & 0x1f) === 0 && buf.length >= 8 && manOk(buf, 2)) return 2
  return 0
}

function decodeSimnetAt(buf, off) {
  if (!manOk(buf, off) || buf.length < off + 6) return null
  const man = manCode(buf, off)
  return {
    layout: 'simnet-event3',
    manufacturerCode: man,
    manufacturer: MAN_LABELS[man] || String(man),
    address: buf[off + 2],
    reserved: buf[off + 3],
    displayGroup: buf[off + 4],
    eventId: buf[off + 5],
    command: buf.length > off + 6 ? buf[off + 6] : null,
  }
}

function decodeLegacyAt(buf, off) {
  if (!manEventAt(buf, off)) return null
  const man = manCode(buf, off)
  return {
    layout: 'legacy-short',
    manufacturerCode: man,
    manufacturer: MAN_LABELS[man] || String(man),
    eventId: buf[off + 2],
    statusOrCommand: buf.length > off + 3 ? buf[off + 3] : null,
  }
}

function decodeWorkingChannelAt(buf, off) {
  if (!workingChannelAt(buf, off)) return null
  const man = manCode(buf, off)
  return {
    layout: 'v60-working-channel',
    kind: 'working-channel',
    manufacturerCode: man,
    manufacturer: MAN_LABELS[man] || String(man),
    address: buf[off + 2],
    keyGroup: buf[off + 6],
    keyParam: buf[off + 7],
    key: (buf[off + 7] << 8) | buf[off + 6],
    operation: buf[off + 9],
    channel: buf[off + 10],
    eventName: 'DSC working channel',
  }
}

function decodeDialAt(buf, off) {
  if (!dialMmsiAt(buf, off)) return null
  const man = manCode(buf, off)
  const mmsiNum =
    (buf[off + 8] |
      (buf[off + 9] << 8) |
      (buf[off + 10] << 16) |
      (buf[off + 11] << 24)) >>>
    0
  // Live MFD cancel / incomplete dial pads MMSI with 0xffffffff.
  const mmsi =
    mmsiNum === 0xffffffff ? null : String(mmsiNum).padStart(9, '0').slice(-9)
  return {
    layout: 'v60-dial',
    kind: 'dial',
    manufacturerCode: man,
    manufacturer: MAN_LABELS[man] || String(man),
    address: buf[off + 2],
    family: buf.length > off + 5 ? buf[off + 5] : null,
    key: KEY_DIAL_MMSI,
    mmsi: mmsi,
    mmsiNumber: mmsiNum,
    eventName: 'DSC dial (MMSI)',
  }
}

function basePacket(n2k, buf) {
  return {
    pgn: n2k.pgn,
    src: n2k.src,
    dst: n2k.dst,
    prio: n2k.prio != null ? n2k.prio : null,
    rawHex: buf ? buf.toString('hex') : null,
    fields: n2k.fields || null,
  }
}

function looksLikeWorkingChannelSet(n2k, ourAddress) {
  if (!n2k || n2k.src === ourAddress) return false
  if (n2k.pgn !== 130845) return false
  if (n2k.dst !== ourAddress && n2k.dst !== 255) return false
  const buf = toBuf(n2k.data)
  if (!buf) return false
  const off = payloadOffset(buf)
  if (!workingChannelAt(buf, off)) return false
  return addrOk(buf, off, ourAddress)
}

function looksLikeDialRequest(n2k, ourAddress) {
  if (!n2k || n2k.src === ourAddress) return false
  if (n2k.pgn !== 130850) return false
  if (n2k.dst !== ourAddress && n2k.dst !== 255) return false
  const buf = toBuf(n2k.data)
  if (!buf) return false
  const off = payloadOffset(buf)
  if (!dialMmsiAt(buf, off)) return false
  return addrOk(buf, off, ourAddress)
}

function looksLikeInitDscCall(n2k, ourAddress) {
  if (!n2k || n2k.src === ourAddress) return false
  if (n2k.dst !== ourAddress && n2k.dst !== 255) return false
  const pgn = n2k.pgn
  if (pgn !== 126720 && pgn !== 130850 && pgn !== 130851) return false

  // Dial key 0x6F is not event-id 3.
  if (looksLikeDialRequest(n2k, ourAddress)) return false

  const fields = n2k.fields || {}
  if (Number(fields.Event) === EVENT_INIT_DSC_CALL) return true
  if (Number(fields['Event Id']) === EVENT_INIT_DSC_CALL) return true
  if (Number(fields.eventId) === EVENT_INIT_DSC_CALL) return true

  const buf = toBuf(n2k.data)
  if (!buf || buf.length < 3) return false

  if (simnetEventAt(buf, 0, ourAddress)) return true
  if (manEventAt(buf, 0)) return true
  if ((buf[0] & 0x1f) === 0 && buf.length >= 8) {
    if (simnetEventAt(buf, 2, ourAddress)) return true
    if (manEventAt(buf, 2)) return true
  }
  return false
}

function parseWorkingChannelPacket(n2k, ourAddress) {
  if (!looksLikeWorkingChannelSet(n2k, ourAddress)) return null
  const buf = toBuf(n2k.data)
  const off = payloadOffset(buf)
  const decoded = decodeWorkingChannelAt(buf, off)
  if (!decoded) return null
  const out = Object.assign(basePacket(n2k, buf), decoded)
  if (off === 2) {
    out.fastPacket = true
    out.fpLength = buf[1]
    out.fpSeq = (buf[0] >> 5) & 0x07
  }
  return out
}

function parseDialPacket(n2k, ourAddress) {
  if (!looksLikeDialRequest(n2k, ourAddress)) return null
  const buf = toBuf(n2k.data)
  const off = payloadOffset(buf)
  const decoded = decodeDialAt(buf, off)
  if (!decoded) return null
  const out = Object.assign(basePacket(n2k, buf), decoded)
  if (off === 2) {
    out.fastPacket = true
    out.fpLength = buf[1]
    out.fpSeq = (buf[0] >> 5) & 0x07
  }
  return out
}

/**
 * Decode an Init DSC Call (event id 3) frame for the webapp / status API.
 */
function parseInitDscPacket(n2k, ourAddress) {
  if (!looksLikeInitDscCall(n2k, ourAddress)) return null
  const buf = toBuf(n2k.data)
  const base = Object.assign(basePacket(n2k, buf), {
    kind: 'init-event',
    eventId: EVENT_INIT_DSC_CALL,
    eventName: 'Init DSC Call',
  })

  if (buf) {
    let decoded = decodeSimnetAt(buf, 0)
    if (!decoded) decoded = decodeLegacyAt(buf, 0)
    if (!decoded && (buf[0] & 0x1f) === 0 && buf.length >= 8) {
      decoded = decodeSimnetAt(buf, 2) || decodeLegacyAt(buf, 2)
      if (decoded) {
        decoded.fastPacket = true
        decoded.fpLength = buf[1]
        decoded.fpSeq = (buf[0] >> 5) & 0x07
      }
    }
    if (decoded) Object.assign(base, decoded)
  }

  const fields = n2k.fields || {}
  if (base.eventId == null) {
    const ev = Number(fields.Event || fields['Event Id'] || fields.eventId)
    if (ev === EVENT_INIT_DSC_CALL) base.eventId = ev
  }
  return base
}

function manIndustryBytes(manu) {
  const man = manu == null ? MAN_SIMRAD : manu
  const industry = 4
  const b0 = man & 0xff
  // Reserved bits 3–4 set (same packing as 130845 builder in fw).
  const b1 = ((man >> 8) & 0x07) | 0x18 | ((industry & 0x07) << 5)
  return Buffer.from([b0, b1])
}

/** Legacy event-id-3 reply (8 bytes). */
function buildEventReplyBytes(status, manu) {
  const head = manIndustryBytes(manu)
  return Buffer.from([
    head[0],
    head[1],
    EVENT_INIT_DSC_CALL,
    status & 0xff,
    0xff,
    0xff,
    0xff,
    0xff,
  ])
}

/**
 * Firmware dial ACK — FUN_0805215a (130851, 13 bytes):
 *   41 9f | addr | ff ff | 24 6f 00 | status | 00 00 00 | ff
 */
function buildDialReplyBytes(status, ourAddress, manu) {
  const head = manIndustryBytes(manu)
  const addr = ourAddress != null ? ourAddress & 0xff : 0xff
  return Buffer.from([
    head[0],
    head[1],
    addr,
    0xff,
    0xff,
    DIAL_FAMILY,
    KEY_DIAL_MMSI,
    0x00,
    status & 0xff,
    0x00,
    0x00,
    0x00,
    0xff,
  ])
}

/** Build the MFD→radio working-channel Set (14 bytes), as captured from Zeus. */
function buildWorkingChannelSetBytes(channel, manu) {
  const head = manIndustryBytes(manu)
  return Buffer.from([
    head[0],
    head[1],
    0xff,
    0xff,
    0xff,
    0xff,
    KEY_WORKING_CHANNEL_GROUP,
    KEY_WORKING_CHANNEL_PARAM,
    0x00,
    0x01, // Set
    channel & 0xff,
    0x00,
    0xff,
    0xff,
  ])
}

/** Build the MFD→radio dial frame (12+ bytes) with MMSI LE. */
function buildDialRequestBytes(mmsi, ourAddress, manu) {
  const head = manIndustryBytes(manu)
  const digits = parseOwnMmsi(mmsi) || String(mmsi || '').replace(/\D/g, '')
  const n = parseInt(digits.slice(0, 9) || '0', 10) >>> 0
  const addr = ourAddress != null ? ourAddress & 0xff : 0xff
  return Buffer.from([
    head[0],
    head[1],
    addr,
    0xff,
    0xff,
    DIAL_FAMILY,
    KEY_DIAL_MMSI,
    0x00,
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >> 24) & 0xff,
  ])
}

function eventReplyPgn(dst, status, src, manu) {
  const data = buildEventReplyBytes(status, manu)
  return {
    pgn: 130851,
    prio: 2,
    dst: dst,
    src: src,
    fields: {
      'Manufacturer Code': manu == null ? MAN_SIMRAD : manu,
      'Industry Code': 'Marine Industry',
      data: data,
    },
    data: data,
  }
}

function dialReplyPgn(dst, status, src, manu) {
  const data = buildDialReplyBytes(status, src, manu)
  return {
    pgn: 130851,
    prio: 2,
    dst: dst,
    src: src,
    fields: {
      'Manufacturer Code': manu == null ? MAN_SIMRAD : manu,
      'Industry Code': 'Marine Industry',
      data: data,
    },
    data: data,
  }
}

module.exports = {
  EVENT_INIT_DSC_CALL,
  STATUS,
  MAN_SIMRAD,
  MAN_NAVICO,
  MAN_BG,
  KEY_WORKING_CHANNEL_GROUP,
  KEY_WORKING_CHANNEL_PARAM,
  KEY_DIAL_MMSI,
  DIAL_FAMILY,
  parseOwnMmsi,
  decideStatus,
  looksLikeInitDscCall,
  looksLikeWorkingChannelSet,
  looksLikeDialRequest,
  parseInitDscPacket,
  parseWorkingChannelPacket,
  parseDialPacket,
  buildEventReplyBytes,
  buildDialReplyBytes,
  buildWorkingChannelSetBytes,
  buildDialRequestBytes,
  eventReplyPgn,
  dialReplyPgn,
}
