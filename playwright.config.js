import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'fs'
import path from 'path'

const getExecutablePath = (path) => (existsSync(path) ? path : undefined)

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'line',
  globalSetup: './tests/e2e/setup/global-setup.js',
  globalTeardown: './tests/e2e/setup/global-teardown.js',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: {
      executablePath: getExecutablePath('/usr/bin/google-chrome') || getExecutablePath('/usr/bin/chromium'),
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-loopback-in-peer-connection',
        '--enforce-webrtc-ip-permission-check=false',
        '--unlimited-storage'
      ]
    }
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
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
    }
  ],

  webServer: {
    command: 'pnpm run test:app',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      LOCAL_ICE_SERVER: `turn:127.0.0.1:${process.env.TURN_PORT || 3478}`,
      ATOLL_NOTIFICATION_SOUND_DEBOUNCE_MS: '5000',
      ATOLL_PUSH_WORKER_SECRET: 'test_secret_123',
      POCKETBASE_URL: 'http://localhost:8090'
    }
  }
})
