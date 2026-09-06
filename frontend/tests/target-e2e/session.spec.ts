import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

const screenshotDirectory = resolve(
  process.cwd(),
  '..',
  '.scratch',
  'issue-379-session',
)

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin')
  await page
    .getByLabel('用户编码', { exact: true })
    .fill(process.env.TARGET_E2E_USERNAME!)
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TARGET_E2E_PASSWORD!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
}

test('session account controls work at desktop and 390px without retaining password fields', async ({
  browser,
}) => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport })
    try {
      const page = await context.newPage()
      const viewportName = `${viewport.width}x${viewport.height}`
      await signIn(page)

      await page.locator('.account-button').click()
      await page.getByText('名称与头像', { exact: true }).click()
      const name = page.getByLabel('名称', { exact: true })
      await expect(name).toBeVisible()
      await expect(name).toHaveValue(/\S/)
      mkdirSync(screenshotDirectory, { recursive: true })
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document
                .getAnimations()
                .filter(
                  (animation) =>
                    animation.playState === 'running' &&
                    animation.effect?.getComputedTiming().endTime !== Infinity,
                ).length,
          ),
        )
        .toBe(0)
      await page.screenshot({
        animations: 'disabled',
        path: resolve(
          screenshotDirectory,
          `${viewportName}-profile-loaded.png`,
        ),
      })
      await name.fill(await name.inputValue())
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(name).toHaveCount(0)

      await page.getByLabel('切换深色模式').click()
      await expect(page.getByLabel('切换浅色模式')).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document
                .getAnimations()
                .filter(
                  (animation) =>
                    animation.playState === 'running' &&
                    animation.effect?.getComputedTiming().endTime !== Infinity,
                ).length,
          ),
        )
        .toBe(0)
      await page.screenshot({
        animations: 'disabled',
        path: resolve(screenshotDirectory, `${viewportName}-dark-shell.png`),
      })
      await page.getByLabel('切换浅色模式').click()

      await page.locator('.account-button').click()
      await page.getByText('更改密码', { exact: true }).click()
      await page
        .getByLabel('当前密码', { exact: true })
        .fill('temporary-current-password')
      await page
        .getByLabel('新密码', { exact: true })
        .fill('temporary-new-password')
      await page
        .getByLabel('确认新密码', { exact: true })
        .fill('temporary-new-password')
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await page.locator('.account-button').click()
      await page.getByText('更改密码', { exact: true }).click()
      await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('')
      await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('')
      await expect(page.getByLabel('确认新密码', { exact: true })).toHaveValue(
        '',
      )
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document
                .getAnimations()
                .filter(
                  (animation) =>
                    animation.playState === 'running' &&
                    animation.effect?.getComputedTiming().endTime !== Infinity,
                ).length,
          ),
        )
        .toBe(0)
      await page.screenshot({
        animations: 'disabled',
        path: resolve(
          screenshotDirectory,
          `${viewportName}-password-empty.png`,
        ),
      })
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await page.locator('.account-button').click()
      await page.getByText('退出登录', { exact: true }).click()
      await expect(page.getByLabel('用户编码', { exact: true })).toBeVisible()
    } finally {
      await context.close()
    }
  }
})
