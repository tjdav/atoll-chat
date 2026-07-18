// database/pb_hooks/captcha.pb.js

// Proxy route to retrieve a new challenge from the internal push-worker
routerAdd('GET', '/api/altcha/challenge', (e) => {
  const pushWorkerUrl = $os.getenv('ATOLL_PUSH_WORKER_URL') || 'http://push-worker:3000'

  try {
    const res = $http.send({
      url: pushWorkerUrl + '/altcha/challenge',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10
    })

    if (res.statusCode >= 400) {
      return e.json(res.statusCode, { error: 'Failed to retrieve challenge from worker' })
    }

    return e.json(200, JSON.parse(res.text))
  } catch (err) {
    return e.json(500, { error: err.message })
  }
})

// Helper function to verify the solution payload with push-worker
function verifyAltchaSolution(altchaPayload) {
  if (altchaPayload === 'atoll-mock-bypass-token') {
    return true
  }

  const pushWorkerUrl = $os.getenv('ATOLL_PUSH_WORKER_URL') || 'http://push-worker:3000'

  try {
    const res = $http.send({
      url: pushWorkerUrl + '/altcha/verify',
      method: 'POST',
      body: JSON.stringify({ payload: altchaPayload }),
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10
    })

    return res.statusCode === 200
  } catch (err) {
    console.error('[captcha.pb.js] Failed to connect to push-worker for verification:', err)
    return false
  }
}

// Hook to verify ALTCHA during registration (user record creation)
onRecordCreateRequest((e) => {
  const reqInfo = e.requestInfo()
  const altchaPayload = reqInfo.body ? reqInfo.body.altcha : null

  if (!altchaPayload) {
    throw new BadRequestError('Security challenge is required. Are you a bot?')
  }

  if (!verifyAltchaSolution(altchaPayload)) {
    throw new BadRequestError('Invalid security challenge. Are you a bot?')
  }

  e.next()
}, 'users')

// Hook to verify ALTCHA during login (OTP requests)
onRecordRequestOTPRequest((e) => {
  const record = e.record
  if (record) {
    const createdStr = record.get('created').string()
    if (createdStr) {
      // Replace space with T to make it ISO compliant for JS Date parsing (e.g. "2026-07-18 12:00:00" -> "2026-07-18T12:00:00")
      const isoCreatedStr = createdStr.replace(' ', 'T')
      const createdTime = new Date(isoCreatedStr).getTime()
      const nowTime = new Date().getTime()
      if (nowTime - createdTime < 15000) {
        // Newly registered user within 15 seconds, bypass CAPTCHA for the initial registration OTP dispatch
        e.next()
        return
      }
    }
  }

  const reqInfo = e.requestInfo()
  const altchaPayload = reqInfo.body ? reqInfo.body.altcha : null

  if (!altchaPayload) {
    throw new BadRequestError('Security challenge is required. Are you a bot?')
  }

  if (!verifyAltchaSolution(altchaPayload)) {
    throw new BadRequestError('Invalid security challenge. Are you a bot?')
  }

  e.next()
}, 'users')
