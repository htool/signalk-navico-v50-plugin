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
  parseOwnMmsi,
  looksLikeInitDscCall,
  looksLikeWorkingChannelSet,
  looksLikeDialRequest,
  parseInitDscPacket,
  parseWorkingChannelPacket,
  parseDialPacket,
  eventReplyPgn,
  dialReplyPgn,
  buildEventReplyBytes,
  buildDialReplyBytes,
  buildWorkingChannelSetBytes,
  buildDialRequestBytes,
} = require('./dsc-event')
const { radioStatusPgn } = require('./radio-status')
const { ownMmsiParamPgns } = require('./own-mmsi-param')

function unwrapSelfPath(app, path) {
  if (!app || typeof app.getSelfPath !== 'function') return null
  const v = app.getSelfPath(path)
  if (v && typeof v === 'object' && 'value' in v) return v.value
  return v
}

function createRadio(app, rawOptions) {
  const opts = mergeOptions(rawOptions)
  const state = {
    opts,
    address: null,
    cansend: false,
    canDevice: opts.canDevice || 'can0',
    pendingChannel: null,
    lastCall: null,
    lastReceivedPacket: null,
    lastCallRequest: null,
    lastDscForward: null,
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

  /** Configured override, else vessels.self.mmsi from Signal K. */
  function effectiveOwnMmsi() {
    const fromOpts = parseOwnMmsi(opts.ownMmsi)
    if (fromOpts) return fromOpts
    return parseOwnMmsi(unwrapSelfPath(app, 'mmsi'))
  }

  function statusOpts() {
    return Object.assign({}, opts, { ownMmsi: effectiveOwnMmsi() || '' })
  }

  function getState() {
    return {
      modelId: opts.modelId,
      address: state.address,
      cansend: state.cansend,
      canDevice: state.canDevice,
      ownMmsi: effectiveOwnMmsi() || '',
      ownMmsiConfigured: String(opts.ownMmsi || '').trim(),
      ownMmsiSource: parseOwnMmsi(opts.ownMmsi)
        ? 'config'
        : (effectiveOwnMmsi() ? 'signalk' : null),
      dscEnabled: opts.dscEnabled,
      autoReplyStatus: opts.autoReplyStatus,
      forwardDscToSignalk: opts.forwardDscToSignalk !== false,
      pendingChannel: state.pendingChannel,
      lastCall: state.lastCall,
      lastReceivedPacket: state.lastReceivedPacket,
      lastCallRequest: state.lastCallRequest,
      lastDscForward: state.lastDscForward,
      calls: state.calls.slice(-20),
      busLog: state.busLog.slice(-50),
      replyStatusLabels: REPLY_STATUS,
      eventId: EVENT_INIT_DSC_CALL,
    }
  }

  function forwardDscToSignalk(mmsi, channel, status) {
    if (opts.forwardDscToSignalk === false) return
    if (status !== 0) return
    const digits = String(mmsi || '').replace(/\D/g, '')
    const ch = Number(channel)
    if (digits.length !== 9 || !Number.isInteger(ch) || ch < 1 || ch > 88) {
      state.lastDscForward = {
        ok: false,
        error: 'missing mmsi or channel',
        mmsi: digits || null,
        channel: Number.isFinite(ch) ? ch : null,
        ts: new Date().toISOString(),
      }
      emitState()
      return
    }
    const value = {
      mmsi: digits,
      channel: ch,
      type: 'individual',
      category: 'routine',
    }
    const path = 'communication.vhf.dsc.call'
    const record = (ok, error) => {
      state.lastDscForward = {
        ok: !!ok,
        error: error || null,
        mmsi: digits,
        channel: ch,
        path: path,
        ts: new Date().toISOString(),
      }
      pushLog({
        dir: 'tx',
        kind: 'dsc-forward',
        ok: !!ok,
        error: error || null,
        mmsi: digits,
        channel: ch,
      })
    }
    if (typeof app.putSelfPath !== 'function') {
      record(false, 'putSelfPath unavailable')
      return
    }
    try {
      app.putSelfPath(path, value, (reply) => {
        if (reply instanceof Error) {
          record(false, reply.message)
          debug('dsc forward failed: %s', reply.message)
          return
        }
        if (reply && reply.statusCode && reply.statusCode >= 400) {
          const msg = reply.message || ('status ' + reply.statusCode)
          record(false, msg)
          debug('dsc forward failed: %s', msg)
          return
        }
        record(true, null)
        debug('dsc forward PUT %s ch %s', digits, ch)
      })
    } catch (e) {
      record(false, e.message || String(e))
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

  function setCallRequest(patch) {
    const base = state.lastCallRequest && state.lastCallRequest.phase !== 'complete'
      ? state.lastCallRequest
      : {
          phase: 'idle',
          channel: null,
          mmsi: null,
          channelPacket: null,
          dialPacket: null,
          initPacket: null,
          replyStatus: null,
          replyLabel: null,
          replyKind: null,
          ts: new Date().toISOString(),
        }
    state.lastCallRequest = Object.assign({}, base, patch, {
      ts: new Date().toISOString(),
    })
    emitState()
    return state.lastCallRequest
  }

  function sendPgn(pgn, data, kind, meta) {
    pushLog(Object.assign({ dir: 'tx', kind: kind, pgn: pgn.pgn, dst: pgn.dst }, meta || {}))
    try {
      if (state.simpleCan && state.simpleCan.sendPGN) {
        state.simpleCan.sendPGN({
          pgn: pgn.pgn,
          prio: pgn.prio || 2,
          dst: pgn.dst,
          src: state.address,
          data: data,
        })
      }
      if (app && app.emit) app.emit('nmea2000JsonOut', pgn)
    } catch (e) {
      debug('send failed: %s', e.message)
      pushLog({ dir: 'tx', kind: 'error', message: e.message })
    }
  }

  function sendEventReply(dst, status, meta) {
    const call = recordCall(Object.assign({}, meta, {
      replyStatus: status,
      replyLabel: REPLY_STATUS[status] || ('status ' + status),
      replyKind: 'event3',
    }))
    const data = buildEventReplyBytes(status)
    const pgn = eventReplyPgn(dst, status, state.address)
    sendPgn(pgn, data, 'dsc-reply-event3', { status: status })
    setCallRequest({
      phase: 'complete',
      replyStatus: status,
      replyLabel: call.replyLabel,
      replyKind: 'event3',
      initPacket: meta && meta.packet ? meta.packet : state.lastCallRequest && state.lastCallRequest.initPacket,
      mmsi: call.mmsi,
      channel: call.channel,
    })
    return call
  }

  function sendDialReply(dst, status, meta) {
    const call = recordCall(Object.assign({}, meta, {
      replyStatus: status,
      replyLabel: REPLY_STATUS[status] || ('status ' + status),
      replyKind: 'dial',
    }))
    const data = buildDialReplyBytes(status, state.address)
    const pgn = dialReplyPgn(dst, status, state.address)
    sendPgn(pgn, data, 'dsc-reply-dial', { status: status })
    const channel = call.channel != null ? call.channel : state.pendingChannel
    setCallRequest({
      phase: 'complete',
      replyStatus: status,
      replyLabel: call.replyLabel,
      replyKind: 'dial',
      mmsi: call.mmsi,
      channel: channel,
      dialPacket: meta && meta.packet ? meta.packet : null,
    })
    forwardDscToSignalk(call.mmsi, channel, status)
    return call
  }

  function handleWorkingChannel(n2k) {
    const packet = parseWorkingChannelPacket(n2k, state.address)
    if (!packet) return false
    state.pendingChannel = packet.channel
    state.lastReceivedPacket = packet
    setCallRequest({
      phase: 'channel',
      channel: packet.channel,
      channelPacket: packet,
      mmsi: null,
      dialPacket: null,
      initPacket: null,
      replyStatus: null,
      replyLabel: null,
      replyKind: null,
    })
    pushLog({
      dir: 'rx',
      kind: 'working-channel',
      pgn: n2k.pgn,
      src: n2k.src,
      dst: n2k.dst,
      channel: packet.channel,
      packet: packet,
    })
    debug('DSC working channel %d from %s', packet.channel, n2k.src)
    emitState()
    return true
  }

  function handleDial(n2k) {
    const packet = parseDialPacket(n2k, state.address)
    if (!packet) return false
    state.lastReceivedPacket = packet
    const channel = state.pendingChannel
    const status = decideStatus(statusOpts(), { mmsi: packet.mmsi, channel: channel })
    setCallRequest({
      phase: 'dial',
      channel: channel,
      mmsi: packet.mmsi,
      dialPacket: packet,
      replyStatus: null,
      replyLabel: null,
    })
    pushLog({
      dir: 'rx',
      kind: 'dsc-dial',
      pgn: n2k.pgn,
      src: n2k.src,
      dst: n2k.dst,
      mmsi: packet.mmsi,
      channel: channel,
      packet: packet,
    })
    debug('DSC dial MMSI %s ch %s from %s -> status %d', packet.mmsi, channel, n2k.src, status)
    sendDialReply(n2k.src, status, {
      source: 'bus',
      mmsi: packet.mmsi,
      channel: channel,
      from: n2k.src,
      pgn: n2k.pgn,
      dst: n2k.dst,
      packet: packet,
      rawHex: packet.rawHex,
      layout: packet.layout,
    })
    return true
  }

  function handleInitEvent(n2k) {
    if (!looksLikeInitDscCall(n2k, state.address)) return false
    const packet = parseInitDscPacket(n2k, state.address)
    state.lastReceivedPacket = packet
    setCallRequest({
      phase: 'init-event',
      initPacket: packet,
      channel: state.pendingChannel,
      mmsi: (state.lastCall && state.lastCall.mmsi) || null,
    })
    pushLog({
      dir: 'rx',
      kind: 'init-dsc-call',
      pgn: n2k.pgn,
      src: n2k.src,
      dst: n2k.dst,
      packet: packet,
    })
    const status = decideStatus(statusOpts(), {
      mmsi: (state.lastCall && state.lastCall.mmsi) || null,
      channel: state.pendingChannel,
    })
    debug('Init DSC Call (event 3) from %s -> reply status %d', n2k.src, status)
    sendEventReply(n2k.src, status, {
      source: 'bus',
      mmsi: (state.lastCall && state.lastCall.mmsi) || null,
      channel: state.pendingChannel,
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
    return true
  }

  function handleIncoming(n2k) {
    if (!n2k) return
    if (state.address != null && n2k.src === state.address) return

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

    if (looksLikeWorkingChannelSet(n2k, state.address)) {
      handleWorkingChannel(n2k)
      return
    }
    if (looksLikeDialRequest(n2k, state.address)) {
      handleDial(n2k)
      return
    }
    handleInitEvent(n2k)
  }

  function simulateCall(args) {
    args = args || {}
    const mmsi = String(args.mmsi || '')
    const channel = args.channel != null ? Number(args.channel) : 16
    state.pendingChannel = channel

    const channelPacket = {
      pgn: 130845,
      kind: 'working-channel',
      layout: 'v60-working-channel',
      eventName: 'DSC working channel',
      channel: channel,
      keyGroup: 0x11,
      keyParam: 0xad,
      operation: 1,
      rawHex: buildWorkingChannelSetBytes(channel).toString('hex'),
      simulated: true,
    }
    const dialPacket = {
      pgn: 130850,
      kind: 'dial',
      layout: 'v60-dial',
      eventName: 'DSC dial (MMSI)',
      mmsi: parseInt(String(mmsi).replace(/\D/g, '').slice(0, 9) || '0', 10)
        .toString()
        .padStart(9, '0')
        .slice(-9),
      key: 0x6f,
      rawHex: buildDialRequestBytes(mmsi, state.address || 0xff).toString('hex'),
      simulated: true,
    }

    setCallRequest({
      phase: 'dial',
      channel: channel,
      mmsi: dialPacket.mmsi,
      channelPacket: channelPacket,
      dialPacket: dialPacket,
      initPacket: null,
      replyStatus: null,
      replyLabel: null,
    })
    state.lastReceivedPacket = dialPacket

    const call = recordCall({
      source: 'webapp',
      mmsi: dialPacket.mmsi,
      channel: channel,
    })
    const status = decideStatus(statusOpts(), call)
    return sendDialReply(0xff, status, {
      source: 'webapp',
      mmsi: call.mmsi,
      channel: call.channel,
      packet: dialPacket,
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
      cli.sendPGN({
        pgn: 126996,
        prio: 6,
        dst: 255,
        src: state.address,
        data: productInfoBytes(opts),
      })
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
    sendReply: sendEventReply,
    setOptions: setOptions,
    on: function (fn) { state.listeners.add(fn) },
    off: function (fn) { state.listeners.delete(fn) },
    stop: stop,
    opts: opts,
  }
}

module.exports = { createRadio: createRadio }
