/* global process */

import { chromium } from '@playwright/test'

const baseURL = process.env.ZERP_PREVIEW_URL
const username = process.env.ZERP_PREVIEW_USERNAME
const password = process.env.ZERP_PREVIEW_PASSWORD
const expectedSHA = process.env.ZERP_PREVIEW_SHA

if (!baseURL || !username || !password || !/^[0-9a-f]{40}$/.test(expectedSHA)) {
  throw new Error('preview smoke configuration is incomplete')
}

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${baseURL}/signin?preview-release=${expectedSHA}`, {
    waitUntil: 'networkidle',
  })
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/home\/dashboard$/, { timeout: 30_000 })
  await page.locator('.account-button').waitFor({ state: 'visible' })
  const marker = await page.request.get(
    `${baseURL}/_zerp-release?preview-release=${expectedSHA}`,
  )
  if (!marker.ok() || (await marker.text()).trim() !== expectedSHA) {
    throw new Error(
      'public preview release marker does not match the exact SHA',
    )
  }
  await context.close()
} finally {
  await browser.close()
}
