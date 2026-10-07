import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPausePolicy } from '../../src/runtime/pause-policy.js'

test('1. A success leaves the policy unpaused', async () => {
  let reported = false
  const policy = createPausePolicy({
    reportPause: async () => { reported = true }
  })

  const res = await policy.guard(() => 'ok')
  assert.deepEqual(res, { kind: 'success', value: 'ok' })
  assert.equal(policy.isPaused(), false)
  assert.equal(reported, false)
})

test('2. One failure leaves the policy unpaused', async () => {
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  const res = await policy.guard(() => { throw new Error('fail') })
  assert.equal(res.kind, 'failure')
  assert.equal(policy.isPaused(), false)
  assert.equal(policy.state().consecutive_failures, 1)
})

test('3. Two failures within the window leave the policy unpaused', async () => {
  let clock = 1000
  const policy = createPausePolicy({
    reportPause: async () => {},
    now: () => clock
  })

  await policy.guard(() => { throw new Error('fail 1') })
  clock += 10000
  await policy.guard(() => { throw new Error('fail 2') })

  assert.equal(policy.isPaused(), false)
  assert.equal(policy.state().consecutive_failures, 2)
})

test('4. Three failures within the window pause the policy', async () => {
  let clock = 1000
  let reportedPayload = null
  const policy = createPausePolicy({
    reportPause: async (payload) => { reportedPayload = payload },
    now: () => clock
  })

  await policy.guard(() => { throw new Error('fail 1') })
  clock += 10000
  await policy.guard(() => { throw new Error('fail 2') })
  clock += 10000
  await policy.guard(() => { throw new Error('fail 3') })

  assert.equal(policy.isPaused(), true)
  assert.equal(policy.state().paused, true)
  assert.equal(policy.state().consecutive_failures, 3)
  assert.ok(reportedPayload)
})

test('5. guard returns { kind: "paused" } after pause', async () => {
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  for (let i = 0; i < 3; i++) {
    await policy.guard(() => { throw new Error('fail') })
  }

  const res = await policy.guard(() => 'ok')
  assert.deepEqual(res, { kind: 'paused' })
})

test('6. guard does not call the wrapped function when paused', async () => {
  let called = false
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  for (let i = 0; i < 3; i++) {
    await policy.guard(() => { throw new Error('fail') })
  }

  await policy.guard(() => {
    called = true
    return 'ok'
  })

  assert.equal(called, false)
})

test('7. A success resets the failure counter', async () => {
  let clock = 1000
  const policy = createPausePolicy({
    reportPause: async () => {},
    now: () => clock
  })

  await policy.guard(() => { throw new Error('fail 1') })
  await policy.guard(() => { throw new Error('fail 2') })
  assert.equal(policy.state().consecutive_failures, 2)

  await policy.guard(() => 'ok')
  assert.equal(policy.state().consecutive_failures, 0)
  assert.equal(policy.state().first_failure_at, null)
  assert.equal(policy.isPaused(), false)
})

test('8. A failure outside the window starts a new streak', async () => {
  let clock = 1000
  const policy = createPausePolicy({
    reportPause: async () => {},
    now: () => clock,
    windowMs: 60000
  })

  await policy.guard(() => { throw new Error('fail 1') })
  clock += 60001
  await policy.guard(() => { throw new Error('fail 2') })

  assert.equal(policy.state().consecutive_failures, 1)
  assert.equal(policy.state().first_failure_at, 61001)
  assert.equal(policy.isPaused(), false)
})

test('9. A failure inside the window but after a success resets the window anchor', async () => {
  let clock = 1000
  const policy = createPausePolicy({
    reportPause: async () => {},
    now: () => clock,
    windowMs: 60000
  })

  await policy.guard(() => { throw new Error('fail 1') })
  await policy.guard(() => { throw new Error('fail 2') })
  await policy.guard(() => 'ok')

  clock += 1000
  await policy.guard(() => { throw new Error('fail 3') })
  clock += 1000
  await policy.guard(() => { throw new Error('fail 4') })

  assert.equal(policy.state().consecutive_failures, 2)
  assert.equal(policy.isPaused(), false)
})

test('10. A failure at exactly windowMs after the anchor is counted in the same streak', async () => {
  let clock = 1000
  const policy = createPausePolicy({
    reportPause: async () => {},
    now: () => clock,
    windowMs: 60000
  })

  await policy.guard(() => { throw new Error('fail 1') })
  clock += 30000
  await policy.guard(() => { throw new Error('fail 2') })
  clock += 30000 // Total delta = 60000ms from anchor (1000ms + 60000ms = 61000ms)
  await policy.guard(() => { throw new Error('fail 3') })

  assert.equal(policy.isPaused(), true)
  assert.equal(policy.state().consecutive_failures, 3)
})

test('11. reportPause is called exactly once per pause', async () => {
  let reportCalls = 0
  const policy = createPausePolicy({
    reportPause: async () => { reportCalls++ }
  })

  for (let i = 0; i < 5; i++) {
    await policy.guard(() => { throw new Error('fail') })
  }

  assert.equal(reportCalls, 1)
})

test('12. reportPause rejection is logged and does not affect state', async () => {
  const policy = createPausePolicy({
    reportPause: async () => { throw new Error('network crash') }
  })

  for (let i = 0; i < 3; i++) {
    await policy.guard(() => { throw new Error('fail') })
  }

  // Yield microtasks to allow fire-and-forget reportPause catch handler to execute
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(policy.isPaused(), true)
})

test('13. reportPause receives the correct payload', async () => {
  let payloadReceived = null
  const policy = createPausePolicy({
    reportPause: async (payload) => { payloadReceived = payload },
    threshold: 3,
    windowMs: 60000,
    now: () => 1600000000000
  })

  for (let i = 0; i < 3; i++) {
    await policy.guard(() => { throw new Error('fail') })
  }

  assert.deepEqual(payloadReceived, {
    threshold: 3,
    window_ms: 60000,
    first_failure_at: new Date(1600000000000).toISOString()
  })
})

test('14. state() reflects the current counters', async () => {
  let clock = 5000
  const policy = createPausePolicy({
    reportPause: async () => {},
    now: () => clock
  })

  assert.deepEqual(policy.state(), {
    paused: false,
    consecutive_failures: 0,
    first_failure_at: null
  })

  await policy.guard(() => { throw new Error('fail') })

  assert.deepEqual(policy.state(), {
    paused: false,
    consecutive_failures: 1,
    first_failure_at: 5000
  })
})

test('15. isPaused() returns false before pause, true after', async () => {
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  assert.equal(policy.isPaused(), false)
  await policy.guard(() => { throw new Error('1') })
  assert.equal(policy.isPaused(), false)
  await policy.guard(() => { throw new Error('2') })
  assert.equal(policy.isPaused(), false)
  await policy.guard(() => { throw new Error('3') })
  assert.equal(policy.isPaused(), true)
})

test('16. guard returns { kind: "success", value } on success', async () => {
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  const res = await policy.guard(() => ({ message: 'hello' }))
  assert.deepEqual(res, { kind: 'success', value: { message: 'hello' } })
})

test('17. guard returns { kind: "failure", error } on failure', async () => {
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  const err = new Error('boom')
  const res = await policy.guard(() => { throw err })
  assert.deepEqual(res, { kind: 'failure', error: err })
})

test('18. guard never throws on a handler throw; the error is captured', async () => {
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  await assert.doesNotReject(async () => {
    const res = await policy.guard(() => {
      throw new TypeError('unexpected error')
    })
    assert.equal(res.kind, 'failure')
    assert.ok(res.error instanceof TypeError)
  })
})

test('19. After pause, guard returns { kind: "paused" } without calling the wrapped function', async () => {
  let count = 0
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  for (let i = 0; i < 3; i++) {
    await policy.guard(() => { throw new Error('fail') })
  }

  const res = await policy.guard(() => {
    count++
    return 'value'
  })

  assert.equal(res.kind, 'paused')
  assert.equal(count, 0)
})

test('20. Concurrent guard calls are serialized by Node microtask ordering', async () => {
  const policy = createPausePolicy({
    reportPause: async () => {}
  })

  const p1 = policy.guard(() => { throw new Error('fail 1') })
  const p2 = policy.guard(() => { throw new Error('fail 2') })

  const [r1, r2] = await Promise.all([p1, p2])

  assert.equal(r1.kind, 'failure')
  assert.equal(r2.kind, 'failure')
  assert.equal(policy.state().consecutive_failures, 2)
})
