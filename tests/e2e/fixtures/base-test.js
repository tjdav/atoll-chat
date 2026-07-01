import { test as base, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import http from 'http'

const CWD = process.cwd()
const PID_FILE = path.join(CWD, '.pocketbase.pid')
const PB_DATA = path.join(CWD, 'pb_data')
const PB_DATA_TEMPLATE = path.join(CWD, 'pb_data_template')
const PB_BINARY = path.join(CWD, 'bin', 'pocketbase')

async function resetPocketBase () {
  console.log('--- Resetting PocketBase ---')

  // 1. Stop current PocketBase
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10)
    try {
      process.kill(pid, 'SIGTERM')
      // Wait for it to shut down
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      // Might already be dead
    }
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE)
    }
  }

  // 2. Restore from template
  if (fs.existsSync(PB_DATA_TEMPLATE)) {
    if (fs.existsSync(PB_DATA)) {
      fs.rmSync(PB_DATA, {
        recursive: true,
        force: true
      })
    }
    fs.cpSync(PB_DATA_TEMPLATE, PB_DATA, { recursive: true })
  } else {
    throw new Error('PocketBase template not found. Did global-setup.js run?')
  }

  // 3. Start PocketBase again
  const pbLog = fs.openSync(path.join(CWD, 'pocketbase.log'), 'a')
  const pbProcess = spawn(PB_BINARY, [
    'serve',
    `--dir=${PB_DATA}`,
    '--migrationsDir=./database/pb_migrations',
    '--hooksDir=./pb_hooks',
    '--http=127.0.0.1:8090'
  ], {
    detached: true,
    stdio: ['ignore', pbLog, pbLog]
  })

  pbProcess.unref()
  if (!pbProcess.pid) {
    throw new Error('Failed to restart PocketBase during reset')
  }
  fs.writeFileSync(PID_FILE, pbProcess.pid.toString())

  // 4. Wait for health
  let healthy = false
  for (let i = 0; i < 10; i++) {
    try {
      const responseCode = await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:8090/api/health', (res) => {
          resolve(res.statusCode)
        })
        req.on('error', reject)
        req.end()
      })
      if (responseCode === 200) {
        healthy = true
        break
      }
    } catch {

    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  if (!healthy) {
    throw new Error('PocketBase failed to restart healthily during reset')
  }
  console.log('--- PocketBase Reset Complete ---')
}

export const test = base.extend({
  // Automatic fixture that resets the database before every test
  dbReset: [async ({}, use) => {
    await resetPocketBase()
    await use()
  }, { auto: true }],

  page: async ({ page }, use) => {
    page.on('console', msg => {
      console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`)
    })
    page.on('pageerror', err => {
      console.log(`[BROWSER ERROR] ${err.message}`)
    })
    await use(page)
  },

  loginApp: async ({ page }, use) => {
    const doLogin = async (username, appPassword, vaultPassword) => {
      await page.goto('/')
      await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
      await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

      await page.fill('input[placeholder="Enter username or email"]', username)
      await page.fill('input[placeholder="Enter Password"]', appPassword)
      await page.click('button:has-text("Login")')

      await expect(page.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

      await page.fill('input[placeholder="Enter Vault Password"]', vaultPassword)
      await page.click('button:has-text("Unlock with Password")')

      await expect(page.locator('app-layout')).toBeVisible({ timeout: 10000 })
    }
    await use(doLogin)
  },

  loginCustomPage: async ({ baseURL }, use) => {
    const doLogin = async (targetPage, username, appPassword, vaultPassword) => {
      targetPage.on('console', msg => {
        console.log(`[BROWSER][${username}] ${msg.type()}: ${msg.text()}`)
      })
      targetPage.on('pageerror', err => {
        console.log(`[BROWSER ERROR][${username}] ${err.message}`)
      })

      // Use the global baseURL if available
      await targetPage.goto(baseURL || '/')

      // Wait for Coralite to be ready on this specific page
      await targetPage.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
      await targetPage.evaluate(() => window.__coralite__.lifecycle.hydrated)

      // Login Flow
      await targetPage.fill('input[placeholder="Enter username or email"]', username)
      await targetPage.fill('input[placeholder="Enter Password"]', appPassword)
      await targetPage.click('button:has-text("Login")')

      await expect(targetPage.locator(':is(h3):has-text("Unlock Your Vault")')).toBeVisible()

      await targetPage.fill('input[placeholder="Enter Vault Password"]', vaultPassword)
      await targetPage.click('button:has-text("Unlock with Password")')

      await expect(targetPage.locator('app-layout')).toBeVisible({ timeout: 15000 })
    }

    await use(doLogin)
  }
})

export { expect } from '@playwright/test'
