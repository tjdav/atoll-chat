import { test, describe, after, before } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import { createServer } from '../e2e/setup/mock-pb-server.js'

function generateMockJWT (userId) {
  const header = Buffer.from(JSON.stringify({
    alg: 'HS256',
    typ: 'JWT'
  })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    id: userId,
    exp: Math.floor(Date.now() / 1000) + (3600 * 24 * 365)
  })).toString('base64url')
  return `${header}.${payload}.mocksignature`
}

describe('Password Rotation & Account Recovery Proof Verification Unit Tests', () => {
  let server
  let baseUrl

  before(async () => {
    server = createServer()
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  })

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  async function createInvite (testId) {
    const token = generateMockJWT('admin')
    const res = await fetch(`${baseUrl}/api/custom/invites/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-test-id': testId
      }
    })
    const data = await res.json()
    return data.code
  }

  test('invitation code generation should produce formatted valid codes', async () => {
    const testId = 'invite-format-test'
    const code = await createInvite(testId)
    assert.match(code, /^INV-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Invite code should match INV-XXXX-XXXX format')

    const code2 = await createInvite(testId)
    assert.notEqual(code, code2, 'Subsequent generated invite codes should be unique')
  })

  test('recover_account should omit encrypted_master_keys from user payload', async () => {
    const testId = 'recovery-test-1'
    const code = await createInvite(testId)

    const regRes = await fetch(`${baseUrl}/api/custom/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-id': testId
      },
      body: JSON.stringify({
        username: 'user_recovery_1',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
        altcha: 'atoll-mock-bypass-token',
        invitation_code: code,
        recovery_wraps: [{ verifier: 'verifier1' }],
        encrypted_private_keys: { ciphertext: 'priv' },
        encrypted_master_keys: { ciphertext: 'master' }
      })
    })
    const regData = await regRes.json()
    assert.equal(regRes.status, 201, `Register failed: ${JSON.stringify(regData)}`)

    const recRes = await fetch(`${baseUrl}/api/custom/recover_account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-id': testId
      },
      body: JSON.stringify({ username: 'user_recovery_1' })
    })
    assert.equal(recRes.status, 200)
    const recData = await recRes.json()

    assert.equal(recData.success, true)
    assert.ok(recData.user)
    assert.equal(recData.user.id, 'user_recovery_1')
    assert.equal(recData.user.username, 'user_recovery_1')
    assert.ok(recData.user.recovery_wraps)
    assert.ok(recData.user.encrypted_private_keys)
    assert.equal(recData.user.encrypted_master_keys, undefined, 'encrypted_master_keys should be omitted')
  })

  test('rotate_password without recoveryAuthProof should fail with 400', async () => {
    const testId = 'rotate-test-1'
    const code = await createInvite(testId)

    const regRes = await fetch(`${baseUrl}/api/custom/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-id': testId
      },
      body: JSON.stringify({
        username: 'user_rotate_1',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
        altcha: 'atoll-mock-bypass-token',
        invitation_code: code,
        recovery_wraps: [{ verifier: 'verifier1' }]
      })
    })
    assert.equal(regRes.status, 201)

    const rotRes = await fetch(`${baseUrl}/api/custom/rotate_password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-id': testId
      },
      body: JSON.stringify({
        username: 'user_rotate_1',
        newKeyBHash: 'hash123',
        newWrappedVMK: 'wrapped123'
      })
    })
    assert.equal(rotRes.status, 400)
    const rotData = await rotRes.json()
    assert.equal(rotData.error, 'Invalid recovery request.')
  })

  test('rotate_password with valid recoveryAuthProof should succeed and remove matched wrap', async () => {
    const testId = 'rotate-test-2'
    const code = await createInvite(testId)
    const proof = 'validProofValue123'
    const expectedVerifier = crypto.createHash('sha256').update('atoll-recovery-verifier:' + proof).digest('base64')

    const wrap1 = {
      verifier: expectedVerifier,
      ciphertext: 'c1'
    }
    const wrap2 = {
      verifier: 'otherVerifier',
      ciphertext: 'c2'
    }

    const regRes = await fetch(`${baseUrl}/api/custom/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-id': testId
      },
      body: JSON.stringify({
        username: 'user_rotate_2',
        password: 'Password123!',
        passwordConfirm: 'Password123!',
        altcha: 'atoll-mock-bypass-token',
        invitation_code: code,
        recovery_wraps: [wrap1, wrap2]
      })
    })
    assert.equal(regRes.status, 201)

    const rotRes = await fetch(`${baseUrl}/api/custom/rotate_password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-id': testId
      },
      body: JSON.stringify({
        username: 'user_rotate_2',
        newKeyBHash: 'hashNew',
        newWrappedVMK: 'vmkNew',
        recoveryAuthProof: proof
      })
    })
    assert.equal(rotRes.status, 200)
    const rotData = await rotRes.json()

    assert.equal(rotData.success, true)
    assert.ok(rotData.token)
    assert.equal(rotData.record.recovery_wraps.length, 1)
    assert.equal(rotData.record.recovery_wraps[0].verifier, 'otherVerifier')
  })

  test('unauthenticated rotate_password should be rate limited after 5 attempts', async () => {
    const proof = 'proofRateLimit'
    const testId = 'rotate-test-3'

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/custom/rotate_password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-id': testId
        },
        body: JSON.stringify({
          username: 'nonexistent_user',
          newKeyBHash: 'hash',
          newWrappedVMK: 'vmk',
          recoveryAuthProof: proof
        })
      })
      assert.equal(res.status, 400)
    }

    const res6 = await fetch(`${baseUrl}/api/custom/rotate_password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-id': testId
      },
      body: JSON.stringify({
        username: 'nonexistent_user',
        newKeyBHash: 'hash',
        newWrappedVMK: 'vmk',
        recoveryAuthProof: proof
      })
    })
    assert.equal(res6.status, 429)
    const data6 = await res6.json()
    assert.equal(data6.error, 'Too many recovery attempts. Please try again later.')
  })
})
