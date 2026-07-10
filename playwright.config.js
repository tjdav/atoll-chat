import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'fs'

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
        ...devices['Desktop Chrome']
      }
    }
  ],

  webServer: {
    command: 'pnpm run test:app',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI
  }
})
