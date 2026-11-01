const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createFastPacketAssembler } = require('../lib/fast-packet')
const {
  looksLikeWorkingChannelSet,
  looksLikeDialRequest,
  parseWorkingChannelPacket,
  parseDialPacket,
} = require('../lib/dsc-event')

test('reassembles live Zeus 130845 Call-confirm FP', function () {
  const fp = createFastPacketAssembler()
  assert.equal(
    fp.push({ pgn: 130845, src: 7, dst: 255, data: Buffer.from('200e419fffffffff', 'hex') }),
    null
  )
  assert.equal(
    fp.push({ pgn: 130845, src: 7, dst: 255, data: Buffer.from('2111ad00014300ff', 'hex') }),
    null
  )
  const msg = fp.push({
    pgn: 130845,
    src: 7,
    dst: 255,
    data: Buffer.from('22ffffffffffffff', 'hex'),
  })
  assert.ok(msg)
  assert.equal(msg.data.toString('hex'), '419fffffffff11ad00014300ffff')
  assert.equal(looksLikeWorkingChannelSet(msg, 25), true)
  const pkt = parseWorkingChannelPacket(msg, 25)
  assert.equal(pkt.channel, 67)
})

test('reassembles live Zeus 130850 dial FP with MMSI', function () {
  const fp = createFastPacketAssembler()
  assert.equal(
    fp.push({ pgn: 130850, src: 7, dst: 255, data: Buffer.from('400c419fffffff24', 'hex') }),
    null
  )
  const msg = fp.push({
    pgn: 130850,
    src: 7,
    dst: 255,
    data: Buffer.from('416f0040078d0eff', 'hex'),
  })
  assert.ok(msg)
  assert.equal(msg.data.toString('hex'), '419fffffff246f0040078d0e')
  assert.equal(looksLikeDialRequest(msg, 25), true)
  const pkt = parseDialPacket(msg, 25)
  assert.equal(pkt.mmsi, '244123456')
})

test('passes through single-frame proprietary unchanged', function () {
  const fp = createFastPacketAssembler()
  const data = Buffer.from([0x41, 0x9f, 0x03, 0x00, 0xff, 0xff, 0xff, 0xff])
  const msg = fp.push({ pgn: 130850, src: 7, dst: 25, data: data })
  assert.ok(msg)
  assert.equal(msg.data, data)
})
