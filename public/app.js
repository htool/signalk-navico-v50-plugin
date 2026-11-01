(function () {
  var base = (function () {
    var p = location.pathname
    if (p.indexOf('/plugins/') >= 0) {
      return p.replace(/\/public\/.*/, '').replace(/\/$/, '')
    }
    return ''
  })()

  var labels = {
    0: 'OK',
    1: 'DSC disabled',
    2: 'Busy',
    3: 'In progress',
    4: 'Own MMSI not set',
    5: 'Invalid MMSI',
    6: 'Invalid channel',
  }

  var auto = document.getElementById('autoReply')
  Object.keys(labels).forEach(function (k) {
    var o = document.createElement('option')
    o.value = k
    o.textContent = k + ' — ' + labels[k]
    auto.appendChild(o)
  })

  function setStep(name) {
    var nodes = document.querySelectorAll('#steps li')
    var hit = false
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]
      n.className = ''
      if (n.getAttribute('data-s') === name) {
        n.className = 'on'
        hit = true
      } else if (!hit) n.className = 'done'
    }
  }

  function get(url, cb) {
    var x = new XMLHttpRequest()
    x.open('GET', base + url)
    x.onload = function () {
      try { cb(null, JSON.parse(x.responseText)) } catch (e) { cb(e) }
    }
    x.onerror = function () { cb(new Error('network')) }
    x.send()
  }

  function post(url, body, cb) {
    var x = new XMLHttpRequest()
    x.open('POST', base + url)
    x.setRequestHeader('Content-Type', 'application/json')
    x.onload = function () {
      try { cb(null, JSON.parse(x.responseText)) } catch (e) { cb(e) }
    }
    x.onerror = function () { cb(new Error('network')) }
    x.send(JSON.stringify(body || {}))
  }

  function fmtPkt(pkt) {
    if (!pkt) return '—'
    var lines = []
    if (pkt.pgn != null) lines.push('PGN ' + pkt.pgn)
    if (pkt.eventName) lines.push(pkt.eventName)
    if (pkt.rawHex) lines.push(pkt.rawHex)
    else lines.push(JSON.stringify(pkt, null, 2))
    return lines.join('\n')
  }

  function stepFromRequest(req, st) {
    if (!req) {
      if (st.cansend) setStep('idle')
      return
    }
    if (req.phase === 'complete' || req.replyStatus != null) setStep('done')
    else if (req.phase === 'dial' || req.dialPacket) setStep('dial')
    else if (req.phase === 'channel' || req.channelPacket) setStep('channel')
    else if (req.phase === 'init-event') setStep('dial')
    else setStep('idle')
  }

  function callHeadline(mmsi, channel, phase, replyStatus) {
    var dialed = phase === 'dial' || phase === 'complete' || phase === 'init-event'
    if (!dialed) {
      // 130845 working-channel (and similar) before MFD Call confirm
      if (channel != null && mmsi) {
        return 'Call setup received · MMSI ' + mmsi + ' · channel ' + channel
      }
      if (channel != null) return 'Call setup received · channel ' + channel
      if (mmsi) return 'Call setup received · MMSI ' + mmsi
      return null
    }
    if (replyStatus != null) {
      if (mmsi && channel != null) return 'Called ' + mmsi + ' on channel ' + channel
      if (mmsi) return 'Called ' + mmsi
      if (channel != null) return 'Called on channel ' + channel
      return 'Call completed'
    }
    if (mmsi && channel != null) return 'Calling ' + mmsi + ' on channel ' + channel
    if (mmsi) return 'Calling ' + mmsi + ' (channel pending)'
    if (channel != null) return 'Calling on channel ' + channel
    return 'Calling…'
  }

  function renderSummary(st, mmsi, channel, replyStatus, replyLabel, phase) {
    var box = document.getElementById('callSummary')
    var head = callHeadline(mmsi, channel, phase, replyStatus)
    if (!head) {
      box.className = 'callout'
      return
    }
    var dialed = phase === 'dial' || phase === 'complete' || phase === 'init-event'
    var cls = 'callout show'
    if (replyStatus != null && replyStatus !== 0) cls += ' bad'
    else if (!dialed) cls += ' partial'
    document.getElementById('callHeadline').textContent = head
    var meta = []
    if (!dialed) meta.push('waiting for Call button (130850 dial)')
    else if (phase) meta.push('phase ' + phase)
    if (replyStatus != null) {
      meta.push('reply ' + replyStatus + ' — ' + (replyLabel || labels[replyStatus] || ''))
    }
    document.getElementById('callMeta').textContent = meta.join(' · ') || 'from N2K'
    box.className = cls
  }

  function renderRx(st) {
    var req = st.lastCallRequest
    var pkt = st.lastReceivedPacket
    var last = st.lastCall
    var empty = document.getElementById('rxEmpty')
    var panel = document.getElementById('rxPanel')

    // Prefer the live request; only fall back to lastCall once a dial/complete exists.
    var phase = (req && req.phase) || null
    var dialed = phase === 'dial' || phase === 'complete' || phase === 'init-event'
    var mmsi = (req && req.mmsi) || (pkt && pkt.mmsi) || null
    var channel = (req && req.channel != null) ? req.channel
      : (pkt && pkt.channel != null) ? pkt.channel
      : st.pendingChannel
    if (dialed && mmsi == null && last) mmsi = last.mmsi || mmsi
    if (dialed && channel == null && last && last.channel != null) channel = last.channel
    var replyStatus = (req && req.replyStatus != null) ? req.replyStatus
      : (dialed && last && last.replyStatus != null) ? last.replyStatus
      : null
    var replyLabel = (req && req.replyLabel) || (dialed && last && last.replyLabel) || null

    renderSummary(st, mmsi, channel, replyStatus, replyLabel, phase)

    if (!req && !pkt && !(last && (last.mmsi || last.channel != null))) {
      empty.style.display = ''
      panel.style.display = 'none'
      return
    }
    empty.style.display = 'none'
    panel.style.display = ''

    document.getElementById('rxPhase').textContent = phase || '—'
    document.getElementById('rxPhase').className =
      'pill ' + (phase === 'complete' ? 'ok' : phase === 'channel' ? 'warn' : '')

    document.getElementById('rxMmsi').textContent = mmsi != null ? String(mmsi) : '—'
    document.getElementById('rxChannel').textContent = channel != null ? String(channel) : '—'

    var replyEl = document.getElementById('rxReply')
    if (replyStatus != null) {
      replyEl.textContent = replyStatus + ' — ' + (replyLabel || labels[replyStatus] || '')
      replyEl.className = 'pill ' + (replyStatus === 0 ? 'ok' : 'bad')
    } else {
      replyEl.textContent = '—'
      replyEl.className = 'pill'
    }

    document.getElementById('rxPending').textContent =
      'pending ch ' + (st.pendingChannel != null ? st.pendingChannel : '—')
    document.getElementById('rxKind').textContent =
      (req && req.replyKind) ? 'reply ' + req.replyKind
        : (pkt && pkt.kind) ? pkt.kind
        : (pkt && pkt.layout) || '—'

    document.getElementById('rxChannelPkt').textContent = fmtPkt(req && req.channelPacket)
    document.getElementById('rxDialPkt').textContent = fmtPkt(req && req.dialPacket)
    document.getElementById('rxJson').textContent = pkt ? JSON.stringify(pkt, null, 2) : '—'
    document.getElementById('rxRequest').textContent = req ? JSON.stringify(req, null, 2) : '—'
  }

  function render(st) {
    if (!st || st.error) return
    document.getElementById('model').textContent = st.modelId || '—'
    document.getElementById('addr').textContent = st.address != null ? String(st.address) : 'claiming…'
    var cs = document.getElementById('cansend')
    cs.textContent = st.cansend ? 'cansend' : 'waiting'
    cs.className = 'pill ' + (st.cansend ? 'ok' : '')
    document.getElementById('ownMmsi').value = st.ownMmsi || ''
    document.getElementById('dscEnabled').value = st.dscEnabled ? 'true' : 'false'
    document.getElementById('autoReply').value = String(st.autoReplyStatus)
    document.getElementById('calls').textContent = JSON.stringify(st.calls || [], null, 2)
    document.getElementById('bus').textContent = JSON.stringify(st.busLog || [], null, 2)
    renderRx(st)
    stepFromRequest(st.lastCallRequest, st)
  }

  function refresh() {
    get('/status', function (err, st) {
      if (!err) render(st)
    })
  }

  document.getElementById('saveOpts').onclick = function () {
    post('/options', {
      ownMmsi: document.getElementById('ownMmsi').value,
      dscEnabled: document.getElementById('dscEnabled').value === 'true',
      autoReplyStatus: Number(document.getElementById('autoReply').value),
    }, function (err, st) {
      if (!err) render(st)
    })
  }

  document.getElementById('callBtn').onclick = function () {
    setStep('channel')
    setTimeout(function () { setStep('dial') }, 150)
    post('/call', {
      mmsi: document.getElementById('mmsi').value,
      channel: Number(document.getElementById('channel').value),
    }, function (err, call) {
      setStep('reply')
      var el = document.getElementById('result')
      if (err) {
        el.textContent = String(err.message || err)
        el.className = 'bad'
        return
      }
      el.className = call.replyStatus === 0 ? 'ok' : 'bad'
      el.textContent =
        'MMSI ' + (call.mmsi || '—') +
        ' ch ' + (call.channel != null ? call.channel : '—') +
        ' → reply ' + call.replyStatus + ' — ' + (call.replyLabel || '')
      setStep('done')
      refresh()
    })
  }

  setStep('idle')
  refresh()
  setInterval(refresh, 2000)
})()
