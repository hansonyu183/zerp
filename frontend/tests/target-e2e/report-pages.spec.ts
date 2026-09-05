import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

interface SubmitResult {
  subjectId: string
  submissionId: string
  code: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, description: string): string {
  if (typeof value !== 'string' || !value)
    throw new Error(`缺少 ${description}`)
  return value
}

function requiredEnvironment(name: string): string {
  return requiredString(process.env[name], `环境变量 ${name}`)
}

async function signIn(
  page: Page,
  username: string,
  password: string,
  path: string,
) {
  await page.goto(path)
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByLabel('用户名')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
}

async function selectVuetifyOption(
  page: Page,
  control: Locator,
  optionText: string,
) {
  const menuId = await control.getAttribute('aria-controls')
  if (!menuId) throw new Error(`选择控件缺少 aria-controls: ${optionText}`)
  await control
    .locator('xpath=ancestor::*[contains(@class,"v-input")][1]')
    .locator('.v-field')
    .click()
  await page
    .locator(`#${menuId}`)
    .getByRole('option', { name: optionText, exact: true })
    .click()
}

function submissionRow(page: Page, submissionId: string): Locator {
  const region = page.getByTestId('dcl-rpt-definition-page')
  return region.getByRole('row').filter({
    has: page.locator(`[data-archive-submission-id="${submissionId}"]`),
  })
}

async function submitDefinition(page: Page): Promise<SubmitResult> {
  const submit = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/dcl/rpt-definition/submit-new',
  )
  await page.getByRole('button', { name: '提交候选', exact: true }).click()
  const response = await submit
  expect(response.ok()).toBe(true)
  const body: unknown = await response.json()
  if (!isRecord(body) || !isRecord(body.data))
    throw new Error('报表定义提交响应无效')
  expect(body.code, JSON.stringify(body)).toBe(0)
  return {
    subjectId: requiredString(body.data.subjectId, '报表 subjectId'),
    submissionId: requiredString(body.data.submissionId, '报表 submissionId'),
    code: requiredString(body.data.code, '报表编码'),
  }
}

async function responseBody(page: Page, pathname: string, control: Locator) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === pathname,
  )
  await control.click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new Error(`${pathname} 响应无效`)
  expect(body.code, `${pathname}: ${JSON.stringify(body)}`).toBe(0)
  return { body, response }
}

test('a browser-created report is approved, queried, paged, exported, and route-guarded', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const submitterContext = await browser.newContext()
  const reviewerContext = await browser.newContext()
  let reportContext: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    const submitterPage = await submitterContext.newPage()
    await signIn(
      submitterPage,
      requiredEnvironment('TARGET_E2E_USERNAME'),
      requiredEnvironment('TARGET_E2E_PASSWORD'),
      '/dcl/rpt-definition',
    )
    const definitionPage = submitterPage.getByTestId('dcl-rpt-definition-page')
    await definitionPage
      .getByRole('button', { name: '新建本地草稿', exact: true })
      .click()
    const draftTitle = definitionPage.locator('[data-archive-draft-id]').last()
    await draftTitle.click()
    const draft = draftTitle.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " v-expansion-panel ")][1]',
    )
    await draft.getByLabel('报表名称').fill('目标分页报表')
    await draft.getByLabel('说明').fill('真实页面参数、分页与导出验收')
    await draft
      .getByLabel('查询 SQL')
      .fill(
        'SELECT value AS row_no FROM generate_series(1, :limit::integer) AS value ORDER BY value',
      )

    await draft.getByRole('button', { name: '新增参数', exact: true }).click()
    const parameterRow = draft.locator('.v-table').nth(0).locator('tbody tr')
    await parameterRow.locator('td').nth(0).locator('input').fill('limit')
    await parameterRow.locator('td').nth(1).locator('input').fill('生成行数')
    await selectVuetifyOption(
      submitterPage,
      parameterRow.locator('td').nth(2).locator('input[role="combobox"]'),
      'INTEGER',
    )
    await parameterRow
      .locator('td')
      .nth(3)
      .locator('input[type="checkbox"]')
      .check({ force: true })

    const columnRow = draft.locator('.v-table').nth(1).locator('tbody tr')
    await columnRow.locator('td').nth(0).locator('input').fill('row_no')
    await columnRow.locator('td').nth(1).locator('input').fill('行号')

    const submitted = await submitDefinition(submitterPage)
    expect(submitted.code).toMatch(/^rpt-[0-9]{6}$/)
    await expect(
      submissionRow(submitterPage, submitted.submissionId),
    ).toContainText('待批准')

    const reviewerPage = await reviewerContext.newPage()
    await signIn(
      reviewerPage,
      requiredEnvironment('TARGET_E2E_REVIEWER_USERNAME'),
      requiredEnvironment('TARGET_E2E_REVIEWER_PASSWORD'),
      '/dcl/rpt-definition',
    )
    const pending = submissionRow(reviewerPage, submitted.submissionId)
    await expect(pending).toBeVisible()
    await responseBody(
      reviewerPage,
      '/dcl/rpt-definition/approve',
      pending.getByRole('button', { name: '批准', exact: true }),
    )
    await expect(pending).toContainText('已批准')

    reportContext = await browser.newContext({ acceptDownloads: true })
    const reportPage = await reportContext.newPage()
    await signIn(
      reportPage,
      requiredEnvironment('TARGET_E2E_REPORT_USERNAME'),
      requiredEnvironment('TARGET_E2E_REPORT_PASSWORD'),
      `/rpt/${submitted.code}`,
    )
    await expect(reportPage).toHaveURL(`/rpt/${submitted.code}`)
    const report = reportPage.getByTestId('rpt-report-page')
    await expect(report).toContainText('目标分页报表')
    await report.getByLabel('生成行数').fill('21')

    const firstPage = await responseBody(
      reportPage,
      `/rpt/${submitted.code}/query`,
      report.getByRole('button', { name: '查询', exact: true }),
    )
    expect(firstPage.response.request().postDataJSON()).toEqual({
      parameters: { limit: 21 },
      page: 1,
      pageSize: 20,
    })
    expect(firstPage.body.data).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        hasMore: true,
        rows: Array.from({ length: 20 }, (_, index) => ({
          row_no: index + 1,
        })),
      }),
    )
    const resultRows = report.locator('.v-data-table tbody tr')
    await expect(resultRows).toHaveCount(20)
    await expect(resultRows.first()).toContainText('1')
    await expect(resultRows.last()).toContainText('20')
    const visualDirectory = resolve(
      import.meta.dirname,
      '../../../.scratch/frontend-restoration/visual',
    )
    await mkdir(visualDirectory, { recursive: true })
    for (const [name, size] of [
      ['desktop', { width: 1440, height: 900 }],
      ['narrow', { width: 390, height: 844 }],
    ] as const) {
      await reportPage.setViewportSize(size)
      await reportPage.screenshot({
        path: resolve(visualDirectory, `${name}-rpt-parameters-results.png`),
        fullPage: true,
        animations: 'disabled',
      })
    }
    await reportPage.setViewportSize({ width: 1440, height: 900 })

    const secondPagePromise = reportPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/rpt/${submitted.code}/query`,
    )
    await report
      .locator('.v-pagination__item')
      .filter({ hasText: '2' })
      .getByRole('button')
      .click()
    const secondPageResponse = await secondPagePromise
    expect(secondPageResponse.ok()).toBe(true)
    const secondPageBody: unknown = await secondPageResponse.json()
    if (!isRecord(secondPageBody) || !isRecord(secondPageBody.data))
      throw new Error('报表第二页响应无效')
    expect(secondPageBody.code, JSON.stringify(secondPageBody)).toBe(0)
    expect(secondPageResponse.request().postDataJSON()).toEqual({
      parameters: { limit: 21 },
      page: 2,
      pageSize: 20,
    })
    expect(secondPageBody.data).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 20,
        hasMore: false,
        rows: [{ row_no: 21 }],
      }),
    )
    await expect(resultRows).toHaveCount(1)
    await expect(resultRows.first()).toContainText('21')

    const exportResponse = reportPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/rpt/${submitted.code}/export`,
    )
    const download = reportPage.waitForEvent('download')
    await report.getByRole('button', { name: '导出 CSV', exact: true }).click()
    const [exported, csvDownload] = await Promise.all([
      exportResponse,
      download,
    ])
    expect(exported.ok()).toBe(true)
    expect(exported.request().postDataJSON()).toEqual({
      parameters: { limit: 21 },
    })
    const exportBody: unknown = await exported.json()
    if (!isRecord(exportBody) || !isRecord(exportBody.data))
      throw new Error('报表导出响应无效')
    expect(exportBody.code, JSON.stringify(exportBody)).toBe(0)
    expect(exportBody.data.rows).toEqual(
      Array.from({ length: 21 }, (_, index) => ({ row_no: index + 1 })),
    )
    expect(csvDownload.suggestedFilename()).toBe(`${submitted.code}.csv`)
    const downloadPath = await csvDownload.path()
    if (!downloadPath) throw new Error('报表 CSV 下载缺少临时文件')
    expect(await readFile(downloadPath, 'utf8')).toBe(
      `\uFEFF行号\r\n${Array.from({ length: 21 }, (_, index) => index + 1).join('\r\n')}`,
    )

    await reportPage.goto('/rpt/rpt-000000')
    await expect(reportPage).toHaveURL('/forbidden')
    await expect(
      reportPage.getByText('无权访问', { exact: true }),
    ).toBeVisible()
  } finally {
    await Promise.allSettled([
      reportContext?.close(),
      reviewerContext.close(),
      submitterContext.close(),
    ])
  }
})
