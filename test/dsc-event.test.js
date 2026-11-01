const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
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
  STATUS,
  EVENT_INIT_DSC_CALL,
  KEY_DIAL_MMSI,
} = require('../lib/dsc-event')

test('decideStatus OK with MMSI', function () {
  assert.equal(decideStatus({ dscEnabled: true, ownMmsi: '244999001', autoReplyStatus: 0 }, { mmsi: '244123456', channel: 16 }), STATUS.OK)
})

test('decideStatus disabled', function () {
  assert.equal(decideStatus({ dscEnabled: false, ownMmsi: '244999001' }, {}), STATUS.DSC_DISABLED)
})

test('looksLikeInitDscCall finds event id 3 addressed (legacy short layout)', function () {
  const data = Buffer.from([0x41, 0x9f, 0x03, 0x00, 0xff, 0xff, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), true)
})

test('looksLikeInitDscCall finds Simnet event id 3 at byte 5 (broadcast)', function () {
  const data = Buffer.from([0x41, 0x9f, 25, 0xff, 0xff, 0x03, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 130850, src: 7, dst: 255, data: data }, 25), true)
})

test('looksLikeInitDscCall finds event id 3 in FP first frame', function () {
  const data = Buffer.from([0x40, 0x08, 0x41, 0x9f, 0x03, 0x00, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), true)
})

test('dial frame is not event-id-3 Init', function () {
  const data = Buffer.from([0x41, 0x9f, 0xff, 0xff, 0xff, 0x24, 0x6f, 0x00, 0x40, 0x0e, 0x8c, 0x0e])
  assert.equal(looksLikeInitDscCall({ pgn: 130850, src: 7, dst: 255, data: data }, 25), false)
  assert.equal(looksLikeDialRequest({ pgn: 130850, src: 7, dst: 255, data: data }, 25), true)
})

test('ignores Simrad proprietary without event 3 or dial key', function () {
  const data = Buffer.from([0x41, 0x9f, 0xff, 0xff, 0xff, 0xff, 0xf1, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), false)
  assert.equal(looksLikeDialRequest({ pgn: 130850, src: 1, dst: 255, data: data }, 25), false)
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

test('dial reply matches firmware FUN_0805215a layout', function () {
  const b = buildDialReplyBytes(0, 25)
  assert.equal(b.length, 13)
  assert.equal(b[0], 0x41)
  assert.equal(b[1], 0x9f)
  assert.equal(b[2], 25)
  assert.equal(b[5], 0x24)
  assert.equal(b[6], KEY_DIAL_MMSI)
  assert.equal(b[7], 0)
  assert.equal(b[8], 0)
  assert.equal(b[12], 0xff)
})

test('parseInitDscPacket decodes Simnet broadcast event 3', function () {
  const data = Buffer.from([0x41, 0x9f, 25, 0xff, 0xff, 0x03, 0x00, 0xff])
  const pkt = parseInitDscPacket({ pgn: 130850, src: 7, dst: 255, data: data }, 25)
  assert.ok(pkt)
  assert.equal(pkt.eventId, 3)
  assert.equal(pkt.eventName, 'Init DSC Call')
  assert.equal(pkt.layout, 'simnet-event3')
  assert.equal(pkt.manufacturerCode, 1857)
  assert.equal(pkt.address, 25)
  assert.equal(pkt.command, 0)
  assert.equal(pkt.rawHex, data.toString('hex'))
  assert.equal(pkt.pgn, 130850)
  assert.equal(pkt.src, 7)
  assert.equal(pkt.dst, 255)
})

test('parseInitDscPacket returns null for dial frame', function () {
  const data = Buffer.from([0x41, 0x9f, 0xff, 0xff, 0xff, 0x24, 0x6f, 0x00, 0x40, 0x0e, 0x8c, 0x0e])
  assert.equal(parseInitDscPacket({ pgn: 130850, src: 7, dst: 255, data: data }, 25), null)
})

test('live Call-confirm 130845 stashes channel 67', function () {
  // Captured Zeus confirm: 41 9f ff ff ff ff 11 ad 00 01 43 00 ff ff
  const data = Buffer.from('419fffffffff11ad00014300ffff', 'hex')
  assert.equal(looksLikeWorkingChannelSet({ pgn: 130845, src: 7, dst: 255, data: data }, 25), true)
  const pkt = parseWorkingChannelPacket({ pgn: 130845, src: 7, dst: 255, data: data }, 25)
  assert.ok(pkt)
  assert.equal(pkt.kind, 'working-channel')
  assert.equal(pkt.channel, 0x43)
  assert.equal(pkt.keyGroup, 0x11)
  assert.equal(pkt.keyParam, 0xad)
  assert.equal(pkt.operation, 1)
})

test('parseDialPacket reads MMSI LE', function () {
  const data = buildDialRequestBytes('244123456', 25)
  assert.equal(looksLikeDialRequest({ pgn: 130850, src: 7, dst: 255, data: data }, 25), true)
  const pkt = parseDialPacket({ pgn: 130850, src: 7, dst: 255, data: data }, 25)
  assert.ok(pkt)
  assert.equal(pkt.kind, 'dial')
  assert.equal(pkt.mmsi, '244123456')
  assert.equal(pkt.key, 0x6f)
})

test('buildWorkingChannelSetBytes matches live layout', function () {
  const b = buildWorkingChannelSetBytes(67)
  assert.equal(b.toString('hex'), '419fffffffff11ad00014300ffff')
})
