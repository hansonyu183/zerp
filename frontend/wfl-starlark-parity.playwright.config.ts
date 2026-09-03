import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'wfl-starlark-parity.spec.ts',
  reporter: 'list',
  use: { ...devices['Desktop Chrome'] },
})
