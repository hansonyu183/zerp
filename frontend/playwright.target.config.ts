import { defineConfig, devices } from '@playwright/test'

const required = [
  'TARGET_WEB_BASE_URL',
  'TARGET_API_BASE_URL',
  'TARGET_E2E_USERNAME',
  'TARGET_E2E_PASSWORD',
] as const
const missing = required.filter((name) => !process.env[name])
if (missing.length > 0)
  throw new Error(
    `target Playwright requires isolated topology values: ${missing.join(', ')}`,
  )

export default defineConfig({
  testDir: './tests/target-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.TARGET_WEB_BASE_URL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    ...devices['Desktop Chrome'],
  },
})
