// database/pb_hooks/password_rotation.pb.js

routerAdd('POST', '/api/custom/rotate_password', (e) => {
  const authRecord = e.auth || (e.requestInfo ? e.requestInfo.authRecord : null) || (typeof e.requestInfo === 'function' ? e.requestInfo().auth : null)

  const data = new DynamicModel({
    userId: '',
    username: '',
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

  let targetUser = authRecord

  if (!targetUser) {
    // Unauthenticated rotation flow via recovery code
    const targetId = (data.userId || '').trim()
    const targetUsername = (data.username || '').trim().toLowerCase()

    if (!targetId && !targetUsername) {
      return e.json(401, { error: 'Unauthorized' })
    }

    let records = []
    if (targetId) {
      records = $app.findRecordsByFilter('users', 'id = {:id}', '', 1, 0, { id: targetId })
    }
    if (records.length === 0 && targetUsername) {
      records = $app.findRecordsByFilter('users', 'username = {:username}', '', 1, 0, { username: targetUsername })
    }

    if (records.length === 0) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }

    targetUser = records[0]

    // Verify recovery wrap reduction rules
    let existingWraps = targetUser.get('recovery_wraps') || []
    if (typeof existingWraps === 'string') {
      try {
        existingWraps = JSON.parse(existingWraps)
      } catch (err) {
      }
    }
    if (!Array.isArray(existingWraps)) {
      existingWraps = []
    }

    let remainingWrapsArr = data.remainingWraps
    if (typeof remainingWrapsArr === 'string') {
      try {
        remainingWrapsArr = JSON.parse(remainingWrapsArr)
      } catch (err) {
      }
    }
    if (!Array.isArray(remainingWrapsArr)) {
      remainingWrapsArr = []
    }

    if (existingWraps.length < 1 || remainingWrapsArr.length !== existingWraps.length - 1) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }

    // Verify every remaining wrap exists in existingWraps
    const existingStrings = existingWraps.map(w => (typeof w === 'string' ? w : JSON.stringify(w)))
    const allMatch = remainingWrapsArr.every(w => {
      const str = typeof w === 'string' ? w : JSON.stringify(w)
      return existingStrings.includes(str)
    })

    if (!allMatch) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }
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
        id: targetUser.id
      }
    } else {
      queryStr = 'UPDATE users SET passwordHash = {:newPasswordHash}, encrypted_master_keys = {:newVMK} WHERE id = {:id}'
      bindParams = {
        newPasswordHash: bcryptHash,
        newVMK: typeof newWrappedVMK === 'object' ? JSON.stringify(newWrappedVMK) : newWrappedVMK,
        id: targetUser.id
      }
    }

    tx.newQuery(queryStr)
      .bind(bindParams)
      .execute()
  })

  // If unauthenticated recovery rotation, issue and return new auth token and updated user record
  if (!authRecord) {
    const updatedRecords = $app.findRecordsByFilter('users', 'id = {:id}', '', 1, 0, { id: targetUser.id })
    const updatedUser = updatedRecords[0] || targetUser
    const token = updatedUser.newAuthToken()
    return e.json(200, {
      success: true,
      token: token,
      record: updatedUser
    })
  }

  return e.json(200, { success: true })
})
