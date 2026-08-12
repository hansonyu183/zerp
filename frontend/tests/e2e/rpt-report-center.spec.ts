import { expect, test } from './fixtures'

test('报表中心连接真实 RPT API，查询与独立 CSV 导出共用当前版本', async ({
  page,
}) => {
  await page.goto('/rpt/account-journal')
  await expect(page).toHaveURL(/\/rpt\/account-journal$/)
  await expect(page.getByRole('heading', { name: '报表中心' })).toBeVisible()
  await expect(
    page.getByText('科目流水', { exact: true }).first(),
  ).toBeVisible()

  const queryResponse = page.waitForResponse((response) =>
    response.url().includes('/rpt/account-journal/query'),
  )
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const response = await queryResponse
  expect(response.ok()).toBe(true)
  await expect(page.getByText(/查询结果（\d+）/)).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('account-journal.csv')
  await expect(page.getByText('导出已完成。', { exact: true })).toBeVisible()
})
