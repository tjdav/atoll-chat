import http from 'http'
import url from 'url'
import crypto from 'crypto'

const databases = {}

function generateMockJWT (userId) {
  const header = Buffer.from(JSON.stringify({
    alg: 'HS256',
    typ: 'JWT'
  })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    id: userId,
    exp: Math.floor(Date.now() / 1000) + (3600 * 24 * 365)
  })).toString('base64url')
  const signature = 'mocksignature'
  return `${header}.${payload}.${signature}`
}

function getUserIdFromToken (token) {
  if (!token) {
    return null
  }
  const cleanToken = token.replace(/^Bearer\s+/i, '')
  const parts = cleanToken.split('.')
  if (parts.length !== 3) {
    return null
  }
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload = JSON.parse(payloadJson)
    return payload.id
  } catch {
    return null
  }
}

const isVerbose = Boolean(process.env.DEBUG || process.env.VERBOSE)

function logVerbose (...args) {
  if (isVerbose) {
    console.log(...args)
  }
}

function sanitizeUserRecord (authHeader, record) {
  if (!record || (record.collectionName && record.collectionName !== 'users')) {
    return record
  }
  const requesterId = getUserIdFromToken(authHeader)
  const isOwner = requesterId && requesterId === record.id
  if (!isOwner && record.encrypted_master_keys) {
    const copy = { ...record }
    delete copy.encrypted_master_keys
    return copy
  }
  return record
}

function evaluateFilter (record, filterStr) {
  if (!filterStr) {
    return true
  }

  const matchCondition = (rec, cond) => {
    cond = cond.trim()
    if (!cond) {
      return true
    }

    const operators = [
      {
        op: '!=',
        fn: (v, target) => String(v) !== String(target)
      },
      {
        op: '=',
        fn: (v, target) => String(v) === String(target)
      },
      {
        op: '~',
        fn: (v, target) => String(v).toLowerCase().includes(String(target).toLowerCase())
      },
      {
        op: '>=',
        fn: (v, target) => new Date(v) >= new Date(target)
      },
      {
        op: '<=',
        fn: (v, target) => new Date(v) <= new Date(target)
      },
      {
        op: '>',
        fn: (v, target) => new Date(v) > new Date(target)
      },
      {
        op: '<',
        fn: (v, target) => new Date(v) < new Date(target)
      }
    ]

    for (const { op, fn } of operators) {
      if (cond.includes(op)) {
        let [field, val] = cond.split(op)
        field = field.trim().replace(/^['"\s(]+|['"\s)]+$/g, '')
        val = val.trim().replace(/^['"\s(]+|['"\s)]+$/g, '')

        const recordValue = rec[field]
        if (recordValue === undefined) {
          return false
        }
        return fn(recordValue, val)
      }
    }
    return true
  }

  if (filterStr.includes('||')) {
    const parts = filterStr.split('||')
    return parts.some(p => evaluateFilter(record, p))
  }

  if (filterStr.includes('&&')) {
    const parts = filterStr.split('&&')
    return parts.every(p => evaluateFilter(record, p))
  }

  return matchCondition(record, filterStr)
}

function expandRecord (db, record, expandStr) {
  if (!expandStr) {
    return record
  }
  const expanded = { ...record }
  expanded.expand = expanded.expand || {}

  const fields = expandStr.split(',').map(f => f.trim())
  for (const field of fields) {
    if (field === 'user_id' && record.user_id) {
      const user = db.users.find(u => u.id === record.user_id)
      if (user) {
        expanded.expand.user_id = user
      }
    }
    if (field === 'room_id' && record.room_id) {
      const room = db.rooms.find(r => r.id === record.room_id)
      if (room) {
        expanded.expand.room_id = room
      }
    }
  }
  return expanded
}

function parseMultipart (bodyBuffer, boundary) {
  const boundaryBuffer = Buffer.from('--' + boundary)
  const parts = []
  let startIndex = 0

  while (true) {
    const index = bodyBuffer.indexOf(boundaryBuffer, startIndex)
    if (index === -1) {
      break
    }

    const nextIndex = bodyBuffer.indexOf(boundaryBuffer, index + boundaryBuffer.length)
    if (nextIndex === -1) {
      break
    }

    const partBuffer = bodyBuffer.subarray(index + boundaryBuffer.length, nextIndex)
    parts.push(partBuffer)
    startIndex = nextIndex
  }

  const fields = {}
  const files = []
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) {
      continue
    }

    const headersStr = part.subarray(0, headerEnd).toString('utf8')
    // strip trailing \r\n
    const body = part.subarray(headerEnd + 4, part.length - 2)

    const nameMatch = headersStr.match(/name="([^"]+)"/)
    if (nameMatch) {
      const name = nameMatch[1]
      const filenameMatch = headersStr.match(/filename="([^"]+)"/)
      if (filenameMatch) {
        files.push({
          name,
          filename: filenameMatch[1],
          buffer: body
        })
      } else {
        fields[name] = body.toString('utf8').trim()
      }
    }
  }
  return {
    fields,
    files
  }
}

function getDatabase (testId) {
  if (!databases[testId]) {
    logVerbose(`[MOCK PB] Initializing new database for testId: ${testId}`)
    databases[testId] = {
      users: [],
      rooms: [],
      room_members: [],
      room_settings: [],
      room_member_states: [],
      messages: [],
      media: [],
      invitations: [],
      app_metadata: [],
      user_trust: [],
      invite_requests: [],
      mediaFiles: {},
      sseClients: []
    }
  }
  return databases[testId]
}

function broadcast (db, collectionName, action, record) {
  const eventName = `${collectionName}/*`
  const data = JSON.stringify({
    action,
    record
  })

  logVerbose(`[MOCK PB] Broadcasting "${eventName}" action "${action}" to ${db.sseClients.length} clients. Subscriptions list:`, db.sseClients.map(c => `${c.clientId}: [${c.subscriptions.join(', ')}]`))

  for (const client of db.sseClients) {
    if (client.subscriptions.includes('*') || client.subscriptions.includes(eventName)) {
      try {
        logVerbose(`[MOCK PB] Delivering event "${eventName}" to client ${client.clientId}`)
        client.res.write(`event: ${eventName}\ndata: ${data}\n\n`)
      } catch (err) {
        console.error('Failed to write to SSE client:', err.message)
      }
    }
  }
}

/**
 *
 */
export function createServer () {
  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true)
    const pathname = (parsedUrl.pathname || '').replace(/\/+$/, '') || '/'
    const query = parsedUrl.query

    // CORS Headers
    const origin = req.headers.origin || '*'
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-test-id')
    res.setHeader('Access-Control-Allow-Credentials', 'true')

    // Safety Headers (simulating Goja security_headers.pb.js)
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Worker-Token, x-test-id')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const testId = req.headers['x-test-id'] || query['x-test-id'] || 'default'
    const db = getDatabase(testId)

    logVerbose(`[MOCK PB] [${testId}] ${req.method} ${pathname}`)

    // Raw body parser
    let bodyBuffer = Buffer.alloc(0)
    req.on('data', chunk => {
      bodyBuffer = Buffer.concat([bodyBuffer, chunk])
    })

    req.on('end', () => {
      let body = {}
      let files = []

      const contentType = req.headers['content-type'] || ''
      if (contentType.includes('application/json') && bodyBuffer.length > 0) {
        try {
          body = JSON.parse(bodyBuffer.toString('utf8'))
        } catch {
        }
      } else if (contentType.includes('multipart/form-data')) {
        const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/)
        if (boundaryMatch) {
          const parsed = parseMultipart(bodyBuffer, boundaryMatch[1])
          body = parsed.fields
          files = parsed.files
        }
      }

      // Health endpoint
      if (pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          code: 200,
          message: 'Healthy'
        }))
        return
      }

      /* Mock Check Availability endpoint for tests */
      if (pathname === '/api/check-availability') {
        const username = query.username

        let usernameExists = false

        if (username) {
          const usernameCanonical = username.trim().toLowerCase()
          usernameExists = db.users.some(u => u.username === usernameCanonical)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          usernameExists,
          emailExists: false
        }))
        return
      }

      /* Mock ALTCHA Challenge endpoint for tests */
      if (pathname === '/api/altcha/challenge') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          algorithm: 'SHA-256',
          challenge: '58196f3f56be3d0ba9e3db52c5699796b3fc220c89fca9560f4d682c8ec91f8d',
          salt: '0123456789abcdef',
          signature: 'mock-signature'
        }))
        return
      }

      // Custom Administration & Governance API Endpoints for testing

      // GET /api/custom/admin/overview
      if (pathname === '/api/custom/admin/overview' && req.method === 'GET') {
        const authHeader = req.headers.authorization || ''
        const userId = getUserIdFromToken(authHeader)
        if (!userId) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          metadata: {
            invite_mode: db.invite_mode || 'delegated',
            default_trusted_quota: db.default_trusted_quota || 5,
            max_uses_per_invite: db.max_uses_per_invite || 3,
            allow_quota_requests: db.allow_quota_requests !== false
          },
          stats: {
            totalUsers: db.users.length,
            activeRooms: db.rooms.length,
            activeInvitations: db.invitations.length,
            pendingInviteRequests: (db.invite_requests || []).filter(r => r.status === 'pending').length
          }
        }))
        return
      }

      // POST /api/custom/admin/settings
      if (pathname === '/api/custom/admin/settings' && req.method === 'POST') {
        const { invite_mode, default_trusted_quota, max_uses_per_invite, allow_quota_requests } = body
        if (invite_mode) {
          db.invite_mode = invite_mode
        }
        if (default_trusted_quota !== undefined) {
          db.default_trusted_quota = default_trusted_quota
        }
        if (max_uses_per_invite !== undefined) {
          db.max_uses_per_invite = max_uses_per_invite
        }
        if (allow_quota_requests !== undefined) {
          db.allow_quota_requests = allow_quota_requests
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // POST /api/custom/admin/users/trust
      if (pathname === '/api/custom/admin/users/trust' && req.method === 'POST') {
        const { userId, tier, invite_quota, invites_revoked } = body
        db.user_trust = db.user_trust || []
        let trust = db.user_trust.find(t => t.user === userId)
        if (!trust) {
          trust = {
            id: 'trust_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10),
            user: userId,
            tier: 'standard',
            invite_quota: 0,
            invites_revoked: false
          }
          db.user_trust.push(trust)
        }
        if (tier) {
          trust.tier = tier
        }
        if (invite_quota !== undefined) {
          trust.invite_quota = invite_quota
        }
        if (invites_revoked !== undefined) {
          trust.invites_revoked = invites_revoked
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // POST /api/custom/admin/requests/resolve
      if (pathname === '/api/custom/admin/requests/resolve' && req.method === 'POST') {
        const { requestId, status } = body
        db.invite_requests = db.invite_requests || []
        const reqRec = db.invite_requests.find(r => r.id === requestId)
        if (reqRec) {
          reqRec.status = status
          if (status === 'approved') {
            db.user_trust = db.user_trust || []
            let trust = db.user_trust.find(t => t.user === reqRec.requester)
            if (!trust) {
              trust = {
                id: 'trust_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10),
                user: reqRec.requester,
                tier: 'standard',
                invite_quota: 0,
                invites_revoked: false
              }
              db.user_trust.push(trust)
            }
            trust.invite_quota = (trust.invite_quota || 0) + (reqRec.requested_count || 1)
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // GET /api/custom/owner/public-key
      if (pathname === '/api/custom/owner/public-key' && req.method === 'GET') {
        const authHeader = req.headers.authorization || ''
        const userId = getUserIdFromToken(authHeader)
        if (!userId) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        db.user_trust = db.user_trust || []
        let ownerTrust = db.user_trust.find(t => t.tier === 'owner')
        let ownerUser
        if (ownerTrust) {
          ownerUser = db.users.find(u => u.id === ownerTrust.user)
        } else {
          ownerUser = db.users[0]
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ownerPublicKey: ownerUser ? (ownerUser.public_box_key || '') : ''
        }))
        return
      }

      // POST /api/custom/invites/generate
      if (pathname === '/api/custom/invites/generate' && req.method === 'POST') {
        const authHeader = req.headers.authorization || ''
        const userId = getUserIdFromToken(authHeader)
        if (!userId) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        function randSeg (len) {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
          let res = ''
          for (let i = 0; i < len; i++) {
            res += chars.charAt(Math.floor(Math.random() * chars.length))
          }
          return res
        }
        const code = `INV-${randSeg(4)}-${randSeg(4)}`

        const newInvite = {
          id: 'inv_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10),
          code: code,
          is_used: false,
          max_uses: db.max_uses_per_invite || 3,
          used_count: 0,
          created_by: userId,
          created: new Date().toISOString()
        }
        db.invitations.push(newInvite)

        // Deduct from quota if standard
        db.user_trust = db.user_trust || []
        const trust = db.user_trust.find(t => t.user === userId)
        if (trust && trust.tier !== 'owner' && trust.invite_quota > 0) {
          trust.invite_quota -= 1
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: newInvite.id,
          code: code,
          is_used: false,
          max_uses: db.max_uses_per_invite || 3,
          used_count: 0,
          expires_at: null,
          used_by: null,
          created: newInvite.created
        }))
        return
      }

      // GET /api/custom/invites/list
      if (pathname === '/api/custom/invites/list' && req.method === 'GET') {
        const authHeader = req.headers.authorization || ''
        const userId = getUserIdFromToken(authHeader)
        if (!userId) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        db.user_trust = db.user_trust || []
        const trust = db.user_trust.find(t => t.user === userId)
        const isOwner = trust && trust.tier === 'owner'

        let list = []
        if (isOwner) {
          list = db.invitations || []
        } else {
          list = (db.invitations || []).filter(inv => inv.created_by === userId)
        }

        const results = list.map(inv => {
          let usedByUser = null
          if (inv.used_by) {
            const userRec = db.users.find(u => u.id === inv.used_by)
            if (userRec) {
              usedByUser = {
                id: userRec.id,
                username: userRec.username,
                name: userRec.name
              }
            }
          }
          return {
            id: inv.id,
            code: inv.code,
            is_used: inv.is_used || false,
            max_uses: inv.max_uses || 3,
            used_count: inv.used_count || 0,
            expires_at: inv.expires_at || null,
            used_by: usedByUser,
            created: inv.created || new Date().toISOString()
          }
        })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(results))
        return
      }

      // POST /api/custom/invites/request
      if (pathname === '/api/custom/invites/request' && req.method === 'POST') {
        const authHeader = req.headers.authorization || ''
        const userId = getUserIdFromToken(authHeader)
        if (!userId) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        const { requested_count, encrypted_reason } = body
        db.invite_requests = db.invite_requests || []
        const reqId = 'req_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10)
        const newReq = {
          id: reqId,
          requester: userId,
          requested_count: requested_count || 1,
          encrypted_reason: encrypted_reason || '',
          status: 'pending',
          created: new Date().toISOString(),
          updated: new Date().toISOString()
        }
        db.invite_requests.push(newReq)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // TURN credentials endpoint
      if (pathname === '/api/turn-credentials') {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'Method Not Allowed' }))
          return
        }

        const authHeader = req.headers.authorization || ''
        const userId = getUserIdFromToken(authHeader)
        const user = db.users.find(u => u.id === userId)
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'Unauthorized' }))
          return
        }

        const sharedSecret = process.env.ATOLL_TURN_SHARED_SECRET || 'REPLACE_THIS_WITH_A_LONG_RANDOM_STRING'
        const expiresEnv = process.env.ATOLL_TURN_EXPIRES_IN_SECONDS
        const expiresInSeconds = expiresEnv ? parseInt(expiresEnv, 10) : 3600

        const unixTimestamp = Math.floor(Date.now() / 1000) + expiresInSeconds
        const username = `${unixTimestamp}:${userId}`
        const password = crypto.createHmac('sha1', sharedSecret).update(username).digest('base64')

        const turnUrisEnv = process.env.ATOLL_TURN_URIS
        const uris = turnUrisEnv ? turnUrisEnv.split(',').map(s => s.trim()) : ['turns:turn.atol.chat:5349']

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          username,
          password,
          ttl: expiresInSeconds,
          uris
        }))
        return
      }

      /* Save plaintext recovery codes for testing */
      if (pathname === '/api/set-test-recovery-codes') {
        const { username, codes } = body
        db.testRecoveryCodes = db.testRecoveryCodes || {}
        db.testRecoveryCodes[username] = codes
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }

      /* Retrieval of plaintext recovery codes for testing */
      if (pathname === '/api/test-recovery-codes') {
        const username = query.username
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          codes: db.testRecoveryCodes?.[username] || []
        }))
        return
      }

      // Link extraction endpoint
      if (pathname === '/api/link-extraction') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          title: 'PB',
          summary: 'This is a mocked link preview for testing.',
          domain: 'mock.com',
          url: query.url || 'https://mock.com'
        }))
        return
      }

      // Realtime endpoint (SSE)
      if (pathname === '/api/realtime') {
        if (req.method === 'GET') {
          // Disable inactivity timeouts and buffer delays on the persistent socket
          req.socket.setTimeout(0)
          req.socket.setNoDelay(true)
          req.socket.setKeepAlive(true)

          // Set standard unbuffered EventSource and CORS headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Credentials': 'true'
          })

          const clientId = 'client_' + crypto.randomUUID().replace(/-/g, '')
          logVerbose(`[MOCK PB] [${testId}] GET /api/realtime. Created clientId: ${clientId}. Current sseClients count: ${db.sseClients.length}`)
          const client = {
            clientId,
            res,
            subscriptions: []
          }
          db.sseClients.push(client)

          try {
            res.write(`id: ${clientId}\r\nevent: PB_CONNECT\r\ndata: ${JSON.stringify({ clientId })}\r\n\r\n`)
          } catch (err) {
            console.error('Failed to write PB_CONNECT:', err.message)
          }

          // Active keep-alive heartbeat to prevent idle disconnects
          const heartbeat = setInterval(() => {
            try {
              res.write(': keep-alive ping\n\n')
            } catch (err) {
              console.error('Failed to write keep-alive ping:', err.message)
            }
          }, 15000)

          res.on('close', () => {
            logVerbose(`[MOCK PB] [${testId}] SSE client ${clientId} disconnected. Remaining:`, db.sseClients.length - 1)
            clearInterval(heartbeat)
            db.sseClients = db.sseClients.filter(c => c.clientId !== clientId)
          })
          return
        } else if (req.method === 'POST') {
          const { clientId, subscriptions } = body
          const client = db.sseClients.find(c => c.clientId === clientId)
          logVerbose(`[MOCK PB] [${testId}] POST /api/realtime. clientId: ${clientId}, subscriptions: [${(subscriptions || []).join(', ')}]. Found client: ${!!client}`)
          if (client) {
            client.subscriptions = subscriptions || []
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
          return
        }
      }

      // Custom route for graceful server shutdown
      if (pathname === '/api/custom/shutdown' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          message: 'Server shutting down cleanly'
        }))
        setTimeout(() => {
          try {
            server.close()
          } catch {
          }
        }, 100)
        return
      }

      // Custom route for login
      if (pathname === '/api/custom/login' && req.method === 'POST') {
        const { identity, password, altcha } = body
        if (!altcha) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Security challenge is required.' }))
          return
        }
        if (!identity || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing identity or password.' }))
          return
        }
        const identityCanonical = identity.trim().toLowerCase()
        let user = db.users.find(u => u.username === identityCanonical)
        if (!user) {
          user = {
            id: identityCanonical,
            username: identityCanonical,
            email: '',
            name: identity,
            avatar: ''
          }
          db.users.push(user)
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          token: generateMockJWT(user.id),
          record: user
        }))
        return
      }

      // Custom route for register
      if (pathname === '/api/custom/register' && req.method === 'POST') {
        const { username, email, password, passwordConfirm, altcha, invitation_code } = body
        if (!altcha) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Security challenge is required.' }))
          return
        }
        if (altcha !== 'atoll-mock-bypass-token' && !altcha.startsWith('eyJ')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid security challenge.' }))
          return
        }
        if (!username || !password || !passwordConfirm) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing required registration fields.' }))
          return
        }

        // Validate invitation code
        if (!invitation_code) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invitation code is required.' }))
          return
        }

        const invite = db.invitations.find(i => i.code === invitation_code)
        if (!invite) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid or expired invitation code' }))
          return
        }
        if (invite.is_used && !invite.code.startsWith('INV-SEED-')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invitation code has already been used.' }))
          return
        }

        const usernameCanonical = username.trim().toLowerCase()
        const usernameExists = db.users.some(u => u.username === usernameCanonical)
        if (usernameExists) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Username is already taken' }))
          return
        }

        // Consume invitation code
        invite.is_used = true
        invite.used_by = usernameCanonical
        invite.used_count = (invite.used_count || 0) + 1

        const newUser = {
          id: usernameCanonical,
          username: usernameCanonical,
          name: username,
          email: email || '',
          collectionId: 'users',
          collectionName: 'users',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          verified: true,
          emailVisibility: false,
          public_box_key: body.public_box_key || '',
          public_sign_key: body.public_sign_key || '',
          encrypted_master_keys: body.encrypted_master_keys || '',
          encrypted_private_keys: body.encrypted_private_keys || '',
          recovery_wraps: body.recovery_wraps || [],
          vault_salt: body.vault_salt || '',
          password
        }
        db.users.push(newUser)

        logVerbose(`[MOCK PB] [${testId}] Custom Registered user: ${usernameCanonical}`)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          token: generateMockJWT(newUser.id),
          record: newUser
        }))
        return
      }

      // Custom route for password reset
      if (pathname === '/api/custom/password-reset' && req.method === 'POST') {
        const { email, altcha } = body
        if (!altcha) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Security challenge is required.' }))
          return
        }
        if (altcha !== 'atoll-mock-bypass-token' && !altcha.startsWith('eyJ')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid security challenge.' }))
          return
        }
        if (!email) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Email is required.' }))
          return
        }
        // No enumeration, return success regardless
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          message: 'Password reset email sent if account exists.'
        }))
        return
      }

      // Custom route for recover account (rate limited)
      if (pathname === '/api/custom/recover_account' && req.method === 'POST') {
        const { username } = body
        const ip = req.socket.remoteAddress || '127.0.0.1'
        const now = Date.now()

        db.recoveryAttempts = db.recoveryAttempts || {}

        const ipKey = `recovery:ip:${ip}`
        const userKey = username ? `recovery:user:${username.trim().toLowerCase()}` : ''

        const ipAttempts = db.recoveryAttempts[ipKey] || []
        const recentIpAttempts = ipAttempts.filter(t => now - t < 3600000)

        if (recentIpAttempts.length >= 5) {
          res.writeHead(429, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Too many recovery attempts. Please try again later.' }))
          return
        }

        if (userKey) {
          const userAttempts = db.recoveryAttempts[userKey] || []
          const recentUserAttempts = userAttempts.filter(t => now - t < 3600000)

          if (recentUserAttempts.length >= 5) {
            res.writeHead(429, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Too many recovery attempts. Please try again later.' }))
            return
          }

          recentUserAttempts.push(now)
          db.recoveryAttempts[userKey] = recentUserAttempts
        }

        recentIpAttempts.push(now)
        db.recoveryAttempts[ipKey] = recentIpAttempts

        if (!username) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid recovery request.' }))
          return
        }

        const usernameCanonical = username.trim().toLowerCase()
        const user = db.users.find(u => u.username === usernameCanonical)

        if (!user || !user.recovery_wraps || user.recovery_wraps.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid recovery request.' }))
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          user: {
            id: user.id,
            username: user.username,
            recovery_wraps: user.recovery_wraps,
            encrypted_private_keys: user.encrypted_private_keys,
            encrypted_master_keys: user.encrypted_master_keys
          }
        }))
        return
      }

      // Custom route for rotate password
      if (pathname === '/api/custom/rotate_password' && req.method === 'POST') {
        const authHeader = req.headers.authorization || ''
        const authUserId = getUserIdFromToken(authHeader)
        let user = authUserId ? db.users.find(u => u.id === authUserId) : null

        const { userId, username, newKeyBHash, newWrappedVMK, remainingWraps } = body

        if (!newKeyBHash || !newWrappedVMK) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing required rotation payload' }))
          return
        }

        let isUnauthenticatedRecovery = false
        if (!user) {
          const targetId = (userId || '').trim()
          const targetUsername = (username || '').trim().toLowerCase()

          if (!targetId && !targetUsername) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Unauthorized' }))
            return
          }

          if (targetId) {
            user = db.users.find(u => u.id === targetId)
          }
          if (!user && targetUsername) {
            user = db.users.find(u => u.username === targetUsername)
          }

          if (!user) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid recovery request.' }))
            return
          }

          isUnauthenticatedRecovery = true

          // Verify recovery wrap reduction rules
          const existingWraps = user.recovery_wraps || []
          const remainingWrapsArr = remainingWraps || []

          if (existingWraps.length < 1 || remainingWrapsArr.length !== existingWraps.length - 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid recovery request.' }))
            return
          }

          const existingStrings = existingWraps.map(w => (typeof w === 'string' ? w : JSON.stringify(w)))
          const allMatch = remainingWrapsArr.every(w => {
            const str = typeof w === 'string' ? w : JSON.stringify(w)
            return existingStrings.includes(str)
          })

          if (!allMatch) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid recovery request.' }))
            return
          }
        }

        // Update in-memory mock database atomically
        user.password = newKeyBHash
        user.encrypted_master_keys = newWrappedVMK
        if (remainingWraps !== undefined) {
          user.recovery_wraps = remainingWraps
        }
        user.updated = new Date().toISOString()

        broadcast(db, 'users', 'update', user)

        if (isUnauthenticatedRecovery) {
          const token = generateMockJWT(user.id)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            token,
            record: user
          }))
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // Auth with password
      if (pathname === '/api/collections/users/auth-with-password') {
        const { identity, password } = body
        const identityCanonical = identity.trim().toLowerCase()
        const user = db.users.find(u => u.username === identityCanonical)

        let isPasswordCorrect = false
        if (user) {
          if (password === 'Password123!') {
            isPasswordCorrect = true
          } else if (user.password && password === user.password) {
            isPasswordCorrect = true
          }
        }

        if (!user || !isPasswordCorrect) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'Invalid credentials.' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          token: generateMockJWT(user.id),
          record: user
        }))
        return
      }

      // Auth refresh
      if (pathname === '/api/collections/users/auth-refresh') {
        const authHeader = req.headers.authorization || ''
        const userId = getUserIdFromToken(authHeader)
        const user = db.users.find(u => u.id === userId)
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'Unauthorized' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          token: generateMockJWT(user.id),
          record: user
        }))
        return
      }

      // Superuser auth
      if (pathname === '/api/collections/_superusers/auth-with-password') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          token: 'mock-admin-token',
          record: {
            id: 'admin_id',
            email: 'admin@example.com'
          }
        }))
        return
      }

      // Mock push-worker endpoint
      if (pathname === '/send-push') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'Method Not Allowed' }))
          return
        }
        db.lastPush = body
        logVerbose(`[MOCK PB] [${testId}] Stored last push:`, JSON.stringify(body))

        // Find any "EXPIRED" recipients to simulate background self-healing
        const recipients = body.recipients || []
        const expiredUserIds = []
        for (const item of recipients) {
          const { user_id, subscription } = item
          if (subscription && subscription.endpoint && subscription.endpoint.includes('EXPIRED')) {
            expiredUserIds.push(user_id)
          }
        }

        const localPort = req.socket.localPort || 8090

        // Return 202 immediately to match the real async worker
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'Accepted' }))

        if (expiredUserIds.length > 0) {
          // Asynchronously trigger the internal pruning webhook via HTTP to verify the full network handshake
          setTimeout(() => {
            const secret = process.env.ATOLL_PUSH_WORKER_SECRET || 'test_secret_123'
            const payload = JSON.stringify({ user_ids: expiredUserIds })

            const reqOpts = {
              hostname: '127.0.0.1',
              port: localPort,
              path: '/api/internal/prune-subscriptions',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Worker-Token': secret,
                'x-test-id': testId
              }
            }

            const pruneReq = http.request(reqOpts, (pruneRes) => {
              pruneRes.on('data', () => {
              })
            })
            pruneReq.on('error', (err) => {
              console.error('[MOCK PB] Failed to call prune webhook:', err)
            })
            pruneReq.write(payload)
            pruneReq.end()
          }, 100)
        }
        return
      }

      // Endpoint to retrieve last push
      if (pathname === '/api/last-push') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(db.lastPush || null))
        return
      }

      // Prune subscriptions internal endpoint
      if (pathname === '/api/internal/prune-subscriptions') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'Method Not Allowed' }))
          return
        }

        const expectedSecret = process.env.ATOLL_PUSH_WORKER_SECRET || 'test_secret_123'
        const reqSecret = req.headers['x-worker-token']

        if (reqSecret !== expectedSecret) {
          console.error('[MOCK PB WEBHOOK] Secret mismatch!', {
            reqSecret,
            expectedSecret
          })
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        const { user_ids } = body
        if (user_ids && Array.isArray(user_ids)) {
          user_ids.forEach(id => {
            const user = db.users.find(u => u.id === id)
            if (user) {
              user.push_subscription = null
              logVerbose(`[MOCK PB] [${testId}] Stored push_subscription for user: ${id}`)
            } else {
              logVerbose(`[MOCK PB] [${testId}] User not found to prune: ${id}`)
            }
          })
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // App metadata collection override for E2E tests
      if (pathname.startsWith('/api/collections/app_metadata/records')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        const mockRecord = {
          id: 'mock_metadata_singleton_id',
          collectionId: 'app_metadata',
          collectionName: 'app_metadata',
          created: '2025-01-01T00:00:00.000Z',
          updated: '2025-01-01T00:00:00.000Z',
          instance_id: 'mock_test_instance_123',
          app_name: 'Atoll Chat',
          app_url: 'http://localhost:3000'
        }
        if (pathname === '/api/collections/app_metadata/records') {
          // List request
          res.end(JSON.stringify({
            page: 1,
            perPage: 100,
            totalItems: 1,
            totalPages: 1,
            items: [mockRecord]
          }))
        } else {
          // Single record view request
          res.end(JSON.stringify(mockRecord))
        }
        return
      }

      // File download
      const fileRouteMatch = pathname.match(/^\/api\/files\/([^/]+)\/([^/]+)\/([^/]+)/)
      if (fileRouteMatch) {
        const [_, _collectionId, recordId, _fileName] = fileRouteMatch
        const fileBuffer = db.mediaFiles[recordId]
        if (!fileBuffer) {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end(fileBuffer)
        return
      }

      // Generic collection matching
      const collectionRouteMatch = pathname.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?$/)
      if (collectionRouteMatch) {
        const [_, collectionName, recordId] = collectionRouteMatch
        const list = db[collectionName]

        if (!list) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'Collection not found' }))
          return
        }

        if (req.method === 'GET') {
          if (recordId) {
            const item = list.find(i => i.id === recordId)
            if (!item) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ message: 'Record not found' }))
              return
            }
            const authHeader = req.headers.authorization
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(sanitizeUserRecord(authHeader, expandRecord(db, item, query.expand))))
            return
          } else {
            // Filter, sort, expand list
            let items = [...list]
            if (query.filter) {
              items = items.filter(item => evaluateFilter(item, query.filter))
            }

            // Expanded records
            const authHeader = req.headers.authorization
            items = items.map(item => sanitizeUserRecord(authHeader, expandRecord(db, item, query.expand)))

            // Default sorting by created
            if (query.sort) {
              const sortField = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
              const direction = query.sort.startsWith('-') ? -1 : 1
              items.sort((a, b) => {
                if (a[sortField] < b[sortField]) {
                  return -1 * direction
                }
                if (a[sortField] > b[sortField]) {
                  return 1 * direction
                }
                return 0
              })
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              page: 1,
              perPage: 100,
              totalItems: items.length,
              totalPages: 1,
              items
            }))
            return
          }
        }

        if (req.method === 'POST') {
          if (collectionName === 'users') {
            const { altcha } = body
            if (!altcha) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ message: 'Security challenge is required.' }))
              return
            }
          }

          const newRecord = {
            id: body.id || (collectionName === 'users' ? body.username : collectionName.slice(0, 3) + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10)),
            collectionId: collectionName,
            collectionName,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            ...body
          }

          // Handle file uploads
          if (files.length > 0) {
            for (const file of files) {
              newRecord[file.name] = file.filename
            }
            db.mediaFiles[newRecord.id] = files[0].buffer
          }

          if (collectionName === 'users') {
            logVerbose('--- USER RECORD SAVED ---', newRecord.id, Object.keys(newRecord))
          }
          list.push(newRecord)
          broadcast(db, collectionName, 'create', newRecord)

          // Simulate push_notifications.pb.js hook inside Mock PocketBase
          if (collectionName === 'messages') {
            const roomId = newRecord.room_id
            const senderId = newRecord.sender_id

            // Filter room members
            const members = db.room_members.filter(m => m.room_id === roomId)
            const recipients = []

            for (const member of members) {
              const userId = member.user_id
              if (userId === senderId) {
                continue
              }
              if (member.role === 'kicked') {
                continue
              }
              const settingsRecord = db.room_settings.find(s => s.room_id === roomId && s.user_id === userId)
              if (settingsRecord && settingsRecord.is_muted === true) {
                continue
              }
              const user = db.users.find(u => u.id === userId)
              if (user && user.push_subscription) {
                let parsed = user.push_subscription
                if (typeof parsed === 'string') {
                  try {
                    parsed = JSON.parse(parsed)
                  } catch {
                  }
                }
                if (parsed && parsed.endpoint) {
                  recipients.push({
                    user_id: userId,
                    subscription: parsed
                  })
                }
              }
            }

            if (recipients.length > 0) {
              const payload = {
                recipients,
                payload: {
                  type: 'NEW_MESSAGE',
                  room_id: roomId,
                  message_id: newRecord.id
                }
              }

              // Fire request to /send-push over local HTTP or direct store
              const reqOpts = {
                hostname: '127.0.0.1',
                port: req.socket.localPort || 8090,
                path: '/send-push',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-test-id': testId
                }
              }
              const pushReq = http.request(reqOpts, (pushRes) => {
                pushRes.on('data', () => {
                })
              })
              pushReq.on('error', (err) => {
                console.error('[MOCK PB] Failed to call /send-push in mock hook:', err)
              })
              pushReq.write(JSON.stringify(payload))
              pushReq.end()
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(newRecord))
          return
        }

        if (req.method === 'PATCH' || req.method === 'PUT') {
          if (!recordId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Record ID is required for update' }))
            return
          }
          const index = list.findIndex(i => i.id === recordId)
          if (index === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Record not found' }))
            return
          }

          const existing = list[index]
          if (collectionName === 'users' && body.username && body.username !== existing.username) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Username is immutable and cannot be changed.' }))
            return
          }

          const updatedRecord = {
            ...existing,
            ...body,
            updated: new Date().toISOString()
          }

          // Handle file updates
          if (files.length > 0) {
            for (const file of files) {
              updatedRecord[file.name] = file.filename
            }
            db.mediaFiles[updatedRecord.id] = files[0].buffer
          }

          if (collectionName === 'users') {
            logVerbose('--- USER RECORD UPDATED ---', updatedRecord.id, Object.keys(updatedRecord))
          }

          list[index] = updatedRecord
          broadcast(db, collectionName, 'update', updatedRecord)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(updatedRecord))
          return
        }

        if (req.method === 'DELETE') {
          if (!recordId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Record ID is required for delete' }))
            return
          }
          const index = list.findIndex(i => i.id === recordId)
          if (index === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ message: 'Record not found' }))
            return
          }

          const deletedRecord = list[index]
          db[collectionName] = list.filter(i => i.id !== recordId)
          delete db.mediaFiles[recordId]

          broadcast(db, collectionName, 'delete', deletedRecord)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
          return
        }
      }

      // No endpoint matched
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: `Route not matched: ${req.method} ${pathname}` }))
    })
  })

  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  const originalClose = server.close.bind(server)
  server.close = (callback) => {
    for (const socket of sockets) {
      socket.destroy()
    }
    sockets.clear()
    return originalClose(callback)
  }

  return server
}

// Start the server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.MOCK_PB_PORT || 8091
  const server = createServer()
  server.listen(port, '0.0.0.0', () => {
    console.log(`Mock PocketBase server started on http://0.0.0.0:${port}`)
  })
}
