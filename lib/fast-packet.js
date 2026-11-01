// Minimal NMEA 2000 fast-packet reassembly for candump single frames.
// Frame 0: [seq:3|frame:5][len][6 payload bytes…]
// Frame n: [seq:3|frame:5][7 payload bytes…]

function createFastPacketAssembler(opts) {
  opts = opts || {}
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : 750
  const pending = new Map()

  function keyOf(src, pgn, seq) {
    return src + '|' + pgn + '|' + seq
  }

  function purge(now) {
    for (const [k, st] of pending) {
      if (now - st.ts > ttlMs) pending.delete(k)
    }
  }

  /**
   * @returns {object|null} complete message, or null if waiting for more frames /
   *   orphan continuation. Non-FP frames are returned unchanged.
   */
  function push(msg) {
    if (!msg || !Buffer.isBuffer(msg.data) || msg.data.length < 2) return msg
    const data = msg.data
    const frameNum = data[0] & 0x1f
    const seq = (data[0] >> 5) & 0x07
    const now = Date.now()
    purge(now)

    // Fast-packet first frame: frame 0 and a plausible total length > 6.
    if (frameNum === 0 && data[1] >= 7 && data[1] <= 223) {
      const total = data[1]
      const buf = Buffer.alloc(total, 0xff)
      const n = Math.min(6, total, data.length - 2)
      data.copy(buf, 0, 2, 2 + n)
      if (n >= total) {
        return Object.assign({}, msg, { data: buf, fastPacket: true })
      }
      pending.set(keyOf(msg.src, msg.pgn, seq), {
        buf: buf,
        total: total,
        filled: n,
        pgn: msg.pgn,
        src: msg.src,
        dst: msg.dst,
        prio: msg.prio,
        canId: msg.canId,
        ts: now,
      })
      return null
    }

    // Continuation
    if (frameNum > 0) {
      const st = pending.get(keyOf(msg.src, msg.pgn, seq))
      if (!st) {
        // Orphan: often a single-frame Simrad proprietary starting 0x41 0x9f
        // (looks like FP frame 1). Pass through unchanged.
        return msg
      }
      const offset = 6 + (frameNum - 1) * 7
      if (offset >= st.total) return null
      const n = Math.min(7, st.total - offset, data.length - 1)
      if (n > 0) data.copy(st.buf, offset, 1, 1 + n)
      st.filled = Math.max(st.filled, offset + Math.max(n, 0))
      st.ts = now
      if (st.filled < st.total) return null
      pending.delete(keyOf(msg.src, msg.pgn, seq))
      return {
        pgn: st.pgn,
        src: st.src,
        dst: st.dst,
        prio: st.prio,
        canId: st.canId,
        data: st.buf,
        fastPacket: true,
      }
    }

    // Single-frame (or frame0 with len < 7 — not our Call PGNs).
    return msg
  }

  return { push: push, pendingSize: function () { return pending.size } }
}

module.exports = { createFastPacketAssembler: createFastPacketAssembler }
