import { test, expect } from './fixtures/base-test.js'

test.describe('TURN Credentials Endpoint', () => {
  test('should reject unauthenticated requests with 401', async ({ page }) => {
    const status = await page.evaluate(async () => {
      try {
        const tId = window.__playwright_test_id__
        const res = await fetch('http://127.0.0.1:8090/api/turn-credentials', {
          headers: {
            'x-test-id': tId
          }
        })
        return res.status
      } catch (_err) {
        return 500
      }
    })
    expect(status).toBe(401)
  })

  test('should return signed credentials for logged-in user', async ({ page, loginApp }) => {
    await loginApp('alice', 'Password123!', 'VaultPassword123!')

    const credentials = await page.evaluate(async () => {
      const authStr = localStorage.getItem('pocketbase_auth')
      if (!authStr) {
        throw new Error('pocketbase_auth not found in localStorage')
      }
      const auth = JSON.parse(authStr)
      const token = auth.token
      const tId = window.__playwright_test_id__

      const res = await fetch('http://127.0.0.1:8090/api/turn-credentials', {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-test-id': tId
        }
      })
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`)
      }
      return res.json()
    })

    expect(credentials).toHaveProperty('username')
    expect(credentials).toHaveProperty('password')
    expect(credentials).toHaveProperty('ttl')
    expect(credentials).toHaveProperty('uris')
    expect(typeof credentials.username).toBe('string')
    expect(typeof credentials.password).toBe('string')
    expect(typeof credentials.ttl).toBe('number')
    expect(Array.isArray(credentials.uris)).toBe(true)

    expect(credentials.ttl).toBe(3600)
    expect(credentials.uris).toContain('turns:turn.atol.chat:5349')

    const parts = credentials.username.split(':')
    expect(parts.length).toBe(2)
    const [timestamp, userId] = parts
    expect(Number(timestamp)).not.toBeNaN()
    expect(userId).toBe('alice')
  })
})
