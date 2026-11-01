// PGN 129799 Radio Frequency/Mode/Power — V50/V60 TX list (manual ch.13).
// CERTAIN: listed as TX on V50/V60. INFERRED: helps MFD see a live VHF, not Own MMSI.

const { toPgn } = require('@canboat/canboatjs')

// Ch 16 simplex DSC voice — international marine VHF
const CH16_HZ = 156800000

function buildRadioStatusFields(channel) {
  const ch = String(channel == null ? 16 : channel)
  return {
    'Rx Frequency': CH16_HZ,
    'Tx Frequency': CH16_HZ,
    'Radio Channel': ch,
    'Tx Power': 25,
    Mode: 0,
    'Channel Bandwidth': 25000,
  }
}

function radioStatusPgn(src, channel) {
  const fields = buildRadioStatusFields(channel)
  const msg = {
    pgn: 129799,
    prio: 6,
    dst: 255,
    src: src,
    fields: fields,
  }
  const data = toPgn(msg)
  if (!data) throw new Error('toPgn 129799 failed')
  msg.data = data
  return msg
}

module.exports = {
  CH16_HZ,
  buildRadioStatusFields,
  radioStatusPgn,
}
