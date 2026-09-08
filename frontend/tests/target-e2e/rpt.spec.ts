import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

async function signin(page: Page, exportOnly = false) {
  const response = await page.request.post(
    `${process.env.TARGET_API_BASE_URL}/session/auth/signin`,
    {
      headers: { 'X-ZERP-Model-Build': modelBuildId },
      data: {
        code: process.env[
          exportOnly
            ? 'TARGET_E2E_RPT_EXPORT_USERNAME'
            : 'TARGET_E2E_REPORT_USERNAME'
        ],
        password:
          process.env[
            exportOnly
              ? 'TARGET_E2E_RPT_EXPORT_PASSWORD'
              : 'TARGET_E2E_REPORT_PASSWORD'
          ],
      },
    },
  )
  expect((await response.json()).code).toBe(0)
}

test('RPT resource queries multiple parameters, paginates a submitted snapshot and exports matching columns', async ({
  page,
}) => {
  const code = process.env.TARGET_E2E_RPT_CODE!
  await signin(page)
  await page.goto(`/rpt/${code}`)
  await expect(page.getByTestId('report-page')).toBeVisible()
  await expect(page.getByTestId('report-page')).toContainText('参数查询与导出')
  await page.getByLabel('客户名称 *', { exact: true }).fill('历史子单位名称')
  await page.getByLabel('金额 *', { exact: true }).fill('9007199254740993.00')
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(20)
  await expect(page.locator('tbody tr').first()).toContainText('历史子单位名称')
  await expect(page.locator('tbody tr').first()).toContainText(
    '9007199254740993.00',
  )
  await expect(page.locator('tbody tr').first()).toContainText('否')
  await expect(page.locator('tbody tr').first()).toContainText('开放')
  await expect(page.locator('tbody tr').first()).toContainText('2026-09-01')
  await page.getByLabel('客户名称 *', { exact: true }).fill('尚未提交')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(5)
  await expect(page.locator('tbody tr').first()).toContainText('历史子单位名称')
  await page.getByLabel('客户名称 *', { exact: true }).fill('历史子单位名称')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click()
  const download = await downloading
  const content = await readFile((await download.path())!, 'utf8')
  expect(content.split('\r\n')).toHaveLength(26)
  expect(content).toContain('"客户名称","金额","标记","状态","业务日期"')
  expect(content).toContain(
    '"历史子单位名称","9007199254740993.00","否","开放","2026-09-01"',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.reload()
  await expect(page.getByLabel('客户名称 *', { exact: true })).toHaveValue('')
})

test('RPT export-only resource does not issue a result query or expose definition editing', async ({
  page,
}) => {
  const code = process.env.TARGET_E2E_RPT_CODE!
  const queries: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/rpt/${code}/query`)
      queries.push(request.url())
  })
  await signin(page, true)
  await page.goto(`/rpt/${code}`)
  await expect(page.getByTestId('report-page')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '查询', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '保存', exact: true }),
  ).toHaveCount(0)
  await page.getByLabel('客户名称 *', { exact: true }).fill('只导出')
  await page.getByLabel('金额 *', { exact: true }).fill('0.00')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click()
  const content = await readFile((await (await downloading).path())!, 'utf8')
  expect(content).toContain('"只导出","0.00","否"')
  expect(queries).toEqual([])
})
