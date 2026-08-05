import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'fs'
import path from 'path'

const getExecutablePath = (path) => (existsSync(path) ? path : undefined)

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 4000
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'line',
  globalSetup: './tests/e2e/setup/global-setup.js',
  globalTeardown: './tests/e2e/setup/global-teardown.js',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry'
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read', 'clipboard-write'],
        launchOptions: {
          executablePath: getExecutablePath('/usr/bin/google-chrome') || getExecutablePath('/usr/bin/chromium'),
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--allow-loopback-in-peer-connection',
            '--enforce-webrtc-ip-permission-check=false',
            '--unlimited-storage',
            `--use-file-for-fake-video-capture=${path.join(import.meta.dirname, 'tests/e2e/fixtures/test-video.y4m')}`
          ]
        }
      }
    },
    {
      name: 'firefox',
      testMatch: /firefox-.*\.spec\.js$/,
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.permission.disabled': true,
            'media.navigator.streams.fake': true,
            'dom.webrtc.webrtc_recorder.enabled': true,
            'dom.indexedDB.enabled': true,
            'privacy.trackingprotection.enabled': false,
            'privacy.trackingprotection.pbmode.enabled': false
          }
        }
      }
    }
  ],

  webServer: {
    command: 'pnpm run test:server',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      LOCAL_ICE_SERVER: `turn:127.0.0.1:${process.env.TURN_PORT || 3478}`,
      ATOLL_NOTIFICATION_SOUND_DEBOUNCE_MS: '5000',
      ATOLL_PUSH_WORKER_SECRET: 'test_secret_123',
      ATOLL_POCKETBASE_URL: 'http://localhost:8091',
      ATOLL_INTERNAL_POCKETBASE_URL: 'http://localhost:8091'
    }
  }
})
