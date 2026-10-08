import { execSync } from 'node:child_process'

/**
 * Global setup for Playwright test runner.
 * Ensures chromium browser binaries are installed before running component tests.
 */
export default async function globalSetup() {
  try {
    execSync('pnpm exec playwright install chromium', { stdio: 'pipe' })
  } catch (_err) {
    // If install fails (e.g., no network), continue. The test will fail with a clearer error.
  }
}
