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
    x.setHeader && x.setRequestHeader('Content-Type', 'application/json')
    x.setRequestHeader('Content-Type', 'application/json')
    x.onload = function () {
      try { cb(null, JSON.parse(x.responseText)) } catch (e) { cb(e) }
    }
    x.onerror = function () { cb(new Error('network')) }
    x.send(JSON.stringify(body || {}))
  }

  function renderRx(st) {
    var pkt = st.lastReceivedPacket
    var last = st.lastCall
    // Prefer explicit lastReceivedPacket; fall back to last bus call with packet.
    if (!pkt && last && last.source === 'bus' && last.packet) pkt = last.packet
    var empty = document.getElementById('rxEmpty')
    var panel = document.getElementById('rxPanel')
    if (!pkt) {
      empty.style.display = ''
      panel.style.display = 'none'
      return
    }
    empty.style.display = 'none'
    panel.style.display = ''
    document.getElementById('rxPgn').textContent = 'PGN ' + (pkt.pgn != null ? pkt.pgn : '—')
    document.getElementById('rxEvent').textContent =
      'event ' + (pkt.eventId != null ? pkt.eventId : '—') + ' — ' + (pkt.eventName || 'Init DSC Call')
    document.getElementById('rxMan').textContent =
      (pkt.manufacturer || 'man') + ' ' + (pkt.manufacturerCode != null ? pkt.manufacturerCode : '')
    document.getElementById('rxSrcDst').textContent =
      'src ' + (pkt.src != null ? pkt.src : '—') + ' → dst ' + (pkt.dst != null ? pkt.dst : '—')
    document.getElementById('rxAddr').textContent =
      pkt.address != null ? String(pkt.address) + (pkt.address === 255 ? ' (broadcast)' : '') : '—'
    document.getElementById('rxCmd').textContent = pkt.command != null ? String(pkt.command) : '—'
    document.getElementById('rxLayout').textContent = pkt.layout || '—'
    var replyEl = document.getElementById('rxReply')
    if (last && last.source === 'bus' && last.replyStatus != null) {
      replyEl.textContent = last.replyStatus + ' — ' + (last.replyLabel || '')
      replyEl.className = 'pill ' + (last.replyStatus === 0 ? 'ok' : 'bad')
    } else {
      replyEl.textContent = '—'
      replyEl.className = 'pill'
    }
    document.getElementById('rxRaw').textContent = pkt.rawHex || '—'
    document.getElementById('rxJson').textContent = JSON.stringify(pkt, null, 2)
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
    if (st.cansend) {
      if (st.lastReceivedPacket) setStep('done')
      else if (st.lastCall) setStep('done')
      else setStep('idle')
    }
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
    setStep('confirm')
    setTimeout(function () { setStep('event') }, 200)
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
      el.textContent = 'Reply ' + call.replyStatus + ' — ' + (call.replyLabel || '')
      setStep('done')
      refresh()
    })
  }

  setStep('idle')
  refresh()
  setInterval(refresh, 2000)
})()
