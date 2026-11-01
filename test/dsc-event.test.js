const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  decideStatus,
  looksLikeInitDscCall,
  parseInitDscPacket,
  buildEventReplyBytes,
  STATUS,
  EVENT_INIT_DSC_CALL,
} = require('../lib/dsc-event')

test('decideStatus OK with MMSI', function () {
  assert.equal(decideStatus({ dscEnabled: true, ownMmsi: '244999001', autoReplyStatus: 0 }, { mmsi: '244123456', channel: 16 }), STATUS.OK)
})

test('decideStatus disabled', function () {
  assert.equal(decideStatus({ dscEnabled: false, ownMmsi: '244999001' }, {}), STATUS.DSC_DISABLED)
})

test('looksLikeInitDscCall finds event id 3 addressed (legacy short layout)', function () {
  // Simrad man 1857 packed as 41 9f — manLo 0x41 must not be treated as FP frame 1
  const data = Buffer.from([0x41, 0x9f, 0x03, 0x00, 0xff, 0xff, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), true)
})

test('looksLikeInitDscCall finds Simnet event id 3 at byte 5 (broadcast)', function () {
  // Live MFD 130850 is PDU2 dst=255; target address in payload[2]
  const data = Buffer.from([0x41, 0x9f, 25, 0xff, 0xff, 0x03, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 130850, src: 7, dst: 255, data: data }, 25), true)
})

test('looksLikeInitDscCall finds event id 3 in FP first frame', function () {
  const data = Buffer.from([0x40, 0x08, 0x41, 0x9f, 0x03, 0x00, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), true)
})

test('ignores Simrad AIS family 130850 (type 0x24)', function () {
  const data = Buffer.from([0x41, 0x9f, 0xff, 0xff, 0xff, 0x24, 0x6f, 0x00, 0xff, 0xff, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 130850, src: 7, dst: 255, data: data }, 25), false)
})

test('ignores Simrad proprietary without event 3', function () {
  const data = Buffer.from([0x41, 0x9f, 0xff, 0xff, 0xff, 0xff, 0xf1, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), false)
})

test('ignores unrelated broadcast chatter', function () {
  const data = Buffer.from([0x01, 0x03, 0x00, 0x44, 0x00, 0x03, 0x02, 0x06])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 22, dst: 255, data: data }, 25), false)
})

test('reply bytes carry Simrad manu + event id + status', function () {
  const b = buildEventReplyBytes(4)
  assert.equal(b[0], 0x41)
  assert.equal(b[1], 0x9f)
  assert.equal(b[2], EVENT_INIT_DSC_CALL)
  assert.equal(b[3], 4)
})

test('parseInitDscPacket decodes Simnet broadcast event 3', function () {
  const data = Buffer.from([0x41, 0x9f, 25, 0xff, 0xff, 0x03, 0x00, 0xff])
  const pkt = parseInitDscPacket({ pgn: 130850, src: 7, dst: 255, data: data }, 25)
  assert.ok(pkt)
  assert.equal(pkt.eventId, 3)
  assert.equal(pkt.eventName, 'Init DSC Call')
  assert.equal(pkt.layout, 'simnet')
  assert.equal(pkt.manufacturerCode, 1857)
  assert.equal(pkt.address, 25)
  assert.equal(pkt.command, 0)
  assert.equal(pkt.rawHex, data.toString('hex'))
  assert.equal(pkt.pgn, 130850)
  assert.equal(pkt.src, 7)
  assert.equal(pkt.dst, 255)
})

test('parseInitDscPacket returns null for AIS type 0x24', function () {
  const data = Buffer.from([0x41, 0x9f, 0xff, 0xff, 0xff, 0x24, 0x6f, 0x00])
  assert.equal(parseInitDscPacket({ pgn: 130850, src: 7, dst: 255, data: data }, 25), null)
})
