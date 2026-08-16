import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Helper function simulating push recipient processing logic with a mock sendNotification function (CONCURRENT)
async function processPushRecipientsConcurrent (recipients, payload, sendNotificationImpl, fetchImpl) {
  const staleUserIds = []
  const serializedPayload = JSON.stringify(payload)
  let unexpectedError = null

  const promises = recipients.map(async (item) => {
    const { user_id, subscription } = item
    if (!subscription || !subscription.endpoint) {
      staleUserIds.push(user_id)
      return
    }

    try {
      await sendNotificationImpl(subscription, serializedPayload)
    } catch (error) {
      if (error.statusCode === 410 || error.statusCode === 404) {
        staleUserIds.push(user_id)
      } else if (error.message && (error.message.includes('subscription') || error.message.includes('endpoint'))) {
        staleUserIds.push(user_id)
      } else {
        throw error
      }
    }
  })

  const results = await Promise.allSettled(promises)

  for (const res of results) {
    if (res.status === 'rejected' && !unexpectedError) {
      unexpectedError = res.reason
    }
  }

  if (staleUserIds.length > 0) {
    const MAX_BATCH_SIZE = 500

    for (let i = 0; i < staleUserIds.length; i += MAX_BATCH_SIZE) {
      const chunk = staleUserIds.slice(i, i + MAX_BATCH_SIZE)

      const response = await fetchImpl('http://127.0.0.1:8080/api/internal/prune-subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Token': 'test-secret'
        },
        body: JSON.stringify({ user_ids: chunk })
      })

      if (!response.ok) {
        throw new Error(`Failed to prune subscriptions. HTTP status: ${response.status}`)
      }
    }
  }

  if (unexpectedError) {
    throw unexpectedError
  }
}

// Helper function simulating the legacy sequential logic
async function processPushRecipientsSequential (recipients, payload, sendNotificationImpl, fetchImpl) {
  const staleUserIds = []
  const serializedPayload = JSON.stringify(payload)

  for (const item of recipients) {
    const { user_id, subscription } = item
    if (!subscription || !subscription.endpoint) {
      staleUserIds.push(user_id)
      continue
    }

    try {
      await sendNotificationImpl(subscription, serializedPayload)
    } catch (error) {
      if (error.statusCode === 410 || error.statusCode === 404) {
        staleUserIds.push(user_id)
      } else if (error.message && (error.message.includes('subscription') || error.message.includes('endpoint'))) {
        staleUserIds.push(user_id)
      } else {
        throw error
      }
    }
  }

  if (staleUserIds.length > 0) {
    const MAX_BATCH_SIZE = 500

    for (let i = 0; i < staleUserIds.length; i += MAX_BATCH_SIZE) {
      const chunk = staleUserIds.slice(i, i + MAX_BATCH_SIZE)

      const response = await fetchImpl('http://127.0.0.1:8080/api/internal/prune-subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Token': 'test-secret'
        },
        body: JSON.stringify({ user_ids: chunk })
      })

      if (!response.ok) {
        throw new Error(`Failed to prune subscriptions. HTTP status: ${response.status}`)
      }
    }
  }
}

describe('Push Worker Recipient Processing', () => {
  it('collects stale user_ids for invalid subscriptions and prunes them', async () => {
    const prunedChunks = []
    const fetchImpl = async (url, options) => {
      prunedChunks.push(JSON.parse(options.body).user_ids)
      return { ok: true }
    }

    const sendNotification = async (sub) => {
      if (sub.endpoint === 'stale-410') {
        const err = new Error('Gone')
        err.statusCode = 410
        throw err
      }
      if (sub.endpoint === 'stale-404') {
        const err = new Error('Not Found')
        err.statusCode = 404
        throw err
      }
      return {}
    }

    const recipients = [
      {
        user_id: 'u1',
        subscription: { endpoint: 'valid-1' }
      },
      {
        user_id: 'u2',
        subscription: { endpoint: 'stale-410' }
      },
      {
        user_id: 'u3',
        subscription: null
      },
      {
        user_id: 'u4',
        subscription: { endpoint: 'stale-404' }
      }
    ]

    await processPushRecipientsConcurrent(recipients, { title: 'Test' }, sendNotification, fetchImpl)

    assert.equal(prunedChunks.length, 1)
    assert.deepEqual(prunedChunks[0].sort(), ['u2', 'u3', 'u4'])
  })

  it('prunes stale user_ids even when unexpected errors occur, then throws unexpected error', async () => {
    const prunedChunks = []
    const fetchImpl = async (url, options) => {
      prunedChunks.push(JSON.parse(options.body).user_ids)
      return { ok: true }
    }

    const sendNotification = async (sub) => {
      if (sub.endpoint === 'stale-410') {
        const err = new Error('Gone')
        err.statusCode = 410
        throw err
      }
      if (sub.endpoint === 'fatal') {
        throw new Error('Network timeout')
      }
      return {}
    }

    const recipients = [
      {
        user_id: 'u1',
        subscription: { endpoint: 'fatal' }
      },
      {
        user_id: 'u2',
        subscription: { endpoint: 'stale-410' }
      }
    ]

    await assert.rejects(
      async () => {
        await processPushRecipientsConcurrent(recipients, { title: 'Test' }, sendNotification, fetchImpl)
      },
      { message: 'Network timeout' }
    )

    // Verify pruning still happened for u2
    assert.equal(prunedChunks.length, 1)
    assert.deepEqual(prunedChunks[0], ['u2'])
  })

  it('benchmark latency comparison: sequential vs concurrent processing', async () => {
    const delay = 50
    const sendNotification = async () => {
      await new Promise(resolve => setTimeout(resolve, delay))
      return {}
    }

    const recipientCount = 20
    const recipients = Array.from({ length: recipientCount }, (_, i) => ({
      user_id: `user-${i}`,
      subscription: { endpoint: `https://push.example.com/${i}` }
    }))

    // Measure Sequential
    const startSeq = Date.now()
    await processPushRecipientsSequential(recipients, { test: true }, sendNotification, async () => ({ ok: true }))
    const durationSeq = Date.now() - startSeq

    // Measure Concurrent
    const startConc = Date.now()
    await processPushRecipientsConcurrent(recipients, { test: true }, sendNotification, async () => ({ ok: true }))
    const durationConc = Date.now() - startConc

    console.log(`\n📊 Benchmark Results for ${recipientCount} recipients (${delay}ms endpoint latency):`)
    console.log(`   Sequential Execution Time: ${durationSeq} ms`)
    console.log(`   Concurrent Execution Time: ${durationConc} ms`)
    console.log(`   Speedup Factor: ${(durationSeq / durationConc).toFixed(2)}x faster\n`)

    // Concurrent execution should finish in roughly ~1x endpoint delay instead of N x delay
    assert.ok(durationConc < durationSeq / 5, `Concurrent duration (${durationConc}ms) should be significantly faster than sequential (${durationSeq}ms)`)
  })
})
