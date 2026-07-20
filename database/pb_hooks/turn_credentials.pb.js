// database/pb_hooks/turn_credentials.pb.js

routerAdd('GET', '/api/turn-credentials', (e) => {
  /**
   * Retrieves the value of the environment variable named by the key.
   *
   * @param {string} key - The environment variable name.
   * @returns {string|undefined} The environment variable value or undefined if not present.
   */
  function getEnv (key) {
    if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
      return process.env[key]
    }

    if (typeof $os !== 'undefined' && typeof $os.getenv === 'function') {
      return $os.getenv(key)
    }

    return undefined
  }

  /**
   * Performs a bitwise rotate-left operation on a 32-bit integer.
   *
   * @param {number} num - The 32-bit integer to rotate.
   * @param {number} cnt - The bit count to rotate by.
   * @returns {number} The rotated 32-bit integer.
   */
  function rol (num, cnt) {
    return (num << cnt) | (num >>> (32 - cnt))
  }

  /**
   * Safely adds two 32-bit integers, preventing overflow issues.
   *
   * @param {number} x - The first integer.
   * @param {number} y - The second integer.
   * @returns {number} The sum of x and y.
   */
  function safeAdd (x, y) {
    const lsw = (x & 0xFFFF) + (y & 0xFFFF)
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16)
    return (msw << 16) | (lsw & 0xFFFF)
  }

  /**
   * Helper function for SHA-1 round calculations.
   *
   * @param {number} t - The round index.
   * @param {number} b - Word B.
   * @param {number} c - Word C.
   * @param {number} d - Word D.
   * @returns {number} The round result.
   */
  function sha1Ft (t, b, c, d) {
    if (t < 20) {
      return (b & c) | ((~b) & d)
    }
    if (t < 40) {
      return b ^ c ^ d
    }
    if (t < 60) {
      return (b & c) | (b & d) | (c & d)
    }
    return b ^ c ^ d
  }

  /**
   * Helper function returning SHA-1 round constants.
   *
   * @param {number} t - The round index.
   * @returns {number} The round constant.
   */
  function sha1Kt (t) {
    if (t < 20) {
      return 1518500249
    }
    if (t < 40) {
      return 1859775393
    }
    if (t < 60) {
      return -1894007588
    }
    return -899497514
  }

  /**
   * Converts a string to an array of big-endian 32-bit words.
   *
   * @param {string} str - The input string.
   * @returns {number[]} The array of 32-bit words.
   */
  function str2binb (str) {
    const bin = []
    const mask = 0xFF
    for (let i = 0; i < str.length * 8; i += 8) {
      const wordIdx = i >> 5
      const bitShift = 24 - (i % 32)
      bin[wordIdx] = (bin[wordIdx] || 0) | ((str.charCodeAt(i / 8) & mask) << bitShift)
    }
    return bin
  }

  /**
   * Core SHA-1 hash function over an array of 32-bit words.
   *
   * @param {number[]} x - The input words.
   * @param {number} len - The bit length of the input.
   * @returns {number[]} The 5-word SHA-1 digest.
   */
  function coreSha1 (x, len) {
    const paddedX = [...x]
    const wordIndex = len >> 5
    const bitOffset = 24 - (len % 32)
    paddedX[wordIndex] = (paddedX[wordIndex] || 0) | (0x80 << bitOffset)

    const finalLengthIdx = ((len + 64 >> 9) << 4) + 15
    paddedX[finalLengthIdx] = len

    const w = new Array(80)
    let a = 1732584193
    let b = -271733879
    let c = -1732584194
    let d = 271733878
    let e = -1009589776

    for (let i = 0; i < paddedX.length; i += 16) {
      const olda = a
      const oldb = b
      const oldc = c
      const oldd = d
      const olde = e

      for (let j = 0; j < 80; j++) {
        if (j < 16) {
          w[j] = paddedX[i + j] || 0
        } else {
          w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1)
        }
        const t = safeAdd(
          safeAdd(rol(a, 5), sha1Ft(j, b, c, d)),
          safeAdd(safeAdd(e, w[j]), sha1Kt(j))
        )
        e = d
        d = c
        c = rol(b, 30)
        b = a
        a = t
      }

      a = safeAdd(a, olda)
      b = safeAdd(b, oldb)
      c = safeAdd(c, oldc)
      d = safeAdd(d, oldd)
      e = safeAdd(e, olde)
    }
    return [a, b, c, d, e]
  }

  /**
   * Computes the raw HMAC-SHA-1 signature of a message using a key.
   *
   * @param {string} key - The HMAC key.
   * @param {string} data - The message to sign.
   * @returns {number[]} The raw SHA-1 HMAC digest.
   */
  function coreHmacSha1 (key, data) {
    let bkey = str2binb(key)
    if (bkey.length > 16) {
      bkey = coreSha1(bkey, key.length * 8)
    }

    const ipad = new Array(16)
    const opad = new Array(16)
    for (let i = 0; i < 16; i++) {
      const keyWord = bkey[i] || 0
      ipad[i] = keyWord ^ 0x36363636
      opad[i] = keyWord ^ 0x5C5C5C5C
    }

    const innerData = ipad.concat(str2binb(data))
    const hash = coreSha1(innerData, 512 + (data.length * 8))
    const outerData = opad.concat(hash)
    return coreSha1(outerData, 512 + 160)
  }

  /**
   * Converts an array of 32-bit words to a Base64 string.
   *
   * @param {number[]} binarray - The array of 32-bit words.
   * @returns {string} The Base64 encoded string.
   */
  function binb2b64 (binarray) {
    const tab = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let str = ''
    for (let i = 0; i < binarray.length * 4; i += 3) {
      const word0 = binarray[i >> 2] || 0
      const word1 = binarray[i + 1 >> 2] || 0
      const word2 = binarray[i + 2 >> 2] || 0

      const byte0 = (word0 >> (8 * (3 - (i % 4)))) & 0xFF
      const byte1 = (word1 >> (8 * (3 - ((i + 1) % 4)))) & 0xFF
      const byte2 = (word2 >> (8 * (3 - ((i + 2) % 4)))) & 0xFF

      const triplet = (byte0 << 16) | (byte1 << 8) | byte2
      for (let j = 0; j < 4; j++) {
        if ((i * 8) + (j * 6) > binarray.length * 32) {
          str += '='
        } else {
          str += tab.charAt((triplet >> (6 * (3 - j))) & 0x3F)
        }
      }
    }
    return str
  }

  /**
   * Computes the Base64 HMAC-SHA1 signature of a message.
   *
   * @param {string} key - The cryptographic key.
   * @param {string} data - The message payload.
   * @returns {string} The Base64 signature.
   */
  function hmacSha1Base64 (key, data) {
    return binb2b64(coreHmacSha1(key, data))
  }

  const sharedSecret = getEnv('ATOLL_TURN_SHARED_SECRET') || 'REPLACE_THIS_WITH_A_LONG_RANDOM_STRING'
  const expiresEnv = getEnv('ATOLL_TURN_EXPIRES_IN_SECONDS')
  const expiresInSeconds = expiresEnv ? parseInt(expiresEnv, 10) : 3600

  const unixTimestamp = Math.floor(Date.now() / 1000) + expiresInSeconds

  // Direct access to e.auth in PocketBase v0.39.8
  const authRecord = e.auth

  const userId = authRecord ? authRecord.id : 'unknown_user'
  const username = `${unixTimestamp}:${userId}`
  const password = hmacSha1Base64(sharedSecret, username)

  const turnUrisEnv = getEnv('ATOLL_TURN_URIS')
  const uris = turnUrisEnv ? turnUrisEnv.split(',').map(s => s.trim()) : ['stun.l.google.com:19302', 'stun1.l.google.com:19302', 'stun2.l.google.com:19302', 'stun3.l.google.com:19302', 'stun4.l.google.com:19302']

  return e.json(200, {
    username,
    password,
    ttl: expiresInSeconds,
    uris
  })
}, $apis.requireAuth())
