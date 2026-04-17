import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'fs'

const getExecutablePath = (path) => (existsSync(path) ? path : undefined)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'line',
  globalSetup: './tests/e2e/setup/global-setup.js',
  globalTeardown: './tests/e2e/setup/global-teardown.js',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
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
          executablePath: getExecutablePath('/usr/bin/chromium')
        }
      }
    }
  ],

  webServer: [
    {
      command: 'pnpm run test:server',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'pnpm run start:tracker',
      url: 'http://localhost:8000/stats',
      reuseExistingServer: !process.env.CI
    }
  ]
})
