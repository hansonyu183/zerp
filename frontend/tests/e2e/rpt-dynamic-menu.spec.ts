import { expect, test } from './fixtures'

test('报表动态菜单进入单份报表，查询与独立 CSV 导出共用当前版本', async ({
  page,
}) => {
  await page.goto('/')
  const reportMenu = page.getByRole('link', { name: '科目流水' })
  if (!(await reportMenu.isVisible())) {
    await page.getByText('报表', { exact: true }).click()
  }
  await expect(reportMenu).toBeVisible()
  await reportMenu.click()
  await expect(page).toHaveURL(/\/rpt\/account-journal$/)
  await expect(page.getByRole('heading', { name: '科目流水' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '报表中心' })).toHaveCount(0)
  await expect(page.getByText('可用报表', { exact: true })).toHaveCount(0)
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
