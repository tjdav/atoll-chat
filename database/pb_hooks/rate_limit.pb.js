// database/pb_hooks/rate_limit.pb.js

routerAdd('POST', '/api/custom/recover_account', (e) => {
  try {
    const info = typeof e.requestInfo === 'function' ? e.requestInfo() : (e.requestInfo || null)
    const ip = info ? (info.ip || info.remoteIP || '127.0.0.1') : '127.0.0.1'
    const now = Date.now()

    const data = new DynamicModel({
      identity: '',
      username: ''
    })
    try {
      e.bindBody(data)
    } catch (err) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }

    const username = (data.username || data.identity || '').trim().toLowerCase()
    const store = $app.store()
    const ipKey = `recovery:ip:${ip}`
    const userKey = username ? `recovery:user:${username}` : ''

    function getAttempts (key) {
      let val = store.get(key)
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val)
        } catch (_) {
          val = []
        }
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

    if (!username) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }

    const userModel = new DynamicModel({
      id: '',
      username: '',
      recovery_wraps: '',
      encrypted_private_keys: ''
    })

    try {
      $app.db()
        .select('id', 'username', 'recovery_wraps', 'encrypted_private_keys')
        .from('users')
        .where($dbx.exp('LOWER(username) = {:username}', { username }))
        .one(userModel)
    } catch (err) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }

    if (!userModel.id) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }

    let recoveryWraps = userModel.recovery_wraps || []
    if (typeof recoveryWraps === 'string') {
      try {
        recoveryWraps = JSON.parse(recoveryWraps)
      } catch (err) {
        recoveryWraps = []
      }
    }

    if (!recoveryWraps || (Array.isArray(recoveryWraps) && recoveryWraps.length === 0)) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }

    let encryptedPrivateKeys = userModel.encrypted_private_keys
    if (typeof encryptedPrivateKeys === 'string') {
      try {
        encryptedPrivateKeys = JSON.parse(encryptedPrivateKeys)
      } catch (err) {
      }
    }

    return e.json(200, {
      success: true,
      user: {
        id: userModel.id,
        username: userModel.username,
        recovery_wraps: recoveryWraps,
        encrypted_private_keys: encryptedPrivateKeys
      }
    })
  } catch (err) {
    if (typeof $app.logger === 'function') {
      $app.logger().error('recover_account error:', 'err', err ? err.toString() : 'unknown')
    }
    return e.json(400, { error: 'Invalid recovery request.' })
  }
})
