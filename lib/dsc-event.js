// NDP2k Init DSC Call = event id 3. MFDApp OnDSCCallEventReply accepts only that
// id; payload is one status byte (0..6).
//
// Wire framing still incomplete. Prefer dst==us + Simrad/B&G man + event id.
// shortcut: exact V50/V60 event layout unknown until a deliberate Call capture.

const EVENT_INIT_DSC_CALL = 3
const MAN_SIMRAD = 1857
const MAN_BG = 275

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

function manEventAt(buf, off) {
  if (buf.length < off + 3) return false
  const man = buf[off] | ((buf[off + 1] & 0x07) << 8)
  return (man === MAN_SIMRAD || man === MAN_BG) && buf[off + 2] === EVENT_INIT_DSC_CALL
}

function looksLikeInitDscCall(n2k, ourAddress) {
  if (!n2k || n2k.src === ourAddress) return false
  // Only addressed traffic — not broadcast chatter
  if (n2k.dst !== ourAddress) return false
  const pgn = n2k.pgn
  if (pgn !== 126720 && pgn !== 130850 && pgn !== 130851) return false

  const fields = n2k.fields || {}
  if (Number(fields.Event) === EVENT_INIT_DSC_CALL) return true
  if (Number(fields['Event Id']) === EVENT_INIT_DSC_CALL) return true
  if (Number(fields.eventId) === EVENT_INIT_DSC_CALL) return true

  const data = n2k.data
  if (!Buffer.isBuffer(data) && !Array.isArray(data)) return false
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (buf.length < 3) return false

  // Single / assembled: [manLo, manHi|industry, eventId, ...]
  // Do this before FP heuristics — manLo 0x41 looks like FP frame 1.
  if (manEventAt(buf, 0)) return true

  // Fast-packet first frame: [seq|frame=0][len][payload...]
  if ((buf[0] & 0x1f) === 0 && buf.length >= 5 && manEventAt(buf, 2)) return true

  return false
}

function buildEventReplyBytes(status) {
  const man = MAN_SIMRAD
  const industry = 4
  const b0 = man & 0xff
  const b1 = ((man >> 8) & 0x07) | ((industry & 0x07) << 5)
  return Buffer.from([b0, b1, EVENT_INIT_DSC_CALL, status & 0xff, 0xff, 0xff, 0xff, 0xff])
}

function eventReplyPgn(dst, status, src) {
  return {
    pgn: 126720,
    prio: 2,
    dst: dst,
    src: src,
    fields: {
      'Manufacturer Code': 'Simrad',
      'Industry Code': 'Marine Industry',
      data: buildEventReplyBytes(status),
    },
    data: buildEventReplyBytes(status),
  }
}

module.exports = {
  EVENT_INIT_DSC_CALL,
  STATUS,
  parseOwnMmsi,
  decideStatus,
  looksLikeInitDscCall,
  buildEventReplyBytes,
  eventReplyPgn,
}
