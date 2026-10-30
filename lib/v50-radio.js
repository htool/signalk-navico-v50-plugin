const debug = require('debug')('signalk-navico-v50:radio')
const { SimpleCan } = require('@canboat/canboatjs')
const {
  mergeOptions,
  addressClaim,
  productInfo,
  REPLY_STATUS,
} = require('./v50-identity')
const {
  EVENT_INIT_DSC_CALL,
  decideStatus,
  looksLikeInitDscCall,
  eventReplyPgn,
  buildEventReplyBytes,
} = require('./dsc-event')

function createRadio(app, rawOptions) {
  const opts = mergeOptions(rawOptions)
  const state = {
    opts,
    address: null,
    cansend: false,
    canDevice: opts.canDevice || 'can0',
    lastCall: null,
    calls: [],
    busLog: [],
    listeners: new Set(),
    simpleCan: null,
  }

  function emitState() {
    const snap = getState()
    for (const fn of state.listeners) {
      try { fn(snap) } catch (e) { debug('listener error %s', e.message) }
    }
  }

  function pushLog(entry) {
    state.busLog.push(Object.assign({ ts: new Date().toISOString() }, entry))
    if (state.busLog.length > 200) state.busLog.shift()
    emitState()
  }

  function getState() {
    return {
      modelId: opts.modelId,
      address: state.address,
      cansend: state.cansend,
      canDevice: state.canDevice,
      ownMmsi: opts.ownMmsi,
      dscEnabled: opts.dscEnabled,
      autoReplyStatus: opts.autoReplyStatus,
      lastCall: state.lastCall,
      calls: state.calls.slice(-20),
      busLog: state.busLog.slice(-50),
      replyStatusLabels: REPLY_STATUS,
      eventId: EVENT_INIT_DSC_CALL,
    }
  }

  function recordCall(partial) {
    const call = Object.assign({
      id: Date.now().toString(36),
      ts: new Date().toISOString(),
      mmsi: null,
      channel: null,
      source: 'bus',
      replyStatus: null,
      replyLabel: null,
    }, partial)
    state.lastCall = call
    state.calls.push(call)
    if (state.calls.length > 50) state.calls.shift()
    emitState()
    return call
  }

  function sendReply(dst, status, meta) {
    const call = recordCall(Object.assign({}, meta, {
      replyStatus: status,
      replyLabel: REPLY_STATUS[status] || ('status ' + status),
    }))
    const pgn = eventReplyPgn(dst, status, state.address)
    pushLog({ dir: 'tx', kind: 'dsc-reply', dst: dst, status: status, pgn: 126720 })
    try {
      if (state.simpleCan && state.simpleCan.sendPGN) {
        state.simpleCan.sendPGN({
          pgn: 126720,
          prio: 2,
          dst: dst,
          src: state.address,
          data: buildEventReplyBytes(status),
        })
      }
      if (app && app.emit) app.emit('nmea2000JsonOut', pgn)
    } catch (e) {
      debug('sendReply failed: %s', e.message)
      pushLog({ dir: 'tx', kind: 'error', message: e.message })
    }
    return call
  }

  function handleIncoming(n2k) {
    if (!n2k) return
    if (state.address != null && n2k.src === state.address) return

    const interesting =
      n2k.dst === state.address ||
      (n2k.dst === 255 && (n2k.pgn === 126720 || n2k.pgn === 130850))
    if (interesting) {
      pushLog({
        dir: 'rx',
        pgn: n2k.pgn,
        src: n2k.src,
        dst: n2k.dst,
        fields: n2k.fields,
        data: Buffer.isBuffer(n2k.data) ? n2k.data.toString('hex') : n2k.data,
      })
    }

    if (!looksLikeInitDscCall(n2k, state.address)) return

    const status = decideStatus(opts, state.lastCall || {})
    debug('Init DSC Call from %s -> reply status %d', n2k.src, status)
    sendReply(n2k.src, status, {
      source: 'bus',
      mmsi: (state.lastCall && state.lastCall.mmsi) || null,
      channel: (state.lastCall && state.lastCall.channel) || null,
      from: n2k.src,
      pgn: n2k.pgn,
    })
  }

  function simulateCall(args) {
    args = args || {}
    const call = recordCall({
      source: 'webapp',
      mmsi: String(args.mmsi || ''),
      channel: args.channel != null ? Number(args.channel) : 16,
    })
    const status = decideStatus(opts, call)
    return sendReply(0xff, status, {
      source: 'webapp',
      mmsi: call.mmsi,
      channel: call.channel,
    })
  }

  function setOptions(patch) {
    Object.assign(opts, mergeOptions(Object.assign({}, opts, patch)))
    state.opts = opts
    emitState()
  }

  function onN2k(n2k) { handleIncoming(n2k) }

  function startCliCan() {
    const { createCliCan } = require('./cli-can')
    const { toPgn } = require('@canboat/canboatjs')
    const cli = createCliCan(state.canDevice)
    state.address = opts.preferredAddress
    state.cansend = true
    cli.setAddress(state.address)
    state.simpleCan = {
      sendPGN: function (msg) {
        msg.src = msg.src != null ? msg.src : state.address
        cli.sendPGN(msg)
      },
      candevice: { address: state.address, cansend: true },
      channel: { stop: function () { cli.stop() } },
    }
    function claim() {
      const ac = addressClaim(opts)
      ac.src = state.address
      ac.prio = 6
      cli.sendPGN(ac)
      const pi = productInfo(opts)
      pi.src = state.address
      pi.prio = 6
      cli.sendPGN(pi)
    }
    claim()
    state._claimTimer = setInterval(claim, 5000)
    cli.on('message', function (m) {
      handleIncoming(m)
      // ISO request 59904 for 60928/126996
      if (m.pgn === 59904 && (m.dst === state.address || m.dst === 255)) {
        const req = m.data && m.data.length >= 3 ? m.data[0] | (m.data[1] << 8) | (m.data[2] << 16) : 0
        if (req === 60928 || req === 126996 || req === 0) claim()
      }
    })
    emitState()
    if (app && app.setPluginStatus) {
      app.setPluginStatus(opts.modelId + ' on ' + state.canDevice + ' via cansend/candump addr ' + state.address)
    }
  }

  if (process.env.FORCE_CLI_CAN === '1') {
    startCliCan()
  } else {
  try {
    const simpleCan = new SimpleCan({
      app: app,
      canDevice: state.canDevice,
      preferredAddress: opts.preferredAddress,
      uniqueNumber: opts.uniqueNumber,
      transmitPGNs: [126996, 126720],
      addressClaim: addressClaim(opts),
      productInfo: productInfo(opts),
    }, function (msg) {
      if (msg && msg.pgn && msg.pgn.pgn) {
        handleIncoming({
          pgn: msg.pgn.pgn,
          src: msg.pgn.src,
          dst: msg.pgn.dst,
          data: msg.data,
        })
      }
    })
    simpleCan.start()
    state.simpleCan = simpleCan
    const tick = setInterval(function () {
      if (simpleCan.candevice) {
        state.address = simpleCan.candevice.address
        state.cansend = !!simpleCan.candevice.cansend
        emitState()
        if (state.cansend) clearInterval(tick)
      }
    }, 500)
    setTimeout(function () { clearInterval(tick) }, 15000)
  } catch (e) {
    debug('SimpleCan failed (%s) — using cansend/candump', e.message)
    pushLog({ dir: 'sys', kind: 'fallback', message: String(e.message || e) })
    try {
      startCliCan()
    } catch (e2) {
      pushLog({ dir: 'sys', kind: 'error', message: String(e2.message || e2) })
      if (app && app.setPluginStatus) {
        app.setPluginStatus(opts.modelId + ': no CAN — ' + e2.message)
      }
    }
  }
  }

  if (app && app.on) app.on('N2KAnalyzerOut', onN2k)

  function stop() {
    if (state._claimTimer) clearInterval(state._claimTimer)
    if (app && app.removeListener) app.removeListener('N2KAnalyzerOut', onN2k)
    try {
      if (state.simpleCan && state.simpleCan.channel && state.simpleCan.channel.stop) {
        state.simpleCan.channel.stop()
      }
    } catch (e) { debug('stop: %s', e.message) }
  }

  return {
    getState: getState,
    simulateCall: simulateCall,
    sendReply: sendReply,
    setOptions: setOptions,
    on: function (fn) { state.listeners.add(fn) },
    off: function (fn) { state.listeners.delete(fn) },
    stop: stop,
    opts: opts,
  }
}

module.exports = { createRadio: createRadio }
