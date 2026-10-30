// B&G V60 / V50 / Simrad RS* family identity for NMEA 2000.
// MFDApp DeviceMatcher / CheckIfDSCCallIsSupported looks for Navico-family VHF;
// Model ID "V60" is in the product-name table in MFDApp 66.1.9 (also V50, V60B, …).

const DEFAULTS = {
  preferredAddress: 25,
  uniqueNumber: 0x1a5001,
  // Simrad manufacturer (1857). B&G VHF shares the Simrad radio stack.
  manufacturerCode: 'Simrad',
  // Class 70 Communication, function 190 Radiotelephone ("VHF Radio" in MFDApp).
  deviceClass: 'Communication',
  deviceFunction: 190,
  productCode: 22150,
  // MFDApp product-name table includes V50 and V60; default V50 (what Settings shows).
  modelId: 'V50',
  softwareVersion: '1.02.00.00',
  modelVersion: 'V50',
  modelSerial: 'LABV50001',
  nmea2000Version: 2100,
  ownMmsi: '244060123',
  dscEnabled: true,
  autoReplyStatus: 0,
}

function addressClaim(opts) {
  return {
    pgn: 60928,
    dst: 255,
    'Unique Number': opts.uniqueNumber,
    'Manufacturer Code': opts.manufacturerCode,
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

function mergeOptions(raw) {
  const opts = Object.assign({}, DEFAULTS, raw || {})
  opts.uniqueNumber = Number(opts.uniqueNumber) || DEFAULTS.uniqueNumber
  opts.preferredAddress = Number(opts.preferredAddress) || DEFAULTS.preferredAddress
  opts.productCode = Number(opts.productCode) || DEFAULTS.productCode
  opts.deviceFunction = Number(opts.deviceFunction) || DEFAULTS.deviceFunction
  opts.autoReplyStatus = Number(opts.autoReplyStatus)
  if (Number.isNaN(opts.autoReplyStatus)) opts.autoReplyStatus = 0
  opts.dscEnabled = opts.dscEnabled !== false
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
  REPLY_STATUS,
  addressClaim,
  productInfo,
  mergeOptions,
}
