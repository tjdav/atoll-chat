// database/pb_hooks/custom_auth.pb.js

// Custom Login Route
routerAdd('POST', '/api/custom/login', (e) => {
  const verifyAltchaSolution = (altchaPayload) => {
    const pushWorkerUrl = $os.getenv('ATOLL_PUSH_WORKER_URL') || 'http://localhost:3001'
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
      console.error('[custom_auth.pb.js] Failed to verify ALTCHA:', err)
      return false
    }
  }

  const data = new DynamicModel({
    identity: '',
    password: '',
    altcha: ''
  })
  e.bindBody(data)

  if (!data.identity || !data.password) {
    return e.json(400, { error: 'Missing identity or password.' })
  }

  let record = null
  try {
    record = $app.findFirstRecordByFilter('users', 'email = {:identity} || username = {:identity}', { identity: data.identity })
    console.log('[DEBUG LOGIN] Found record:', record ? record.get('username') : 'null')
  } catch (err) {
    console.log('[DEBUG LOGIN] findFirstRecordByFilter error:', err.message)
    return e.json(400, { error: 'Invalid login credentials.' })
  }

  if (!record) {
    console.log('[DEBUG LOGIN] No record found for identity:', data.identity)
    return e.json(400, { error: 'Invalid login credentials.' })
  }

  const validPassword = record.validatePassword(data.password)
  console.log('[DEBUG LOGIN] isPasswordValid:', validPassword)

  if (!validPassword) {
    return e.json(400, { error: 'Invalid login credentials.' })
  }

  // Bypass ALTCHA verification if the user record was created less than 60 seconds ago (auto-login after registration)
  let isAutoLogin = false
  if (record) {
    let createdStr = record.get('created') + ''
    if (createdStr && !createdStr.endsWith('Z')) {
      createdStr = createdStr.replace(' ', 'T') + 'Z'
    }
    const createdTime = new Date(createdStr).getTime()
    const nowTime = Date.now()
    const diff = nowTime - createdTime
    console.log('[DEBUG LOGIN] createdStr:', createdStr, 'createdTime:', createdTime, 'nowTime:', nowTime, 'diff:', diff)
    isAutoLogin = (diff >= 0 && diff < 60000)
    console.log('[DEBUG LOGIN] isAutoLogin evaluated to:', isAutoLogin)
  }

  if (!isAutoLogin) {
    if (!data.altcha) {
      return e.json(400, { error: 'Security challenge is required.' })
    }

    if (!verifyAltchaSolution(data.altcha)) {
      return e.json(400, { error: 'Invalid security challenge. Are you a bot?' })
    }
  }

  try {
    const token = record.newAuthToken()
    console.log('[DEBUG LOGIN] Token generated successfully:', token.slice(0, 10) + '...')
    return e.json(200, {
      token: token,
      record: record
    })
  } catch (err) {
    console.log('[DEBUG LOGIN] Token generation or JSON error:', err.message)
    return e.json(500, { error: err.message })
  }
})

// Custom Register Route
routerAdd('POST', '/api/custom/register', (e) => {
  const verifyAltchaSolution = (altchaPayload) => {
    const pushWorkerUrl = $os.getenv('ATOLL_PUSH_WORKER_URL') || 'http://localhost:3001'
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
      console.error('[custom_auth.pb.js] Failed to verify ALTCHA:', err)
      return false
    }
  }

  const data = new DynamicModel({
    username: '',
    email: '',
    password: '',
    passwordConfirm: '',
    altcha: ''
  })
  e.bindBody(data)

  if (!data.altcha) {
    return e.json(400, { error: 'Security challenge is required.' })
  }

  if (!verifyAltchaSolution(data.altcha)) {
    return e.json(400, { error: 'Invalid security challenge. Are you a bot?' })
  }

  if (!data.username || !data.email || !data.password || !data.passwordConfirm) {
    return e.json(400, { error: 'Missing required registration fields.' })
  }

  try {
    console.log('[DEBUG REGISTER] Registering user:', data.username, data.email)
    const collection = $app.findCollectionByNameOrId('users')
    const record = new Record(collection)
    record.set('username', data.username)
    record.set('email', data.email)
    record.set('name', data.username)
    record.set('password', data.password)
    record.set('passwordConfirm', data.passwordConfirm)
    record.set('verified', true)
    record.set('emailVisibility', true)

    $app.save(record)
    console.log('[DEBUG REGISTER] User saved successfully. ID:', record.id)
    return e.json(201, {
      success: true,
      record: record
    })
  } catch (err) {
    console.log('[DEBUG REGISTER] Save error:', err.message)
    return e.json(400, { error: err.message })
  }
})

// Custom Password Reset Route
routerAdd('POST', '/api/custom/password-reset', (e) => {
  const verifyAltchaSolution = (altchaPayload) => {
    const pushWorkerUrl = $os.getenv('ATOLL_PUSH_WORKER_URL') || 'http://localhost:3001'
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
      console.error('[custom_auth.pb.js] Failed to verify ALTCHA:', err)
      return false
    }
  }

  const data = new DynamicModel({
    email: '',
    altcha: ''
  })
  e.bindBody(data)

  if (!data.altcha) {
    return e.json(400, { error: 'Security challenge is required.' })
  }

  if (!verifyAltchaSolution(data.altcha)) {
    return e.json(400, { error: 'Invalid security challenge. Are you a bot?' })
  }

  if (!data.email) {
    return e.json(400, { error: 'Email is required.' })
  }

  try {
    const record = $app.findAuthRecordByEmail('users', data.email)
    if (record) {
      $mails.sendRecordPasswordReset($app, record)
    }
  } catch (_err) {
    // Return 200 even if record not found to prevent user enumeration
  }
  return e.json(200, {
    success: true,
    message: 'Password reset email sent if account exists.'
  })
})
