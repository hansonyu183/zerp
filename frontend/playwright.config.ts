import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'

const localE2EEnv = loadEnv('e2e', process.cwd(), '')
const requiredE2EEnvNames = [
  'E2E_API_BASE_URL',
  'E2E_USERNAME',
  'E2E_PASSWORD',
] as const

for (const name of requiredE2EEnvNames) {
  if (process.env[name] === undefined && localE2EEnv[name] !== undefined) {
    process.env[name] = localE2EEnv[name]
  }
}

const missingE2EEnvNames = requiredE2EEnvNames.filter(
  (name) => !process.env[name],
)

if (missingE2EEnvNames.length > 0) {
  throw new Error(
    `Playwright 必须连接真实测试后端，缺少配置：${missingE2EEnvNames.join(', ')}`,
  )
}

const appUrl = process.env.E2E_APP_BASE_URL ?? 'http://127.0.0.1:5173'
const externalWebServer = Boolean(process.env.E2E_APP_BASE_URL)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 3,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  maxFailures: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    actionTimeout: 30_000,
    baseURL: appUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      grepInvert: /@system-serial/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      grep: /@mobile/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'system-serial',
      dependencies: ['chromium', 'mobile-chromium'],
      grep: /@system-serial/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: externalWebServer
    ? undefined
    : {
        command: 'pnpm dev --host 127.0.0.1 --port 5173 --strictPort',
        url: appUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          VITE_API_BASE_URL: '/api/',
        },
      },
})
