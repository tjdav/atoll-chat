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

        if (field === 'room-id') {
          field = 'room_id'
        }
        if (field === 'user-id') {
          field = 'user_id'
        }

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
        fields[name] = body.toString('utf8')
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
    console.log(`[MOCK PB] Initializing new database for testId: ${testId}`)
    databases[testId] = {
      users: [],
      rooms: [],
      room_members: [],
      messages: [],
      media: [],
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

  console.log(`[MOCK PB] Broadcasting "${eventName}" action "${action}" to ${db.sseClients.length} clients. Subscriptions list:`, db.sseClients.map(c => `${c.clientId}: [${c.subscriptions.join(', ')}]`))

  for (const client of db.sseClients) {
    if (client.subscriptions.includes('*') || client.subscriptions.includes(eventName)) {
      try {
        console.log(`[MOCK PB] Delivering event "${eventName}" to client ${client.clientId}`)
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
  return http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true)
    const pathname = parsedUrl.pathname
    const query = parsedUrl.query

    // CORS Headers
    const origin = req.headers.origin || '*'
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-test-id')
    res.setHeader('Access-Control-Allow-Credentials', 'true')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    const testId = req.headers['x-test-id'] || query['x-test-id'] || 'default'
    const db = getDatabase(testId)

    console.log(`[MOCK PB] [${testId}] ${req.method} ${pathname}`)

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
        const boundaryMatch = contentType.match(/boundary=(.+)/)
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
          console.log(`[MOCK PB] [${testId}] GET /api/realtime. Created clientId: ${clientId}. Current sseClients count: ${db.sseClients.length}`)
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
            console.log(`[MOCK PB] [${testId}] SSE client ${clientId} disconnected. Remaining:`, db.sseClients.length - 1)
            clearInterval(heartbeat)
            db.sseClients = db.sseClients.filter(c => c.clientId !== clientId)
          })
          return
        } else if (req.method === 'POST') {
          const { clientId, subscriptions } = body
          const client = db.sseClients.find(c => c.clientId === clientId)
          console.log(`[MOCK PB] [${testId}] POST /api/realtime. clientId: ${clientId}, subscriptions: [${(subscriptions || []).join(', ')}]. Found client: ${!!client}`)
          if (client) {
            client.subscriptions = subscriptions || []
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
          return
        }
      }

      // Auth with password
      if (pathname === '/api/collections/users/auth-with-password') {
        const { identity, password } = body
        const user = db.users.find(u => u.username === identity || u.email === identity)
        if (!user || password !== 'Password123!') {
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
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(expandRecord(db, item, query.expand)))
            return
          } else {
            // Filter, sort, expand list
            let items = [...list]
            if (query.filter) {
              items = items.filter(item => evaluateFilter(item, query.filter))
            }

            // Expanded records
            items = items.map(item => expandRecord(db, item, query.expand))

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
            newRecord.file = files[0].filename
            db.mediaFiles[newRecord.id] = files[0].buffer
          }

          list.push(newRecord)
          broadcast(db, collectionName, 'create', newRecord)

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
          const updatedRecord = {
            ...existing,
            ...body,
            updated: new Date().toISOString()
          }

          // Handle file updates
          if (files.length > 0) {
            updatedRecord.file = files[0].filename
            db.mediaFiles[updatedRecord.id] = files[0].buffer
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
}

// Start the server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer()
  server.listen(8090, '127.0.0.1', () => {
    console.log('Mock PocketBase server started on http://127.0.0.1:8090')
  })
}
