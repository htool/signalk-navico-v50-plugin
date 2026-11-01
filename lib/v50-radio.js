const debug = require('debug')('signalk-navico-v50:radio')
const { SimpleCan } = require('@canboat/canboatjs')
const {
  mergeOptions,
  addressClaim,
  productInfo,
  productInfoBytes,
  REPLY_STATUS,
} = require('./v50-identity')
const {
  EVENT_INIT_DSC_CALL,
  decideStatus,
  looksLikeInitDscCall,
  parseInitDscPacket,
  eventReplyPgn,
  buildEventReplyBytes,
} = require('./dsc-event')
const { radioStatusPgn } = require('./radio-status')
const { ownMmsiParamPgns } = require('./own-mmsi-param')

function createRadio(app, rawOptions) {
  const opts = mergeOptions(rawOptions)
  const state = {
    opts,
    address: null,
    cansend: false,
    canDevice: opts.canDevice || 'can0',
    lastCall: null,
    lastReceivedPacket: null,
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
      lastReceivedPacket: state.lastReceivedPacket,
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
    // Proprietary event reply uses Simrad manu (V60B firmware), not NAME ManCode.
    const pgn = eventReplyPgn(dst, status, state.address)
    pushLog({ dir: 'tx', kind: 'dsc-reply', dst: dst, status: status, pgn: 130851 })
    try {
      if (state.simpleCan && state.simpleCan.sendPGN) {
        state.simpleCan.sendPGN({
          pgn: 130851,
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

    // CERTAIN (V60B fw + manual): DSC event is 130850 RX / 130851 TX; no 126720.
    const interesting =
      n2k.dst === state.address ||
      (n2k.dst === 255 && (n2k.pgn === 130850 || n2k.pgn === 130845))
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

    const packet = parseInitDscPacket(n2k, state.address)
    state.lastReceivedPacket = packet
    pushLog({
      dir: 'rx',
      kind: 'init-dsc-call',
      pgn: n2k.pgn,
      src: n2k.src,
      dst: n2k.dst,
      packet: packet,
    })

    const status = decideStatus(opts, state.lastCall || {})
    debug('Init DSC Call from %s -> reply status %d', n2k.src, status)
    sendReply(n2k.src, status, {
      source: 'bus',
      mmsi: (state.lastCall && state.lastCall.mmsi) || null,
      channel: (state.lastCall && state.lastCall.channel) || null,
      from: n2k.src,
      pgn: n2k.pgn,
      dst: n2k.dst,
      packet: packet,
      rawHex: packet && packet.rawHex,
      eventId: packet && packet.eventId,
      manufacturer: packet && packet.manufacturer,
      address: packet && packet.address,
      command: packet && packet.command,
      layout: packet && packet.layout,
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
    function sendQuiet(msg) {
      try {
        state.simpleCan.sendPGN(msg)
      } catch (e) {
        debug('send failed: %s', e.message)
      }
    }

    function claim() {
      const ac = addressClaim(opts)
      ac.src = state.address
      ac.prio = 6
      cli.sendPGN(ac)
      // Prefer NUL-padded 126996 — 0xFF-padded Model ID fails MFD product-table match.
      cli.sendPGN({
        pgn: 126996,
        prio: 6,
        dst: 255,
        src: state.address,
        data: productInfoBytes(opts),
      })
      // V50/V60 manual TX: radio status. Helps MFD treat us as a live VHF.
      try {
        sendQuiet(radioStatusPgn(state.address, 16))
      } catch (e) {
        debug('129799: %s', e.message)
      }
      // 130845 probes paused — suspected of clearing MFD Own MMSI / Call gate.
      // for (const p of ownMmsiParamPgns(state.address, opts.ownMmsi)) {
      //   sendQuiet(p)
      // }
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
      // CERTAIN (V60B fw): no 126720; claim real TX set used by the radio path.
      transmitPGNs: [126996, 129799, 130845, 130851],
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
