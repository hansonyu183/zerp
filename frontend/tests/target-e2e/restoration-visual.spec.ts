import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test'

const visualDirectory = resolve(
  import.meta.dirname,
  '../../../.scratch/frontend-restoration/visual',
)

type VisualViewport = {
  name: 'desktop' | 'narrow'
  size: { width: number; height: number }
}

async function capture(
  page: Page,
  viewport: VisualViewport,
  name: string,
  surface: Locator,
) {
  await expect(surface).toBeVisible()
  await expect(page.locator('body')).not.toBeEmpty()
  await expect(page.locator('.v-data-table-rows-loading')).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  const bytes = await page.screenshot({
    path: resolve(visualDirectory, `${viewport.name}-${name}.png`),
    fullPage: true,
    animations: 'disabled',
  })
  expect(
    bytes.byteLength,
    `${name} screenshot must not be empty`,
  ).toBeGreaterThan(1_000)
}

async function navigateAndCapture(
  page: Page,
  viewport: VisualViewport,
  name: string,
  path: string,
  surface: Locator = page.locator('main'),
) {
  await page.goto(path)
  await expect(page.getByLabel('用户名')).toHaveCount(0)
  await capture(page, viewport, name, surface)
}

async function openExpansionPanel(panel: Locator) {
  await expect(panel).toBeVisible()
  const title = panel.locator('.v-expansion-panel-title')
  if (await title.count()) await title.click()
  else await panel.click()
}

async function captureArchiveDraft(
  page: Page,
  viewport: VisualViewport,
  entity: 'customer' | 'product',
) {
  const region = page.getByTestId(`dcl-${entity}-page`)
  await navigateAndCapture(
    page,
    viewport,
    `dcl-${entity}-list`,
    `/dcl/${entity}`,
    region,
  )
  await region
    .getByRole('button', { name: /新建(?:本地|客户)草稿/, exact: true })
    .click()
  const draft = region.getByTestId(
    entity === 'customer' ? 'dcl-customer-draft' : 'dcl-draft',
  )
  await openExpansionPanel(draft)
  await capture(page, viewport, `dcl-${entity}-draft`, region)
}

async function captureVouDraft(
  page: Page,
  viewport: VisualViewport,
  entity: 'sale-pricing' | 'bill-issue' | 'service-contract',
) {
  const workspace = page.getByTestId('vou-workspace')
  await navigateAndCapture(
    page,
    viewport,
    `vou-${entity}-list`,
    `/vou/${entity}`,
    workspace,
  )
  await workspace
    .getByRole('button', { name: '新建本地草稿', exact: true })
    .click()
  const draft = workspace.getByTestId('vou-local-draft')
  await openExpansionPanel(draft)
  await capture(page, viewport, `vou-${entity}-draft`, workspace)
}

async function captureViewport(browser: Browser, viewport: VisualViewport) {
  const context = await browser.newContext({ viewport: viewport.size })
  try {
    const page = await context.newPage()
    await page.goto('/signin')
    await expect(page.getByLabel('用户名')).toBeVisible()
    await expect(page.getByLabel('密码')).toBeVisible()
    await capture(page, viewport, 'signin-empty', page.locator('.signin-page'))

    await page.getByLabel('用户名').fill(process.env.TARGET_E2E_USERNAME!)
    await page.getByLabel('密码').fill(process.env.TARGET_E2E_PASSWORD!)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByLabel('用户名')).toHaveCount(0)

    await capture(page, viewport, 'dashboard', page.locator('main'))
    await navigateAndCapture(page, viewport, 'app-user-list', '/app/user')

    await page.goto('/aux/product-type')
    await expect(page.getByLabel('用户名')).toHaveCount(0)
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await capture(
      page,
      viewport,
      'aux-product-type-editor',
      page.getByRole('textbox', { name: '名称', exact: true }),
    )

    await captureArchiveDraft(page, viewport, 'customer')
    await captureArchiveDraft(page, viewport, 'product')
    await captureVouDraft(page, viewport, 'sale-pricing')
    await captureVouDraft(page, viewport, 'bill-issue')
    await captureVouDraft(page, viewport, 'service-contract')
    await navigateAndCapture(
      page,
      viewport,
      'acc-opening',
      '/acc/opening',
      page.getByTestId('acc-opening-page'),
    )
    await navigateAndCapture(
      page,
      viewport,
      'wfl-definition',
      '/wfl/process-definition',
      page.getByTestId('wfl-definition-page'),
    )
    await navigateAndCapture(
      page,
      viewport,
      'wfl-instance',
      '/wfl/process-instance',
      page.getByTestId('wfl-instance-page'),
    )

    await page.goto('/rpt/visual-empty')
    await expect(page.getByLabel('用户名')).toHaveCount(0)
    const report = page.getByTestId('rpt-report-page')
    if (await report.count())
      await capture(page, viewport, 'rpt-parameters-results-or-empty', report)
    else
      await capture(
        page,
        viewport,
        'rpt-no-configured-report',
        page.locator('main'),
      )
  } finally {
    await context.close()
  }
}

test('captures current restoration visual evidence without asserting legacy pixel equivalence', async ({
  browser,
}) => {
  test.setTimeout(300_000)
  await mkdir(visualDirectory, { recursive: true })
  await captureViewport(browser, {
    name: 'desktop',
    size: { width: 1440, height: 900 },
  })
  await captureViewport(browser, {
    name: 'narrow',
    size: { width: 390, height: 844 },
  })
})
