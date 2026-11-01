// Simnet Parameter Handle (PGN 130845) — V60B firmware (NV621 / SW 4.60).
//
// CERTAIN from Ghidra on SW_VHF_V60B_V4.60_AIS_V4.58.swup (FUN @ 0x08052060):
//   - Radio TXes 130845 with Simrad manufacturer bytes 0x41 0x9f (1857), even on V60B.
//   - Frame is 14 bytes; value is a single byte — not a 32-bit Own MMSI.
//   - Layout:
//       [0..1]  man|ind = 41 9f
//       [2]     address = 0xff
//       [3]     repeat  = 0x00
//       [4]     display group = 1..7 or 0xff
//       [5]     reserved = 0xff
//       [6]     0xff
//       [7]     key (param id) — callers use 0x12 and 0x26
//       [8]     0x00
//       [9]     0x01  (report)
//       [10]    value (u8)
//       [11..13] 0x00
//   - Own MMSI is NOT published as a 130845 u32 in this firmware; Call still
//     needs a local/ownMmsi string for DSC status + MFD Settings.ini MMSI=.
// INFERRED: keep emitting the live keys so the MFD sees VHF param traffic.

const MAN_SIMRAD = 1857
const INDUSTRY = 4

// Keys observed as r0 to FUN_08052060 (0x12, 0x26). Lab bus also shows MFD
// TX key 0x25 on 130845 (src 7) — include it so we answer the same set.
const LIVE_KEYS = [
  { key: 0x12, displayGroup: 1, value: 0 },
  { key: 0x25, displayGroup: 1, value: 0 },
  { key: 0x26, displayGroup: 1, value: 4 },
]

function parseOwnMmsi(mmsi) {
  const digits = String(mmsi || '').replace(/\D/g, '')
  if (digits.length < 9) return null
  return parseInt(digits.slice(0, 9), 10)
}

function manIndustryBytes() {
  // Match firmware: reserved bits 3–4 set → 0x9f for Simrad+Marine.
  const b0 = MAN_SIMRAD & 0xff
  const b1 = ((MAN_SIMRAD >> 8) & 0x07) | 0x18 | ((INDUSTRY & 0x07) << 5)
  return Buffer.from([b0, b1])
}

/**
 * Build one firmware-accurate 130845 Parameter Handle payload (14 bytes).
 */
function buildKeyValuePayload(opts) {
  const key = (opts.key != null ? opts.key : 0x12) & 0xff
  let dg = opts.displayGroup
  if (dg == null) dg = 0xff
  else {
    dg = dg & 0xff
    if (dg === 0 || dg >= 8) dg = 0xff
  }
  const value = (opts.value != null ? opts.value : 0) & 0xff
  const head = manIndustryBytes()
  return Buffer.concat([
    head,
    Buffer.from([
      0xff, // address
      0x00, // repeat
      dg,
      0xff, // reserved
      0xff,
      key,
      0x00,
      0x01, // report
      value,
      0x00,
      0x00,
      0x00,
    ]),
  ])
}

function ownMmsiParamPgns(src, _ownMmsi) {
  // ownMmsi intentionally unused on the wire (CERTAIN: not a 130845 u32).
  const out = []
  for (const k of LIVE_KEYS) {
    const data = buildKeyValuePayload(k)
    out.push({
      pgn: 130845,
      prio: 6,
      dst: 255,
      src: src,
      data: data,
      fields: { key: k.key, value: k.value, displayGroup: k.displayGroup },
    })
  }
  return out
}

module.exports = {
  MAN_SIMRAD,
  LIVE_KEYS,
  parseOwnMmsi,
  buildKeyValuePayload,
  ownMmsiParamPgns,
}
