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
    } catch {
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
  } catch {
    return e.json(400, { error: 'Invalid login credentials.' })
  }

  if (!record) {
    return e.json(400, { error: 'Invalid login credentials.' })
  }

  const validPassword = record.validatePassword(data.password)

  if (!validPassword) {
    return e.json(400, { error: 'Invalid login credentials.' })
  }

  if (!data.altcha) {
    return e.json(400, { error: 'Security challenge is required.' })
  }

  if (!verifyAltchaSolution(data.altcha)) {
    return e.json(400, { error: 'Invalid security challenge. Are you a bot?' })
  }

  try {
    const token = record.newAuthToken()
    return e.json(200, {
      token: token,
      record: record
    })
  } catch (err) {
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
    } catch {
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
    const token = record.newAuthToken()
    return e.json(201, {
      success: true,
      token: token,
      record: record
    })
  } catch (err) {
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
    } catch {
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
