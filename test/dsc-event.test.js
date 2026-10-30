const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  decideStatus,
  looksLikeInitDscCall,
  buildEventReplyBytes,
  STATUS,
  EVENT_INIT_DSC_CALL,
} = require('../lib/dsc-event')

test('decideStatus OK with MMSI', function () {
  assert.equal(decideStatus({ dscEnabled: true, ownMmsi: '244060123', autoReplyStatus: 0 }, { mmsi: '244123456', channel: 16 }), STATUS.OK)
})

test('decideStatus disabled', function () {
  assert.equal(decideStatus({ dscEnabled: false, ownMmsi: '244060123' }, {}), STATUS.DSC_DISABLED)
})

test('looksLikeInitDscCall finds event id 3 addressed', function () {
  // Simrad man 1857 packed as 41 9f — manLo 0x41 must not be treated as FP frame 1
  const data = Buffer.from([0x41, 0x9f, 0x03, 0x00, 0xff, 0xff, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), true)
})

test('looksLikeInitDscCall finds event id 3 in FP first frame', function () {
  const data = Buffer.from([0x40, 0x08, 0x41, 0x9f, 0x03, 0x00, 0xff, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), true)
})

test('ignores Simrad proprietary without event 3', function () {
  const data = Buffer.from([0x41, 0x9f, 0xff, 0xff, 0xff, 0xff, 0xf1, 0xff])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 1, dst: 25, data: data }, 25), false)
})

test('ignores broadcast 126720 chatter', function () {
  const data = Buffer.from([0x01, 0x03, 0x00, 0x44, 0x00, 0x03, 0x02, 0x06])
  assert.equal(looksLikeInitDscCall({ pgn: 126720, src: 22, dst: 255, data: data }, 25), false)
})

test('reply bytes carry event id + status', function () {
  const b = buildEventReplyBytes(4)
  assert.equal(b[2], EVENT_INIT_DSC_CALL)
  assert.equal(b[3], 4)
})
