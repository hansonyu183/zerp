import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'

const localE2EEnv = loadEnv('e2e', process.cwd(), '')
const wflBootstrap =
  (process.env.E2E_WFL_BOOTSTRAP ??
    localE2EEnv.E2E_WFL_BOOTSTRAP ??
    '').toLowerCase() === 'true'
const requiredE2EEnvNames = [
  'E2E_API_BASE_URL',
  'E2E_USERNAME',
  'E2E_PASSWORD',
] as const
const requiredReviewerEnvNames = [
  'E2E_REVIEWER_USERNAME',
  'E2E_REVIEWER_PASSWORD',
] as const

for (const name of [
  ...requiredE2EEnvNames,
  ...requiredReviewerEnvNames,
] as const) {
  if (process.env[name] === undefined && localE2EEnv[name] !== undefined) {
    process.env[name] = localE2EEnv[name]
  }
}

const missingE2EEnvNames: string[] = requiredE2EEnvNames.filter(
  (name) => !process.env[name],
)
if (!wflBootstrap) {
  missingE2EEnvNames.push(
    ...requiredReviewerEnvNames.filter((name) => !process.env[name]),
  )
}

if (missingE2EEnvNames.length > 0) {
  throw new Error(
    `Playwright 必须连接真实测试后端，缺少配置：${missingE2EEnvNames.join(', ')}`,
  )
}

const appUrl = 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/wfl-global-setup.ts',
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    actionTimeout: 30_000,
    baseURL: appUrl,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5173 --strictPort',
    url: appUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_API_BASE_URL: process.env.E2E_API_BASE_URL!,
    },
  },
})
