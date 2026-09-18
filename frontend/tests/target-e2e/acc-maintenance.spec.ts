import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import { expect, test, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

async function session(page: Page) {
  const base = process.env.TARGET_API_BASE_URL!
  const headers = { 'x-zerp-model-build': modelBuildId }
  const login = await (
    await page.request.post(`${base}/session/auth/signin`, {
      headers,
      data: {
        code: process.env.TARGET_E2E_USERNAME!,
        password: process.env.TARGET_E2E_PASSWORD!,
      },
    })
  ).json()
  expect(login.code).toBe(0)
  async function post(path: string, data: object) {
    const response = await (
      await page.request.post(`${base}${path}`, {
        headers: { ...headers, 'x-csrf-token': login.data.csrfToken },
        data,
      })
    ).json()
    expect(response.code, response.errorKey).toBe(0)
    return response.data
  }
  return { post }
}
async function menu(page: Page, entity: string) {
  const drawer = page.locator('.v-navigation-drawer')
  if (
    !(await drawer.getAttribute('class'))?.includes(
      'v-navigation-drawer--active',
    )
  )
    await page.getByRole('button', { name: '切换导航', exact: true }).click()
  const closed = drawer.locator(
    '.v-list-group:not(.v-list-group--open) > .v-list-group__header',
  )
  while (await closed.count()) await closed.first().click()
  await drawer.locator(`a[href="/acc/${entity}"]`).click()
}
async function choose(
  page: Page,
  label: string,
  name: string,
  scope = page.locator('main'),
) {
  await scope.getByRole('combobox', { name: label, exact: true }).fill(name)
  await page.getByRole('option').filter({ hasText: name }).first().click()
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
}
for (const width of [1280, 390]) {
  test(`会计账簿 ${width}px supports paginated query, immutable facts and CRUD`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const { post } = await session(page)
    const tag = randomBytes(4).toString('hex')
    const keyword = `账簿${tag}`
    const input = {
      name: keyword,
      description: '',
      baseCurrency: 'CNY',
      startMonth: '2026-01',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    }
    for (let i = 0; i < 21; i++)
      await post('/acc/book/create', {
        ...input,
        id: ulid(),
        name: `${keyword}-${String(i).padStart(2, '0')}`,
      })
    await page.goto('/')
    await menu(page, 'book')
    await page.getByLabel('编码或名称', { exact: true }).fill(keyword)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await expect(page.getByText('共 21 项', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '转到页面 2', exact: true }).click()
    const row = page
      .locator('tr, .list-card')
      .filter({ hasText: `${keyword}-20` })
    await row.getByRole('button', { name: '查看', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('开始月份', { exact: true })).toBeDisabled()
    await expect(
      dialog.getByRole('button', { name: '保存', exact: true }),
    ).toHaveCount(0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '新增', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('名称', { exact: true }).fill(`${keyword}-新建`)
    await dialog.getByLabel('开始月份', { exact: true }).fill('2025-01')
    await expect(
      dialog.getByRole('combobox', { name: '科目模板', exact: true }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.getByLabel('编码或名称', { exact: true }).fill(`${keyword}-新建`)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    const created = () =>
      page.locator('tr, .list-card').filter({ hasText: `${keyword}-新建` })
    await created().getByRole('button', { name: '编辑', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('开始月份', { exact: true })).toBeDisabled()
    await expect(
      dialog.getByRole('combobox', { name: '科目模板', exact: true }),
    ).toHaveCount(0)
    await dialog.getByLabel('说明', { exact: true }).fill('维护说明')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await created().getByRole('button', { name: '查看', exact: true }).click()
    await expect(
      page.getByRole('dialog').getByLabel('说明', { exact: true }),
    ).toHaveValue('维护说明')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await created().getByRole('button', { name: '删除', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '删除', exact: true })
      .click()
    await expect(page.getByText('共 0 项', { exact: true })).toBeVisible()
    await noOverflow(page)
  })
  test(`会计科目 ${width}px maintains all attributes using book and parent selectors`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const { post } = await session(page)
    const tag = randomBytes(4).toString('hex')
    const book = await post('/acc/book/create', {
      id: ulid(),
      name: `科目账簿${tag}`,
      description: '',
      baseCurrency: 'CNY',
      startMonth: '2026-01',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    })
    const parent = await post('/acc/subject/create', {
      id: ulid(),
      bookId: book.id,
      code: '1000',
      name: `资产${tag}`,
      parentId: null,
      balanceDirection: 'DEBIT',
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
      enabled: true,
    })
    await page.goto('/')
    await menu(page, 'subject')
    await choose(page, '账簿', book.name)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await expect(page.getByText('共 1 项', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('编码', { exact: true }).fill('1122')
    await dialog.getByLabel('名称', { exact: true }).fill(`应收${tag}`)
    await choose(page, '上级科目', parent.name, dialog)
    await dialog
      .getByRole('combobox', { name: '辅助核算维度', exact: true })
      .press('ArrowDown')
    await page.getByRole('option', { name: '客户', exact: true }).click()
    await page.keyboard.press('Escape')
    await dialog
      .getByRole('combobox', { name: '结算用途', exact: true })
      .press('ArrowDown')
    await page.getByRole('option', { name: '应收', exact: true }).click()
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const row = () =>
      page.locator('tr, .list-card').filter({ hasText: `应收${tag}` })
    await expect(row()).toContainText(parent.name)
    await row().getByRole('button', { name: '编辑', exact: true }).click()
    await expect(
      dialog.getByRole('combobox', { name: '账簿', exact: true }),
    ).toBeDisabled()
    await expect(dialog).toContainText(`1000 · ${parent.name}`)
    await dialog.getByLabel('启用', { exact: true }).uncheck()
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(row()).toContainText('停用')
    await row().getByRole('button', { name: '查看', exact: true }).click()
    await expect(
      dialog.getByRole('combobox', { name: '结算用途', exact: true }),
    ).toBeDisabled()
    await expect(dialog).toContainText('应收')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    const root = page.locator(`[data-testid="list-row-${parent.id}"]`)
    await root.getByRole('button', { name: '删除', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '删除', exact: true })
      .click()
    await expect(page.getByText(/科目有子科目或业务引用/)).toBeVisible()
    await row().getByRole('button', { name: '删除', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '删除', exact: true })
      .click()
    await expect(page.getByText('共 1 项', { exact: true })).toBeVisible()
    await noOverflow(page)
  })
  test(`会计期间 ${width}px shows unpersisted months and preserves state on a real closing blocker`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const { post } = await session(page)
    const tag = randomBytes(4).toString('hex')
    const book = await post('/acc/book/create', {
      id: ulid(),
      name: `期间账簿${tag}`,
      description: '',
      baseCurrency: 'CNY',
      startMonth: '2026-01',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    })
    await page.goto('/')
    await menu(page, 'period')
    await choose(page, '账簿', book.name)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    const row = page.locator('tr, .list-card').filter({ hasText: '2026-01' })
    await expect(row).toContainText('未锁定')
    await row.getByRole('button', { name: '锁定', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText(book.name)
    await expect(page.getByRole('dialog')).toContainText('2026-01')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await row.getByRole('button', { name: '锁定', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '确认锁定', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toContainText('期初尚未批准')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await expect(row).toContainText('未锁定')
    await expect(
      row.getByRole('button', { name: '锁定', exact: true }),
    ).toBeEnabled()
    await noOverflow(page)
  })
}
