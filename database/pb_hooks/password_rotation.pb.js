// database/pb_hooks/password_rotation.pb.js

function sha256Base64 (str) {
  const hex = $security.sha256(str)
  const bytes = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16))
  }
  const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let b64 = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i]
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0

    const c1 = b1 >> 2
    const c2 = ((b1 & 3) << 4) | (b2 >> 4)
    const c3 = ((b2 & 15) << 2) | (b3 >> 6)
    const c4 = b3 & 63

    b64 += b64chars.charAt(c1) + b64chars.charAt(c2)
    b64 += i + 1 < bytes.length ? b64chars.charAt(c3) : '='
    b64 += i + 2 < bytes.length ? b64chars.charAt(c4) : '='
  }
  return b64
}

routerAdd('POST', '/api/custom/rotate_password', (e) => {
  try {
    const info = typeof e.requestInfo === 'function' ? e.requestInfo() : (e.requestInfo || null)
    const authRecord = e.auth || (info ? (info.authRecord || info.auth) : null)

    const data = new DynamicModel({
      userId: '',
      username: '',
      newKeyBHash: '',
      newKeyB: '',
      newWrappedVMK: '',
      remainingWraps: '',
      recoveryAuthProof: ''
    })
    try {
      e.bindBody(data)
    } catch (err) {
      return e.json(400, { error: 'Invalid rotation request.' })
    }

    const keyToHash = data.newKeyB || data.newKeyBHash
    const newWrappedVMK = data.newWrappedVMK

    if (!keyToHash || !newWrappedVMK) {
      return e.json(400, { error: 'Missing required rotation payload' })
    }

    let targetUser = authRecord
    let serverRemainingWraps = null

    if (!targetUser) {
      // Rate limiting for unauthenticated rotation attempts
      const ip = info ? (info.ip || info.remoteIP || '127.0.0.1') : '127.0.0.1'
      const now = Date.now()

      const targetId = (data.userId || '').trim()
      const targetUsername = (data.username || '').trim().toLowerCase()

      const store = $app.store()
      const ipKey = `rotation:ip:${ip}`
      const userKey = (targetId || targetUsername) ? `rotation:user:${targetId || targetUsername}` : ''

      function getAttempts (key) {
        let val = store.get(key)
        if (typeof val === 'string') {
          try { val = JSON.parse(val) } catch (_) { val = [] }
        }
        return Array.isArray(val) ? val : []
      }

      const recentIpAttempts = getAttempts(ipKey).filter(t => now - t < 3600000)
      if (recentIpAttempts.length >= 5) {
        return e.json(429, { error: 'Too many recovery attempts. Please try again later.' })
      }

      if (userKey) {
        const recentUserAttempts = getAttempts(userKey).filter(t => now - t < 3600000)
        if (recentUserAttempts.length >= 5) {
          return e.json(429, { error: 'Too many recovery attempts. Please try again later.' })
        }
        recentUserAttempts.push(now)
        store.set(userKey, JSON.stringify(recentUserAttempts))
      }

      recentIpAttempts.push(now)
      store.set(ipKey, JSON.stringify(recentIpAttempts))

      if (!targetId && !targetUsername) {
        return e.json(401, { error: 'Unauthorized' })
      }

      if (!data.recoveryAuthProof) {
        return e.json(400, { error: 'Invalid recovery request.' })
      }

      let records = []
      if (targetId) {
        records = $app.findRecordsByFilter('users', 'id = {:id}', '', 1, 0, { id: targetId })
      }
      if (records.length === 0 && targetUsername) {
        records = $app.findRecordsByFilter('users', 'username = {:username}', '', 1, 0, { username: targetUsername })
      }

      if (records.length === 0) {
        return e.json(400, { error: 'Invalid recovery request.' })
      }

      targetUser = records[0]

      // Verify recovery wraps and candidate verifier
      let existingWraps = targetUser.get('recovery_wraps') || []
      if (typeof existingWraps === 'string') {
        try {
          existingWraps = JSON.parse(existingWraps)
        } catch (err) {
        }
      }
      if (!Array.isArray(existingWraps)) {
        existingWraps = []
      }

      const candidateVerifier = sha256Base64('atoll-recovery-verifier:' + data.recoveryAuthProof)
      const matchedIdx = existingWraps.findIndex(w => (typeof w === 'object' && w !== null ? w.verifier : null) === candidateVerifier)

      if (matchedIdx === -1) {
        return e.json(400, { error: 'Invalid recovery request.' })
      }

      serverRemainingWraps = existingWraps.filter((_, idx) => idx !== matchedIdx)
    }

    targetUser.setPassword(keyToHash)
    targetUser.set('encrypted_master_keys', typeof newWrappedVMK === 'object' ? JSON.stringify(newWrappedVMK) : newWrappedVMK)

    if (serverRemainingWraps !== null) {
      targetUser.set('recovery_wraps', typeof serverRemainingWraps === 'object' ? JSON.stringify(serverRemainingWraps) : serverRemainingWraps)
    } else if (data.remainingWraps !== undefined && data.remainingWraps !== '') {
      targetUser.set('recovery_wraps', typeof data.remainingWraps === 'object' ? JSON.stringify(data.remainingWraps) : data.remainingWraps)
    }

    $app.saveNoValidate(targetUser)

    // If unauthenticated recovery rotation, issue and return new auth token and updated user record
    if (!authRecord) {
      const token = targetUser.newAuthToken()
      return e.json(200, {
        success: true,
        token: token,
        record: targetUser
      })
    }

    return e.json(200, { success: true })
  } catch (err) {
    if (typeof $app.logger === 'function') {
      $app.logger().error('rotate_password error:', 'err', err ? err.toString() : 'unknown')
    }
    return e.json(400, { error: 'Invalid rotation request.' })
  }
})
