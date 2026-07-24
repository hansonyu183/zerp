import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'

const localE2EEnv = loadEnv('e2e', process.cwd(), '')
const localE2EEnvNames = ['E2E_API_BASE_URL', 'E2E_USERNAME', 'E2E_PASSWORD'] as const

for (const name of localE2EEnvNames) {
  if (process.env[name] === undefined && localE2EEnv[name] !== undefined) {
    process.env[name] = localE2EEnv[name]
  }
}

const appUrl = 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
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
      VITE_API_BASE_URL: process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:5173/mock-api/',
    },
  },
})
