import { expect, test, type Page } from '@playwright/test'
import { loadEnv } from 'vite'

const localE2EEnv = loadEnv('e2e', process.cwd(), '')
const ledReadonlyEnabled =
  (process.env.E2E_LED_READONLY ?? localE2EEnv.E2E_LED_READONLY) === '1'

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(process.env.E2E_USERNAME!)
  await page.getByLabel('密码').fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).not.toHaveURL(/\/signin/)
}

function contentHeading(page: Page, name: string) {
  return page.locator('.page-content').getByRole('heading', {
    name,
    exact: true,
  })
}

test.describe('LED 真实后端只读流程', () => {
  test.skip(
    !ledReadonlyEnabled,
    '设置 E2E_LED_READONLY=1 后在已启用的隔离账簿运行。',
  )

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('加载期初状态和生命周期审计', async ({ page }) => {
    await page.goto('/led/opening')
    await expect(contentHeading(page, '期初与启用')).toBeVisible()
    await expect(page.getByText(/版本 \d+/)).toBeVisible()
    const auditTab = page.getByRole('tab', { name: '生命周期审计' })
    if (await auditTab.isVisible()) {
      await auditTab.click()
      await expect(page.getByRole('columnheader', { name: '事件' }))
        .toBeVisible()
    }
  })

  for (const ledger of [
    { entity: 'inventory', title: '库存台账' },
    { entity: 'fund', title: '资金台账' },
    { entity: 'party', title: '往来台账' },
    { entity: 'container', title: '空桶台账' },
  ]) {
    test(`${ledger.title}查询流水和余额`, async ({ page }) => {
      const entryResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/led/${ledger.entity}/query`) &&
          response.request().method() === 'POST',
      )
      await page.goto(`/led/${ledger.entity}`)
      await expect(contentHeading(page, ledger.title)).toBeVisible()
      const entryPayload = await (await entryResponse).json() as {
        code: number | string
      }
      expect(String(entryPayload.code)).toBe('0')

      const balanceResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/led/${ledger.entity}/balance`) &&
          response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: '余额', exact: true }).click()
      const balancePayload = await (await balanceResponse).json() as {
        code: number | string
      }
      expect(String(balancePayload.code)).toBe('0')
    })
  }
})
