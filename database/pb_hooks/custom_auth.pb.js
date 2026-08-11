// database/pb_hooks/custom_auth.pb.js

/**
 * POST /api/custom/login
 *
 * Authenticates a user using their username/identity and password,
 * while verifying an Altcha security challenge.
 *
 * @param {Object} e - The PocketBase router context event object.
 * @returns {void}
 */
routerAdd('POST', '/api/custom/login', (e) => {
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

  const records = $app.findRecordsByFilter('users', 'username = {:identity}', '', 1, 0, { identity: identityCanonical })
  if (records.length === 0) {
    return e.json(400, { error: 'Invalid login credentials.' })
  }

  const record = records[0]
  const validPassword = record.validatePassword(data.password)

  if (!validPassword) {
    return e.json(400, { error: 'Invalid login credentials.' })
  }

  if (!data.altcha) {
    return e.json(400, { error: 'Security challenge is required.' })
  }

  const { verifyAltchaSolution } = require(`${__hooks}/altcha.js`)

  try {
    if (!verifyAltchaSolution(data.altcha)) {
      return e.json(400, { error: 'Invalid security challenge. Are you a bot?' })
    }
  } catch (err) {
    return e.json(500, { error: 'Security verification failed: ' + err.message })
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

/**
 * POST /api/custom/register
 *
 * Registers a new user with an unused, valid invitation code,
 * verifies an Altcha security challenge, and dynamically assigns
 * standard or owner role based on user count.
 *
 * @param {Object} e - The PocketBase router context event object.
 * @returns {void}
 */
routerAdd('POST', '/api/custom/register', (e) => {
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

  const { verifyAltchaSolution } = require(`${__hooks}/altcha.js`)

  try {
    if (!verifyAltchaSolution(data.altcha)) {
      return e.json(400, { error: 'Invalid security challenge. Are you a bot?' })
    }
  } catch (err) {
    return e.json(500, { error: 'Security verification failed: ' + err.message })
  }

  if (!data.username || !data.password || !data.passwordConfirm) {
    return e.json(400, { error: 'Missing required registration fields.' })
  }

  const invitationCode = data.invitation_code || ''
  if (!invitationCode) {
    return e.json(400, { error: 'Invitation code is required.' })
  }

  // Phase 1: Verify Invitation Code is valid and unused
  const invitations = $app.findRecordsByFilter('invitations', 'code = {:code}', '', 1, 0, { code: invitationCode })
  if (invitations.length === 0) {
    return e.json(400, { error: 'Invalid invitation code.' })
  }

  const invitationRecord = invitations[0]

  if (invitationRecord.get('is_used')) {
    return e.json(400, { error: 'Invitation code has already been used.' })
  }

  const expiresAt = invitationRecord.get('expires_at')
  if (expiresAt) {
    const expiresTime = new Date(expiresAt).getTime()
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
