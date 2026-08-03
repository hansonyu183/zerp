import { expect, test, type Page, type TestInfo } from '@playwright/test'
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

function pageBreadcrumb(page: Page) {
  return page.locator('.page-heading__breadcrumb')
}

async function expectMobileCards(
  page: Page,
  selector: string,
  testInfo: TestInfo,
): Promise<void> {
  const region = page.locator(selector).first()
  await expect(region).toBeVisible()
  if (testInfo.project.name !== 'mobile-chromium') return
  await expect(region.locator('thead')).toBeHidden()
  expect(
    await region.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true)
}

test.describe('LED 真实后端只读流程', () => {
  test.skip(!ledReadonlyEnabled, '设置 E2E_LED_READONLY=1 后在隔离账簿运行。')

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('加载期初状态和结账历史', async ({ page }, testInfo) => {
    await page.goto('/led/closing')
    await expect(pageBreadcrumb(page)).toHaveText('ZERP / 期初与结账')
    await expect(page.getByText(/版本 \d+/)).toBeVisible()
    const auditTab = page.getByRole('tab', { name: '结账历史' })
    if (await auditTab.isVisible()) {
      await auditTab.click()
      if (testInfo.project.name === 'mobile-chromium') {
        await expectMobileCards(page, '.responsive-table', testInfo)
      } else {
        await expect(
          page.getByRole('columnheader', { name: '结账日' }),
        ).toBeVisible()
      }
    }
  })

  async function verifyLedger(
    page: Page,
    testInfo: TestInfo,
    ledger: { entity: string; title: string },
  ): Promise<void> {
    const entryResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/led/${ledger.entity}/query`) &&
        response.request().method() === 'POST',
    )
    await page.goto(`/led/${ledger.entity}`)
    await expect(pageBreadcrumb(page)).toHaveText(`ZERP / ${ledger.title}`)
    const entryPayload = (await (await entryResponse).json()) as {
      code: number | string
    }
    expect(String(entryPayload.code)).toBe('0')
    await expectMobileCards(page, '.ledger-workspace__table', testInfo)

    const balanceResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/led/${ledger.entity}/balance`) &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '余额', exact: true }).click()
    const balancePayload = (await (await balanceResponse).json()) as {
      code: number | string
    }
    expect(String(balancePayload.code)).toBe('0')
  }

  for (const ledger of [
    { entity: 'inventory', title: '库存台账' },
    { entity: 'fund', title: '资金台账' },
    { entity: 'container', title: '空桶台账' },
  ]) {
    test(`${ledger.title}查询流水和余额`, async ({ page }, testInfo) => {
      await verifyLedger(page, testInfo, ledger)
    })
  }

  test('三类往来台账分别查询流水和余额', async ({ page }, testInfo) => {
    for (const ledger of [
      { entity: 'customer', title: '往来台账-客户' },
      { entity: 'supplier', title: '往来台账-供应商' },
      { entity: 'other', title: '往来台账-其他' },
    ]) {
      await verifyLedger(page, testInfo, ledger)
    }
  })
})
