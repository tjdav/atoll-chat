import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test.describe.serial('Global Audio Player', () => {
  let bobContext
  let bobPage

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(90000)
    bobContext = await browser.newContext({
      recordVideo: {
        dir: '/home/jules/verification/video'
      }
    })
    bobPage = await bobContext.newPage()

    // Go to a blank page on the same origin to seed IndexedDB first
    await bobPage.goto('/#seed', { waitUntil: 'domcontentloaded' })

    await bobPage.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('atoll-media-vault')

        request.onupgradeneeded = (event) => {
          const db = event.target.result
          if (!db.objectStoreNames.contains('media')) {
            const store = db.createObjectStore('media', { keyPath: 'event_id' })
            store.createIndex('mimeType', 'mimeType', { unique: false })
            store.createIndex('timestamp', 'timestamp', { unique: false })
          }
        }

        request.onsuccess = (event) => {
          const db = event.target.result
          const tx = db.transaction('media', 'readwrite')
          const store = tx.objectStore('media')

          const base64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
          const binaryString = atob(base64)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          const blob = new Blob([bytes], { type: 'audio/wav' })

          store.put({
            event_id: '$mock_audio_123',
            blob: blob,
            mimeType: 'audio/wav',
            filename: 'test-audio.wav',
            timestamp: Date.now(),
            roomId: '!mock_room_id'
          })

          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = (e) => reject(e)
        }
        request.onerror = (e) => reject(e)
      })
    })

    await bobPage.reload({ waitUntil: 'domcontentloaded' })

    // Login Bob
    await bobPage.locator('input[type="text"]').fill('bob')
    await bobPage.locator('input[type="password"]').fill('password123')
    await bobPage.locator('button[type="submit"]').click()
    await bobPage.waitForTimeout(1000)
  })

  test.afterAll(async () => {
    await bobContext.close()
  })

  test('Verify Global Audio Player', async () => {
    await bobPage.locator('a[data-tab="music"]').click()
    await bobPage.waitForTimeout(1000)

    const trackButton = bobPage.locator('button.list-group-item').first()
    await expect(trackButton).toBeVisible()
    await trackButton.click()
    await bobPage.waitForTimeout(1000)

    const globalPlayer = bobPage.locator('atoll-audio-player')
    await expect(globalPlayer).toBeVisible()

    await bobPage.waitForTimeout(1000)
    await bobPage.screenshot({ path: '/home/jules/verification/verification.png' })
    await bobPage.waitForTimeout(1000)
  })
})
