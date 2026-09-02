import { test as base, expect } from '../../e2e/fixtures/base-test.js'
import { AxeBuilder } from '@axe-core/playwright'
import path from 'path'
import fs from 'fs'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const PAGE_LEVEL_RULES = [
  'landmark-one-main',
  'page-has-heading-one',
  'region',
  'html-has-lang',
  'document-title'
]
const COMPONENT_SELECTORS = [
  '#component-mount-point',
  '#visual-matrix',
  '.toast-container',
  '.modal.show',
  '.offcanvas.show',
  '[role="tooltip"]',
  '[role="dialog"]',
  'atoll-popup[open]'
]

export function formatViolations(violations) {
  if (!violations || violations.length === 0) return ''
  return violations.map((v, i) => {
    const targetNodes = v.nodes.map((n) => {
      const targetStr = Array.isArray(n.target) ? n.target.join(' > ') : String(n.target)
      const snippet = n.html ? `\n        Snippet: ${n.html}` : ''
      const summary = n.failureSummary ? `\n        Fix: ${n.failureSummary.replace(/\n\s*/g, ' ')}` : ''
      return `      • Target: ${targetStr}${snippet}${summary}`
    }).join('\n')
    const impact = (v.impact || 'unknown').toUpperCase()
    return `[${i + 1}] Rule: "${v.id}" (${impact} impact)\n    Help: ${v.help} (${v.helpUrl})\n    Elements:\n${targetNodes}`
  }).join('\n\n')
}

export async function runAxeAudit({ page, testInfo }) {
  if (!page || page.isClosed() || page.url() === 'about:blank') {
    return { violations: [], skipped: true }
  }

  if (testInfo && testInfo.annotations && testInfo.annotations.some((a) => a.type === 'skip-axe')) {
    return { violations: [], skipped: true }
  }

  const existingSelectors = await page.evaluate((selectors) => {
    return selectors.filter((sel) => document.querySelector(sel) !== null)
  }, COMPONENT_SELECTORS).catch(() => [])

  if (existingSelectors.length === 0) {
    return { violations: [], skipped: true }
  }

  let builder = new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .disableRules(PAGE_LEVEL_RULES)

  existingSelectors.forEach((sel) => {
    builder = builder.include(sel)
  })

  const results = await builder.analyze()

  if (results.violations.length > 0) {
    if (testInfo && testInfo.attach) {
      await testInfo.attach('axe-violations.json', {
        body: Buffer.from(JSON.stringify(results.violations, null, 2)),
        contentType: 'application/json'
      })
    }
  }

  expect(results.violations, formatViolations(results.violations)).toEqual([])
  return results
}

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
        mountPoint.style.background = 'var(--atoll-body-bg, #ffffff)'
        mountPoint.style.color = 'var(--atoll-text-primary, #111111)'
        mountPoint.style.padding = '16px'
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
  },

  checkA11y: async ({ page }, use, testInfo) => {
    await use(async () => {
      return runAxeAudit({ page, testInfo })
    })
  },

  autoAxeValidation: [async ({ page }, use, testInfo) => {
    await use()
    await runAxeAudit({ page, testInfo })
  }, { auto: true }]
})

export { expect }
