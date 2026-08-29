import { test as base, expect } from '../../e2e/fixtures/base-test.js'
import path from 'path'
import fs from 'fs'

export const test = base.extend({
  mountComponent: async ({ page }, use) => {
    await use(async (tagName, attributes = {}, innerHTML = '') => {
      await page.goto('/')
      await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
      await page.evaluate(() => window.__coralite__.lifecycle.hydrated)

      return page.evaluate(({ tag, attrs, content }) => {
        let mountPoint = document.getElementById('component-mount-point')
        if (!mountPoint) {
          mountPoint = document.createElement('div')
          mountPoint.id = 'component-mount-point'
          document.body.appendChild(mountPoint)
        }
        mountPoint.innerHTML = ''

        const el = document.createElement(tag)
        el.id = 'test-component-root'
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
        if (content) el.innerHTML = content
        mountPoint.appendChild(el)
        return el.id
      }, { tag: tagName, attrs: attributes, content: innerHTML })
    })
  },

  setTheme: async ({ page }, use) => {
    await use(async (themeName) => {
      await page.evaluate((theme) => {
        document.documentElement.setAttribute('data-atoll-theme', theme)
      }, themeName)
    })
  },

  takeVerificationScreenshot: async ({ page }, use) => {
    await use(async (name, locator = null) => {
      const screenshotDir = path.join(process.cwd(), 'test-results/screenshots')
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true })
      }
      const target = locator || page.locator('#component-mount-point')
      const targetPath = path.join(screenshotDir, `${name}.png`)
      await target.screenshot({ path: targetPath, animations: 'allow' })
      return targetPath
    })
  }
})

export { expect }
