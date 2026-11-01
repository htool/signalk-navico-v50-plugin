// NDP2k Init DSC Call = event id 3. MFDApp OnDSCCallEventReply accepts only that
// id; payload is one status byte (0..6).
//
// CERTAIN (canboat navico_alarms_and_commands + lab cansend/bus RX):
//   PGN 130850 Event Command (RX), 130851 Event Reply (TX).
//   Simnet payload: man|ind, address, reserved, display group, event id, command…
// Target MMSI / working channel are carried in the MFD UI confirm dialog; the
// short 8-byte event command we match does not itself embed a 9-digit MMSI.

const EVENT_INIT_DSC_CALL = 3
const MAN_SIMRAD = 1857
const MAN_NAVICO = 275
const MAN_BG = 381 // canboat "B&G"

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

/** Legacy test layout: event id immediately after man bytes. */
function manEventAt(buf, off) {
  return manOk(buf, off) && buf.length >= off + 3 && buf[off + 2] === EVENT_INIT_DSC_CALL
}

/**
 * CERTAIN (canboat navico_alarms_and_commands / live MFD 130850):
 *   [0..1] man|ind
 *   [2]    address (0xff = broadcast)
 *   [3]    reserved
 *   [4]    display group
 *   [5]    command type / event id  ← Init DSC Call = 3
 *   [6]    command
 */
function simnetEventAt(buf, off, ourAddress) {
  if (!manOk(buf, off) || buf.length < off + 6) return false
  if (buf[off + 5] !== EVENT_INIT_DSC_CALL) return false
  const addr = buf[off + 2]
  return addr === ourAddress || addr === 0xff
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

function decodeSimnetAt(buf, off) {
  if (!manOk(buf, off) || buf.length < off + 6) return null
  const man = buf[off] | ((buf[off + 1] & 0x07) << 8)
  return {
    layout: 'simnet',
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
  const man = buf[off] | ((buf[off + 1] & 0x07) << 8)
  return {
    layout: 'legacy-short',
    manufacturerCode: man,
    manufacturer: MAN_LABELS[man] || String(man),
    eventId: buf[off + 2],
    statusOrCommand: buf.length > off + 3 ? buf[off + 3] : null,
  }
}

/**
 * Decode an Init DSC Call frame for the webapp / status API.
 * Returns null if the frame is not an Init DSC Call for ourAddress.
 */
function parseInitDscPacket(n2k, ourAddress) {
  if (!looksLikeInitDscCall(n2k, ourAddress)) return null
  const buf = toBuf(n2k.data)
  const base = {
    pgn: n2k.pgn,
    src: n2k.src,
    dst: n2k.dst,
    prio: n2k.prio != null ? n2k.prio : null,
    eventId: EVENT_INIT_DSC_CALL,
    eventName: 'Init DSC Call',
    rawHex: buf ? buf.toString('hex') : null,
    fields: n2k.fields || null,
  }

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

function looksLikeInitDscCall(n2k, ourAddress) {
  if (!n2k || n2k.src === ourAddress) return false
  // MFD Init DSC Call is PDU2 broadcast (dst 255) with target in payload byte 2.
  if (n2k.dst !== ourAddress && n2k.dst !== 255) return false
  const pgn = n2k.pgn
  if (pgn !== 126720 && pgn !== 130850 && pgn !== 130851) return false

  const fields = n2k.fields || {}
  if (Number(fields.Event) === EVENT_INIT_DSC_CALL) return true
  if (Number(fields['Event Id']) === EVENT_INIT_DSC_CALL) return true
  if (Number(fields.eventId) === EVENT_INIT_DSC_CALL) return true

  const buf = toBuf(n2k.data)
  if (!buf || buf.length < 3) return false

  // Assembled / single-frame Simnet layout (event at byte 5).
  if (simnetEventAt(buf, 0, ourAddress)) return true
  // Legacy short layout used in unit tests (event at byte 2).
  if (manEventAt(buf, 0)) return true

  // Fast-packet first frame: [seq|frame=0][len][6 payload bytes...]
  if ((buf[0] & 0x1f) === 0 && buf.length >= 8) {
    if (simnetEventAt(buf, 2, ourAddress)) return true
    if (manEventAt(buf, 2)) return true
  }

  return false
}

function buildEventReplyBytes(status, manu) {
  // CERTAIN (V60B fw): proprietary Simnet PGNs use Simrad 0x41 0x9f, not B&G.
  const man = manu == null ? MAN_SIMRAD : manu
  const industry = 4
  const b0 = man & 0xff
  // Reserved bits 3–4 set (same packing as 130845 builder in fw).
  const b1 = ((man >> 8) & 0x07) | 0x18 | ((industry & 0x07) << 5)
  return Buffer.from([b0, b1, EVENT_INIT_DSC_CALL, status & 0xff, 0xff, 0xff, 0xff, 0xff])
}

function eventReplyPgn(dst, status, src, manu) {
  // CERTAIN (V60/V60-B user guide ch.13): Event Reply = 130851 (TX), Event Command = 130850 (RX).
  const man = manu == null ? MAN_SIMRAD : manu
  const data = buildEventReplyBytes(status, man)
  return {
    pgn: 130851,
    prio: 2,
    dst: dst,
    src: src,
    fields: {
      'Manufacturer Code': man,
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
  parseOwnMmsi,
  decideStatus,
  looksLikeInitDscCall,
  parseInitDscPacket,
  buildEventReplyBytes,
  eventReplyPgn,
}
