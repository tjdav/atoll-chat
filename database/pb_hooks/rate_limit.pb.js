// database/pb_hooks/rate_limit.pb.js

const recoveryAttempts = new Map()

routerAdd('POST', '/api/custom/recover_account', (e) => {
  const ip = e.realIP ? e.realIP() : (e.requestInfo ? e.requestInfo.ip : '127.0.0.1')
  const now = Date.now()

  const data = new DynamicModel({
    identity: '',
    username: ''
  })
  e.bindBody(data)

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

  return e.json(200, { success: true })
})
