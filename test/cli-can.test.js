const { test } = require('node:test')
const assert = require('node:assert/strict')
const { encodeCanId } = require('../lib/cli-can')

test('PDU1 address claim 60928 broadcast from SA 25', function () {
  // prio 6, PF 0xEE, PS 0xFF, SA 0x19 → 0x18EEFF19
  assert.equal(encodeCanId(60928, 25, 255, 6), 0x18eeff19)
})

test('PDU1 ISO request 59904 to SA 25', function () {
  assert.equal(encodeCanId(59904, 7, 25, 6), 0x18ea1907)
})

test('PDU2 product info 126996 from SA 25', function () {
  // PGN 0x1F014, prio 6, SA 25 → 0x19F01419
  assert.equal(encodeCanId(126996, 25, 255, 6), 0x19f01419)
})
