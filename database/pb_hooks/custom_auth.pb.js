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

  const identityCanonical = data.identity.trim().toLowerCase()

  let record = null
  try {
    record = $app.findFirstRecordByFilter('users', 'username = {:identity}', { identity: identityCanonical })
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
    password: '',
    passwordConfirm: '',
    altcha: '',
    invitation_code: '',
    public_box_key: '',
    public_sign_key: '',
    encrypted_master_keys: {},
    encrypted_private_keys: {},
    recovery_wraps: [],
    vault_salt: ''
  })
  e.bindBody(data)

  if (!data.altcha) {
    return e.json(400, { error: 'Security challenge is required.' })
  }

  if (!verifyAltchaSolution(data.altcha)) {
    return e.json(400, { error: 'Invalid security challenge. Are you a bot?' })
  }

  if (!data.username || !data.password || !data.passwordConfirm) {
    return e.json(400, { error: 'Missing required registration fields.' })
  }

  const invitationCode = data.invitation_code || ''
  if (!invitationCode) {
    return e.json(400, { error: 'Invitation code is required.' })
  }

  // Phase 1: Verify Invitation Code is valid and unused
  const invitationRecord = new DynamicModel({
    id: '',
    is_used: false,
    expires_at: ''
  })

  try {
    $app.db()
      .select('id', 'is_used', 'expires_at')
      .from('invitations')
      .where($dbx.hashExp({ code: invitationCode }))
      .limit(1)
      .one(invitationRecord)
  } catch (_err) {
    return e.json(400, { error: 'Invalid invitation code.' })
  }

  if (invitationRecord.is_used) {
    return e.json(400, { error: 'Invitation code has already been used.' })
  }

  if (invitationRecord.expires_at) {
    const expiresTime = new Date(invitationRecord.expires_at).getTime()
    if (expiresTime < Date.now()) {
      return e.json(400, { error: 'Invitation code has expired.' })
    }
  }

  const usernameCanonical = data.username.trim().toLowerCase()

  try {
    /* Determine user count before creating new user; failures propagate so a
       database error is never mistaken for an empty instance. */
    const countResult = new DynamicModel({ count: 0 })
    $app.db()
      .select('count(*) as count')
      .from('users')
      .one(countResult)
    const userCount = countResult.count

    const collection = $app.findCollectionByNameOrId('users')
    const record = new Record(collection)
    record.set('username', usernameCanonical)
    // Original casing preserved!
    record.set('name', data.username.trim())
    record.set('password', data.password)
    record.set('passwordConfirm', data.passwordConfirm)
    record.set('verified', true)
    record.set('emailVisibility', false)
    if (data.public_box_key) {
      record.set('public_box_key', data.public_box_key)
    }
    if (data.public_sign_key) {
      record.set('public_sign_key', data.public_sign_key)
    }
    if (data.encrypted_master_keys) {
      record.set('encrypted_master_keys', data.encrypted_master_keys)
    }
    if (data.encrypted_private_keys) {
      record.set('encrypted_private_keys', data.encrypted_private_keys)
    }
    if (data.recovery_wraps) {
      record.set('recovery_wraps', data.recovery_wraps)
    }
    if (data.vault_salt) {
      record.set('vault_salt', data.vault_salt)
    }

    $app.save(record)

    // Phase 2: Consume the invitation code atomically after successful user creation
    const updateResult = $app.db().newQuery(
      'UPDATE invitations SET is_used = 1, used_by = {:userId}, used_count = used_count + 1 WHERE code = {:code} AND is_used = 0'
    ).bind({
      code: invitationCode,
      userId: record.id
    }).execute()

    if (updateResult.rowsAffected() === 0) {
      // Rollback
      $app.delete(record)
      return e.json(400, { error: 'Invitation code was redeemed by another user.' })
    }

    // Phase 3: Create trust record for newly registered user
    const trustColl = $app.findCollectionByNameOrId('user_trust')
    const trustRecord = new Record(trustColl)
    trustRecord.set('user', record.id)
    if (userCount === 0) {
      // First registered user gets owner status with a large invite quota
      trustRecord.set('tier', 'owner')
      trustRecord.set('invite_quota', 999999)
    } else {
      trustRecord.set('tier', 'standard')
      trustRecord.set('invite_quota', 0)
    }
    trustRecord.set('invites_revoked', false)
    $app.save(trustRecord)

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
