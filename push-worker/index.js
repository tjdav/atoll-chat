import http from 'http'
import webpush from 'web-push'
import { createChallenge, randomInt, verifySolution } from 'altcha-lib'
import { deriveHmacKeySecret } from 'altcha-lib/frameworks/shared'
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2'

const PORT = process.env.PORT || 3000

// Validate environment variables
const internalWorkerSecret = process.env.ATOLL_PUSH_WORKER_SECRET
const pocketbaseUrl = process.env.ATOLL_INTERNAL_POCKETBASE_URL || 'http://127.0.0.1:8080'

const altchaSecret = process.env.ATOLL_ALTCHA_SECRET || 'fallback-altcha-secret-key-1234567890'
const hmacKeySecret = await deriveHmacKeySecret(altchaSecret)

// Read VAPID keys from environment
const vapidPublicKey = process.env.ATOLL_VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.ATOLL_VAPID_PRIVATE_KEY
const vapidSubject = process.env.ATOLL_VAPID_SUBJECT

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  console.log('[push-worker] VAPID keys loaded successfully.')
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
} else {
  console.warn('[push-worker] Warning: VAPID keys or subject are missing from environment.')
}

const server = http.createServer((req, res) => {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  // ALTCHA Challenge Generation
  if (req.method === 'GET' && req.url === '/altcha/challenge') {
    const cost = parseInt(process.env.ATOLL_ALTCHA_COST, 10) || (process.env.NODE_ENV === 'production' ? 5000 : 1000)
    const maxCost = Math.max(cost, 1000)
    createChallenge({
      algorithm: 'PBKDF2/SHA-256',
      cost: maxCost,
      max: maxCost,
      counter: randomInt(1, Math.min(maxCost, 500)),
      deriveKey,
      hmacSignatureSecret: hmacKeySecret
    }).then(challenge => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(challenge))
    }).catch(err => {
      console.error('[push-worker] Error generating ALTCHA challenge:', err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    })
    return
  }

  // ALTCHA Challenge Verification
  if (req.method === 'POST' && req.url === '/altcha/verify') {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })

    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        const { payload } = data

        if (!payload) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing challenge payload' }))
          return
        }

        // Deterministic bypass for test / mock bypass tokens
        const isTestEnv = process.env.CORALITE_MODE === 'testing'
        if (isTestEnv && payload === 'atoll-mock-bypass-token') {
          console.log('[push-worker] Bypassing ALTCHA verification for mock bypass token')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
          return
        }

        let payloadObj = payload
        if (typeof payload === 'string') {
          try {
            payloadObj = JSON.parse(payload)
          } catch {
            try {
              payloadObj = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
            } catch {
              throw new SyntaxError(`Invalid ALTCHA payload structure: ${payload}`)
            }
          }
        }

        const result = await verifySolution({
          challenge: payloadObj.challenge,
          solution: payloadObj.solution,
          deriveKey,
          hmacSignatureSecret: hmacKeySecret
        })

        if (result.verified) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid challenge solution' }))
        }
      } catch (err) {
        console.error('[push-worker] Error verifying ALTCHA solution:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
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
        const { recipients, payload } = data

        if (!recipients || !Array.isArray(recipients)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing or invalid recipients list' }))
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

        /* Fast Handshake (Fire & Forget): Instantly reply with HTTP 202 Accepted, then iterate in background. */
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'Accepted' }))

        // Execute background notification iteration asynchronously
        processPushRecipientsAsync(recipients, payload).catch(err => {
          console.error('[push-worker] Error during async recipients processing:', err)
        })

      } catch (err) {
        console.error('[push-worker] Error processing /send-push request:', err)
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      }
    })
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  }
})

/**
 * Asynchronously processes push notifications for recipients in the background.
 * Collects stale/expired user_ids (410/404) and posts them back to PocketBase webhook in batches.
 * @param {Array<{user_id: string, subscription: any}>} recipients - List of user IDs and subscriptions
 * @param {any} payload - The push payload content
 */
async function processPushRecipientsAsync (recipients, payload) {
  const staleUserIds = []
  const serializedPayload = JSON.stringify(payload)

  for (const item of recipients) {
    const { user_id, subscription } = item
    if (!subscription || !subscription.endpoint) {
      console.warn(`[push-worker] Subscription for user ${user_id} is missing an endpoint or invalid. Queueing for pruning.`)
      staleUserIds.push(user_id)
      continue
    }

    try {
      await webpush.sendNotification(subscription, serializedPayload)
    } catch (error) {
      if (error.statusCode === 410 || error.statusCode === 404) {
        console.warn(`[push-worker] Subscription for user ${user_id} expired/revoked (Status ${error.statusCode}). Queueing for pruning.`)
        staleUserIds.push(user_id)
      } else if (error.message && (error.message.includes('subscription') || error.message.includes('endpoint'))) {
        console.warn(`[push-worker] Subscription validation failed for user ${user_id}: ${error.message}. Queueing for pruning.`)
        staleUserIds.push(user_id)
      } else {
        console.error(`[push-worker] Push failed for user ${user_id}:`, error)
      }
    }
  }

  if (staleUserIds.length > 0) {
    console.log(`[push-worker] Collected ${staleUserIds.length} stale subscription(s) to prune. Sending pruning request...`)
    const MAX_BATCH_SIZE = 500

    for (let i = 0; i < staleUserIds.length; i += MAX_BATCH_SIZE) {
      const chunk = staleUserIds.slice(i, i + MAX_BATCH_SIZE)

      try {
        const response = await fetch(`${pocketbaseUrl}/api/internal/prune-subscriptions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Worker-Token': internalWorkerSecret
          },
          body: JSON.stringify({ user_ids: chunk })
        })

        if (!response.ok) {
          console.error(`[push-worker] Failed to prune subscriptions. HTTP status: ${response.status}`)
        } else {
          console.log(`[push-worker] Successfully pruned subscription chunk of size ${chunk.length}`)
        }
      } catch (err) {
        console.error('[push-worker] Failed to trigger prune webhook:', err)
      }
    }
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[push-worker] Listening on port ${PORT}`)
})
