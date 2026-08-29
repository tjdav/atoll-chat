import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'fs'

const getExecutablePath = (path) => (existsSync(path) ? path : undefined)

export default defineConfig({
  testDir: './tests/components',
  testMatch: /.*\.spec\.js$/,
  timeout: 15000,
  expect: {
    timeout: 4000
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry'
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: getExecutablePath('/usr/bin/google-chrome') || getExecutablePath('/usr/bin/chromium')
        }
      }
    }
  ],

  webServer: {
    command: 'pnpm run test:server',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI
  }
})
