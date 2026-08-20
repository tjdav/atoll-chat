// database/pb_hooks/password_rotation.pb.js

const rotationAttempts = new Map()

function sha256Base64 (str) {
  const utf8 = []
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i)
    if (charcode < 0x80) {
      utf8.push(charcode)
    } else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f))
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f))
    } else {
      i++
      charcode = 0x10000 + (((charcode & 0x33f) << 10) | (str.charCodeAt(i) & 0x33f))
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      )
    }
  }

  const K = [
    0x428a2f98,
    0x71374491,
    0xb5c0fbcf,
    0xe9b5dba5,
    0x3956c25b,
    0x59f111f1,
    0x923f82a4,
    0xab1c5ed5,
    0xd807aa98,
    0x12835b01,
    0x243185be,
    0x550c7dc3,
    0x72be5d74,
    0x80deb1fe,
    0x9bdc06a7,
    0xc19bf174,
    0xe49b69c1,
    0xefbe4786,
    0x0fc19dc6,
    0x240ca1cc,
    0x2de92c6f,
    0x4a7484aa,
    0x5cb0a9dc,
    0x76f988da,
    0x983e5152,
    0xa831c66d,
    0xb00327c8,
    0xbf597fc7,
    0xc6e00bf3,
    0xd5a79147,
    0x06ca6351,
    0x14292967,
    0x27b70a85,
    0x2e1b2138,
    0x4d2c6dfc,
    0x53380d13,
    0x650a7354,
    0x766a0abb,
    0x81c2c92e,
    0x92722c85,
    0xa2bfe8a1,
    0xa81a664b,
    0xc24b8b70,
    0xc76c51a3,
    0xd192e819,
    0xd6990624,
    0xf40e3585,
    0x106aa070,
    0x19a4c116,
    0x1e376c08,
    0x2748774c,
    0x34b0bcb5,
    0x391c0cb3,
    0x4ed8aa4a,
    0x5b9cca4f,
    0x682e6ff3,
    0x748f82ee,
    0x78a5636f,
    0x84c87814,
    0x8cc70208,
    0x90befffa,
    0xa4506ceb,
    0xbef9a3f7,
    0xc67178f2
  ]

  let H = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
  ]

  const bitLen = utf8.length * 8
  utf8.push(0x80)
  while ((utf8.length % 64) !== 56) {
    utf8.push(0)
  }

  const highBits = Math.floor(bitLen / 0x100000000)
  const lowBits = bitLen >>> 0

  for (let i = 3; i >= 0; i--) {
    utf8.push((highBits >>> (i * 8)) & 0xff)
  }
  for (let i = 3; i >= 0; i--) {
    utf8.push((lowBits >>> (i * 8)) & 0xff)
  }

  const W = new Array(64)
  for (let i = 0; i < utf8.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = (utf8[i + t * 4] << 24) | (utf8[i + t * 4 + 1] << 16) | (utf8[i + t * 4 + 2] << 8) | (utf8[i + t * 4 + 3])
    }
    for (let t = 16; t < 64; t++) {
      const s0 = ((W[t - 15] >>> 7) | (W[t - 15] << 25)) ^ ((W[t - 15] >>> 18) | (W[t - 15] << 14)) ^ (W[t - 15] >>> 3)
      const s1 = ((W[t - 2] >>> 17) | (W[t - 2] << 15)) ^ ((W[t - 2] >>> 19) | (W[t - 2] << 13)) ^ (W[t - 2] >>> 10)
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0
    }

    let a = H[0]
    let b = H[1]
    let c = H[2]
    let d = H[3]
    let e = H[4]
    let f = H[5]
    let g = H[6]
    let h = H[7]

    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[t] + W[t]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) | 0

      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }

    H[0] = (H[0] + a) | 0
    H[1] = (H[1] + b) | 0
    H[2] = (H[2] + c) | 0
    H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0
    H[5] = (H[5] + f) | 0
    H[6] = (H[6] + g) | 0
    H[7] = (H[7] + h) | 0
  }

  const bytes = []
  for (let i = 0; i < 8; i++) {
    bytes.push((H[i] >>> 24) & 0xff)
    bytes.push((H[i] >>> 16) & 0xff)
    bytes.push((H[i] >>> 8) & 0xff)
    bytes.push(H[i] & 0xff)
  }

  const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let b64 = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i]
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0

    const c1 = b1 >> 2
    const c2 = ((b1 & 3) << 4) | (b2 >> 4)
    const c3 = ((b2 & 15) << 2) | (b3 >> 6)
    const c4 = b3 & 63

    b64 += b64chars.charAt(c1) + b64chars.charAt(c2)
    b64 += i + 1 < bytes.length ? b64chars.charAt(c3) : '='
    b64 += i + 2 < bytes.length ? b64chars.charAt(c4) : '='
  }
  return b64
}

routerAdd('POST', '/api/custom/rotate_password', (e) => {
  const authRecord = e.auth || (e.requestInfo ? e.requestInfo.authRecord : null) || (typeof e.requestInfo === 'function' ? e.requestInfo().auth : null)

  const data = new DynamicModel({
    userId: '',
    username: '',
    newKeyBHash: '',
    newKeyB: '',
    newWrappedVMK: '',
    remainingWraps: '',
    recoveryAuthProof: ''
  })
  e.bindBody(data)

  const keyToHash = data.newKeyB || data.newKeyBHash
  const newWrappedVMK = data.newWrappedVMK

  if (!keyToHash || !newWrappedVMK) {
    return e.json(400, { error: 'Missing required rotation payload' })
  }

  let targetUser = authRecord
  let serverRemainingWraps = null

  if (!targetUser) {
    // Rate limiting for unauthenticated rotation attempts
    const ip = e.realIP ? e.realIP() : (e.requestInfo ? e.requestInfo.ip : '127.0.0.1')
    const now = Date.now()

    const targetId = (data.userId || '').trim()
    const targetUsername = (data.username || '').trim().toLowerCase()

    const ipKey = `rotation:ip:${ip}`
    const userKey = (targetId || targetUsername) ? `rotation:user:${targetId || targetUsername}` : ''

    const ipAttempts = rotationAttempts.get(ipKey) || []
    const recentIpAttempts = ipAttempts.filter(t => now - t < 3600000)

    if (recentIpAttempts.length >= 5) {
      return e.json(429, { error: 'Too many recovery attempts. Please try again later.' })
    }

    if (userKey) {
      const userAttempts = rotationAttempts.get(userKey) || []
      const recentUserAttempts = userAttempts.filter(t => now - t < 3600000)

      if (recentUserAttempts.length >= 5) {
        return e.json(429, { error: 'Too many recovery attempts. Please try again later.' })
      }

      recentUserAttempts.push(now)
      rotationAttempts.set(userKey, recentUserAttempts)
    }

    recentIpAttempts.push(now)
    rotationAttempts.set(ipKey, recentIpAttempts)

    if (!targetId && !targetUsername) {
      return e.json(401, { error: 'Unauthorized' })
    }

    if (!data.recoveryAuthProof) {
      return e.json(400, { error: 'Invalid recovery request.' })
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

    // Verify recovery wraps and candidate verifier
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

    const candidateVerifier = sha256Base64('atoll-recovery-verifier:' + data.recoveryAuthProof)
    const matchedIdx = existingWraps.findIndex(w => (typeof w === 'object' && w !== null ? w.verifier : null) === candidateVerifier)

    if (matchedIdx === -1) {
      return e.json(400, { error: 'Invalid recovery request.' })
    }

    serverRemainingWraps = existingWraps.filter((_, idx) => idx !== matchedIdx)
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

    if (serverRemainingWraps !== null) {
      queryStr = 'UPDATE users SET passwordHash = {:newPasswordHash}, encrypted_master_keys = {:newVMK}, recovery_wraps = {:newRecoveryWraps} WHERE id = {:id}'
      bindParams = {
        newPasswordHash: bcryptHash,
        newVMK: typeof newWrappedVMK === 'object' ? JSON.stringify(newWrappedVMK) : newWrappedVMK,
        newRecoveryWraps: JSON.stringify(serverRemainingWraps),
        id: targetUser.id
      }
    } else if (data.remainingWraps !== undefined && data.remainingWraps !== '') {
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
