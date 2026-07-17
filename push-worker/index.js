import http from 'http'
import webpush from 'web-push'

const PORT = process.env.PORT || 3000

// Read VAPID keys from environment
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidSubject = process.env.VAPID_SUBJECT

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  console.log('[push-worker] VAPID keys loaded successfully.')
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
} else {
  console.warn('[push-worker] Warning: VAPID keys or subject are missing from environment.')
}

const server = http.createServer((req, res) => {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/send-push') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })

    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        const { subscriptions, payload } = data

        if (!subscriptions || !Array.isArray(subscriptions)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing or invalid subscriptions list' }))
          return
        }

        if (!payload) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing push payload content' }))
          return
        }

        if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'VAPID credentials not configured on push-worker server' }))
          return
        }

        const serializedPayload = JSON.stringify(payload)
        const sendPromises = subscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification(sub, serializedPayload)
            return {
              success: true,
              endpoint: sub.endpoint
            }
          } catch (err) {
            console.error(`[push-worker] Failed to send to ${sub.endpoint}:`, err.message)
            return {
              success: false,
              endpoint: sub.endpoint,
              error: err.message
            }
          }
        })

        const results = await Promise.all(sendPromises)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ results }))

      } catch (err) {
        console.error('[push-worker] Error processing /send-push:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[push-worker] Listening on port ${PORT}`)
})
