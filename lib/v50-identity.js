// B&G V60 / V50 / Simrad RS* family identity for NMEA 2000.
// MFDApp DeviceMatcher / CheckIfDSCCallIsSupported looks for Navico-family VHF;
// Model ID "V60"/"V50"/"V60B" are in the product-name table in MFDApp 66.1.9.
//
// CERTAIN from official SW_VHF_V60B_V4.60_AIS_V4.58.swup:
//   Product Name="V60B" Id="30041" SerialBitLength="15"
//   DeviceClass="70" DeviceFunction="190" NumberGroup="2"
//   Firmware UI string "V60-B"; SREC banner "NV621".

// NMEA manufacturer codes (canboat codesMfgs.json).
const MANU_BG = 381
const MANU_SIMRAD = 1857

const PRESETS = {
  V60B: {
    modelId: 'V60B',
    modelVersion: 'V60B',
    productCode: 30041,
    softwareVersion: '4.60.00.00',
    // 15-bit serial (swup SerialBitLength); keep decimal digits only.
    modelSerial: '12345',
    navicoBarcode: '12345',
    serialBitLength: 15,
    numberGroup: 2,
    // V60B is a B&G radio — DeviceMatcher ManCode should be B&G, not Simrad.
    manufacturerCode: MANU_BG,
  },
  V50: {
    modelId: 'V50',
    modelVersion: 'V50',
    // product code for V50 not in the V60B swup; lab used 22150 previously.
    productCode: 22150,
    softwareVersion: '1.02.00.00',
    modelSerial: '12345',
    navicoBarcode: '12345',
    serialBitLength: 15,
    numberGroup: 2,
    manufacturerCode: MANU_BG,
  },
  // Simrad-branded twins (RS40B etc.) if needed later.
  RS40B: {
    modelId: 'RS40B',
    modelVersion: 'RS40B',
    productCode: 30041,
    softwareVersion: '4.60.00.00',
    modelSerial: '12345',
    navicoBarcode: '12345',
    serialBitLength: 15,
    numberGroup: 2,
    manufacturerCode: MANU_SIMRAD,
  },
}

const DEFAULTS = Object.assign(
  {
    preferredAddress: 25,
    // Must match modelSerial within SerialBitLength (15) — DeviceMatcher NavicoBarcode.
    uniqueNumber: 12345,
    manufacturerCode: MANU_BG,
    // Class 70 Communication, function 190 Radiotelephone ("VHF Radio" in MFDApp).
    deviceClass: 'Communication',
    deviceFunction: 190,
    nmea2000Version: 2100,
    // Empty = use vessels.self.mmsi from Signal K at dial time.
    ownMmsi: '',
    dscEnabled: true,
    autoReplyStatus: 0,
    // Forward OK dials via PUT communication.vhf.dsc.call
    forwardDscToSignalk: true,
  },
  // Default to V60B — identity confirmed by official .swup (Id 30041 / class 70 / fn 190).
  PRESETS.V60B
)

function manufacturerCodeNum(code) {
  if (typeof code === 'number' && Number.isFinite(code)) return code & 0x7ff
  const s = String(code || '').toLowerCase()
  if (s === 'b&g' || s === 'bandg' || s === '381') return MANU_BG
  if (s === 'simrad' || s === '1857') return MANU_SIMRAD
  if (s === 'navico' || s === '275') return 275
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n & 0x7ff : MANU_BG
}

/** Raw 60928 NAME — avoid canboat string 'B&G' encoding quirks. */
function addressClaimBytes(opts) {
  const unique = Number(opts.uniqueNumber) & 0x1fffff
  const manu = manufacturerCodeNum(opts.manufacturerCode)
  const fn = Number(opts.deviceFunction) & 0xff
  // Device class 70 = Communication (NMEA enum; canboat uses name string).
  const cls = 70
  const industry = 4 // Marine
  let n = BigInt(unique)
  n |= BigInt(manu) << 21n
  n |= BigInt(fn) << 40n
  n |= 1n << 48n // reserved
  n |= BigInt(cls) << 49n
  n |= BigInt(industry) << 60n
  // Match canboat's top reserved bit observed on live Simrad/B&G claims (byte7 0xC0).
  n |= 1n << 63n
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(n)
  return buf
}

function addressClaim(opts) {
  return {
    pgn: 60928,
    dst: 255,
    data: addressClaimBytes(opts),
    'Unique Number': opts.uniqueNumber,
    'Manufacturer Code': manufacturerCodeNum(opts.manufacturerCode),
    'Device Function': opts.deviceFunction,
    'Device Class': opts.deviceClass,
    'Device Instance Lower': 0,
    'Device Instance Upper': 0,
    'System Instance': 0,
    'Industry Group': 'Marine',
    Reserved1: 1,
    Reserved2: 2,
  }
}

function productInfo(opts) {
  return {
    pgn: 126996,
    dst: 255,
    'NMEA 2000 Version': opts.nmea2000Version,
    'Product Code': opts.productCode,
    'Model ID': opts.modelId,
    'Software Version Code': opts.softwareVersion,
    'Model Version': opts.modelVersion,
    'Model Serial Code': opts.modelSerial,
    'Certification Level': 2,
    'Load Equivalency': 1,
  }
}

function ascii32(s) {
  const out = Buffer.alloc(32, 0) // Navico Model ID match wants NUL pad, not 0xFF
  Buffer.from(String(s || ''), 'ascii').copy(out, 0, 0, 32)
  return out
}

/** Raw 126996 payload — canboat toPgn 0xFF-pads STRING_FIX and breaks MFD Model ID match. */
function productInfoBytes(opts) {
  const buf = Buffer.alloc(134, 0)
  buf.writeUInt16LE(Number(opts.nmea2000Version) || 2100, 0)
  buf.writeUInt16LE(Number(opts.productCode) || 0, 2)
  ascii32(opts.modelId).copy(buf, 4)
  ascii32(opts.softwareVersion).copy(buf, 36)
  ascii32(opts.modelVersion).copy(buf, 68)
  ascii32(opts.modelSerial).copy(buf, 100)
  buf[132] = 2 // Certification Level
  buf[133] = 1 // Load Equivalency
  return buf
}

function mergeOptions(raw) {
  raw = raw || {}
  const presetName = String(raw.preset || raw.modelId || process.env.VHF_MODEL || 'V60B')
    .replace(/-/g, '')
    .toUpperCase()
  const preset = PRESETS[presetName] || PRESETS.V60B
  const opts = Object.assign({}, DEFAULTS, preset, raw)
  if (opts.modelId === 'V60-B') opts.modelId = 'V60B'
  opts.uniqueNumber = Number(opts.uniqueNumber) || DEFAULTS.uniqueNumber
  opts.preferredAddress = Number(opts.preferredAddress) || DEFAULTS.preferredAddress
  opts.productCode = Number(opts.productCode) || preset.productCode
  opts.deviceFunction = Number(opts.deviceFunction) || DEFAULTS.deviceFunction
  opts.autoReplyStatus = Number(opts.autoReplyStatus)
  if (Number.isNaN(opts.autoReplyStatus)) opts.autoReplyStatus = 0
  opts.dscEnabled = opts.dscEnabled !== false
  opts.forwardDscToSignalk = opts.forwardDscToSignalk !== false
  // Clamp model serial to SerialBitLength digits when known (NavicoBarcode width).
  // DeviceMatcher compares NavicoBarcode (from NAME unique#) to Model Serial Code.
  const bits = Number(opts.serialBitLength) || 15
  const maxSerial = (1 << bits) - 1
  const serialDigits = String(opts.modelSerial || '').replace(/\D/g, '')
  if (serialDigits) {
    const n = Math.min(parseInt(serialDigits, 10) || 0, maxSerial)
    opts.modelSerial = String(n)
    opts.navicoBarcode = opts.modelSerial
    // Keep NAME uniqueNumber in the same SerialBitLength window (INFERRED match key).
    if (!raw.uniqueNumber) opts.uniqueNumber = n
  }
  return opts
}

const REPLY_STATUS = {
  0: 'OK (silent success)',
  1: 'DSC function is disabled',
  2: 'Radio is busy',
  3: 'Call in progress',
  4: 'Own MMSI is not set',
  5: 'Invalid MMSI',
  6: 'Invalid channel',
}

module.exports = {
  DEFAULTS,
  PRESETS,
  MANU_BG,
  MANU_SIMRAD,
  REPLY_STATUS,
  manufacturerCodeNum,
  addressClaim,
  addressClaimBytes,
  productInfo,
  productInfoBytes,
  mergeOptions,
}
