import http from 'http'
import webpush from 'web-push'

const PORT = process.env.PORT || 3000

// Validate strict environment variables
const internalWorkerSecret = process.env.INTERNAL_WORKER_SECRET
const pocketbaseUrl = process.env.POCKETBASE_URL

if (!internalWorkerSecret) {
  throw new Error('[push-worker] Fatal: INTERNAL_WORKER_SECRET environment variable is missing.')
}

if (!pocketbaseUrl) {
  throw new Error('[push-worker] Fatal: POCKETBASE_URL environment variable is missing.')
}

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
    if (!subscription) {
      continue
    }

    try {
      await webpush.sendNotification(subscription, serializedPayload)
    } catch (error) {
      if (error.statusCode === 410 || error.statusCode === 404) {
        console.warn(`[push-worker] Subscription for user ${user_id} expired/revoked (Status ${error.statusCode}). Queueing for pruning.`)
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
