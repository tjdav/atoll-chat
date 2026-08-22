// database/pb_hooks/rate_limit.pb.js

const recoveryAttempts = new Map()

routerAdd('POST', '/api/custom/recover_account', (e) => {
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

  const ipKey = `recovery:ip:${ip}`
  const userKey = username ? `recovery:user:${username}` : ''

  // Rate limit rule: Maximum 5 attempts per 1 hour window per IP
  const ipAttempts = recoveryAttempts.get(ipKey) || []
  const recentIpAttempts = ipAttempts.filter(t => now - t < 3600000)

  if (recentIpAttempts.length >= 5) {
    return e.json(429, { error: 'Too many recovery attempts. Please try again later.' })
  }

  // Also enforce for username/identity if provided
  if (userKey) {
    const userAttempts = recoveryAttempts.get(userKey) || []
    const recentUserAttempts = userAttempts.filter(t => now - t < 3600000)

    if (recentUserAttempts.length >= 5) {
      return e.json(429, { error: 'Too many recovery attempts. Please try again later.' })
    }

    recentUserAttempts.push(now)
    recoveryAttempts.set(userKey, recentUserAttempts)
  }

  recentIpAttempts.push(now)
  recoveryAttempts.set(ipKey, recentIpAttempts)

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
      .where($dbx.exp('username = {:username}', { username }))
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
})
