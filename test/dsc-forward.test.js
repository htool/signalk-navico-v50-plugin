const test = require('node:test')
const assert = require('node:assert/strict')
const { createRadio } = require('../lib/v50-radio')

test('OK dial forwards DSC call via putSelfPath', async () => {
  const puts = []
  const app = {
    putSelfPath (path, value, cb) {
      puts.push({ path, value })
      process.nextTick(() => cb({ state: 'COMPLETED', statusCode: 200 }))
    },
    emit () {},
  }
  const radio = createRadio(app, {
    canDevice: 'none',
    forwardDscToSignalk: true,
    ownMmsi: '244999001',
    dscEnabled: true,
    autoReplyStatus: 0,
  })
  // Avoid opening can — only exercise simulateCall → sendDialReply → forward.
  radio.stop()
  const call = radio.simulateCall({ mmsi: '244123456', channel: 8 })
  assert.equal(call.replyStatus, 0)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(puts.length, 1)
  assert.equal(puts[0].path, 'communication.vhf.dsc.call')
  assert.deepEqual(puts[0].value, {
    mmsi: '244123456',
    channel: 8,
    type: 'individual',
    category: 'routine',
  })
  const st = radio.getState()
  assert.equal(st.lastDscForward.ok, true)
  assert.equal(st.lastDscForward.mmsi, '244123456')
})

test('forwardDscToSignalk false skips PUT', async () => {
  const puts = []
  const app = {
    putSelfPath (path, value, cb) {
      puts.push({ path, value })
      cb({ state: 'COMPLETED', statusCode: 200 })
    },
    emit () {},
  }
  const radio = createRadio(app, {
    canDevice: 'none',
    forwardDscToSignalk: false,
    ownMmsi: '244999001',
    dscEnabled: true,
    autoReplyStatus: 0,
  })
  radio.stop()
  radio.simulateCall({ mmsi: '244123456', channel: 16 })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(puts.length, 0)
})

test('blank ownMmsi uses vessels.self.mmsi from Signal K', () => {
  const app = {
    getSelfPath (path) {
      assert.equal(path, 'mmsi')
      return { value: '244670524' }
    },
    emit () {},
  }
  const radio = createRadio(app, {
    canDevice: 'none',
    ownMmsi: '',
    dscEnabled: true,
    autoReplyStatus: 0,
    forwardDscToSignalk: false,
  })
  radio.stop()
  const st = radio.getState()
  assert.equal(st.ownMmsi, '244670524')
  assert.equal(st.ownMmsiSource, 'signalk')
  assert.equal(st.ownMmsiConfigured, '')
  const call = radio.simulateCall({ mmsi: '244123456', channel: 8 })
  assert.equal(call.replyStatus, 0)
})

test('blank ownMmsi without Signal K MMSI returns Own MMSI not set', () => {
  const app = {
    getSelfPath () { return null },
    emit () {},
  }
  const radio = createRadio(app, {
    canDevice: 'none',
    ownMmsi: '',
    dscEnabled: true,
    autoReplyStatus: 0,
    forwardDscToSignalk: false,
  })
  radio.stop()
  const call = radio.simulateCall({ mmsi: '244123456', channel: 8 })
  assert.equal(call.replyStatus, 4)
})
