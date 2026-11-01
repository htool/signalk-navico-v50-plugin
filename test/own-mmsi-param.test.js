const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildKeyValuePayload,
  ownMmsiParamPgns,
  parseOwnMmsi,
  MAN_SIMRAD,
} = require('../lib/own-mmsi-param')
const { radioStatusPgn } = require('../lib/radio-status')

test('parseOwnMmsi', function () {
  assert.equal(parseOwnMmsi('244999001'), 244999001)
  assert.equal(parseOwnMmsi('12'), null)
})

test('buildKeyValuePayload matches V60B firmware layout', function () {
  const buf = buildKeyValuePayload({ key: 0x12, displayGroup: 1, value: 0 })
  assert.equal(buf.length, 14)
  assert.equal(buf[0], MAN_SIMRAD & 0xff) // 0x41
  assert.equal(buf[1], 0x9f)
  assert.equal(buf[2], 0xff)
  assert.equal(buf[3], 0x00)
  assert.equal(buf[4], 0x01)
  assert.equal(buf[7], 0x12)
  assert.equal(buf[9], 0x01)
  assert.equal(buf[10], 0x00)
})

test('ownMmsiParamPgns emits 130845 live keys', function () {
  const list = ownMmsiParamPgns(25, '999001234')
  assert.ok(list.length >= 2)
  assert.equal(list[0].pgn, 130845)
  assert.equal(list[0].src, 25)
  assert.equal(list[0].data[0], 0x41)
})

test('radioStatusPgn encodes 129799', function () {
  const msg = radioStatusPgn(25, 16)
  assert.equal(msg.pgn, 129799)
  assert.ok(Buffer.isBuffer(msg.data))
  assert.ok(msg.data.length >= 8)
})
