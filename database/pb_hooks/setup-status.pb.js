// pb_hooks/setup-status.pb.js

routerAdd('GET', '/api/status', (e) => {
  const result = new DynamicModel({ count: 0 })
  try {
    $app.db()
      .select('count(*) as count')
      .from('users')
      .one(result)
  } catch (err) {
  }

  return e.json(200, {
    isFirstRun: result.count === 0
  })
})

routerAdd('POST', '/api/setup', (e) => {
  // Check if setup is already complete
  const checkResult = new DynamicModel({ count: 0 })
  try {
    $app.db()
      .select('count(*) as count')
      .from('users')
      .one(checkResult)
  } catch (err) {
  }

  if (checkResult.count > 0) {
    return e.json(403, { message: 'Setup already completed' })
  }

  const data = e.requestInfo().body

  // Create the Superuser
  try {
    const collection = $app.findCollectionByNameOrId('_superusers')
    const superuser = new Record(collection)
    superuser.setEmail(data.email)
    superuser.setPassword(data.password)
    $app.save(superuser)
  } catch (err) {
    $app.logger().error('Failed to create superuser', 'error', err.message)
    return e.json(500, { message: 'Failed to create superuser: ' + err.message })
  }

  // Create the first App User (with E2EE keys)
  try {
    const collection = $app.findCollectionByNameOrId('users')
    const record = new Record(collection)

    record.set('username', data.username)
    record.set('name', data.username)
    record.set('email', data.email)
    record.set('emailVisibility', true)
    record.set('password', data.password)
    record.set('passwordConfirm', data.password)

    // E2EE fields
    record.set('public_box_key', data.public_box_key)
    record.set('public_sign_key', data.public_sign_key)
    record.set('encrypted_master_keys', data.encrypted_master_keys)

    if (data.vault_salt) {
      record.set('vault_salt', data.vault_salt)
    }

    if (data.passkey_credential_id) {
      record.set('passkey_credential_id', data.passkey_credential_id)
      record.set('passkey_prf_salt', data.passkey_prf_salt)
      record.set('encrypted_master_keys_passkey', data.encrypted_master_keys_passkey)
    }

    $app.save(record)
  } catch (err) {
    $app.logger().error('Failed to create app user', 'error', err.message)
    return e.json(500, { message: 'Failed to create app user: ' + err.message })
  }

  return e.json(200, { message: 'Setup successful' })
})
