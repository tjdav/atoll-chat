// database/pb_hooks/password_rotation.pb.js

routerAdd('POST', '/api/custom/rotate_password', (e) => {
  const authRecord = e.auth || (e.requestInfo ? e.requestInfo.authRecord : null) || (typeof e.requestInfo === 'function' ? e.requestInfo().auth : null)
  if (!authRecord) {
    return e.json(401, { error: 'Unauthorized' })
  }

  const data = new DynamicModel({
    newKeyBHash: '',
    newKeyB: '',
    newWrappedVMK: '',
    remainingWraps: ''
  })
  e.bindBody(data)

  const keyToHash = data.newKeyB || data.newKeyBHash
  const newWrappedVMK = data.newWrappedVMK

  if (!keyToHash || !newWrappedVMK) {
    return e.json(400, { error: 'Missing required rotation payload' })
  }

  let bcryptHash = ''
  if (keyToHash.indexOf('$2a$') === 0 || keyToHash.indexOf('$2b$') === 0 || keyToHash.indexOf('$2y$') === 0) {
    bcryptHash = keyToHash
  } else {
    bcryptHash = $security.bcryptHash(keyToHash)
  }

  // Execute atomic database transaction
  $app.db().transaction((tx) => {
    let queryStr = ''
    let bindParams = {}

    if (data.remainingWraps !== undefined && data.remainingWraps !== '') {
      queryStr = 'UPDATE users SET passwordHash = {:newPasswordHash}, encrypted_master_keys = {:newVMK}, recovery_wraps = {:newRecoveryWraps} WHERE id = {:id}'
      bindParams = {
        newPasswordHash: bcryptHash,
        newVMK: typeof newWrappedVMK === 'object' ? JSON.stringify(newWrappedVMK) : newWrappedVMK,
        newRecoveryWraps: typeof data.remainingWraps === 'object' ? JSON.stringify(data.remainingWraps) : data.remainingWraps,
        id: authRecord.id
      }
    } else {
      queryStr = 'UPDATE users SET passwordHash = {:newPasswordHash}, encrypted_master_keys = {:newVMK} WHERE id = {:id}'
      bindParams = {
        newPasswordHash: bcryptHash,
        newVMK: typeof newWrappedVMK === 'object' ? JSON.stringify(newWrappedVMK) : newWrappedVMK,
        id: authRecord.id
      }
    }

    tx.newQuery(queryStr)
      .bind(bindParams)
      .execute()
  })

  return e.json(200, { success: true })
}, $apis.requireAuth())
