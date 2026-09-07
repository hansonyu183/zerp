import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

type SimpleAuxPage = {
  entity: 'employee-category' | 'position'
  title: string
  createLabel: string
  prefix: 'ECT' | 'POS'
  baseName: string
  renamedBaseName: string
  py: string
  viewport: { width: number; height: number }
  screenshotPrefix: string
  screenshot: 'list' | 'editor'
}

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

async function openPage(page: Page, entity: SimpleAuxPage['entity']) {
  const drawer = page.locator('.v-navigation-drawer')
  if (
    !(await drawer.getAttribute('class'))?.includes(
      'v-navigation-drawer--active',
    )
  )
    await page.getByRole('button', { name: '切换导航', exact: true }).click()
  await expect(drawer).toHaveClass(/v-navigation-drawer--active/)
  const closed = drawer.locator(
    '.v-list-group:not(.v-list-group--open) > .v-list-group__header',
  )
  while (await closed.count()) await closed.first().click()
  await drawer.locator(`a[href="/aux/${entity}"]`).click()
  await expect(
    page.getByLabel('编码、拼音或名称', { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('business-unimplemented')).toHaveCount(0)
}

async function search(page: Page, keyword: string) {
  await page.getByLabel('编码、拼音或名称', { exact: true }).fill(keyword)
  await page.getByRole('button', { name: '查询', exact: true }).click()
}

function screenshotPath(name: string): string {
  const directory = resolve(import.meta.dirname, '../../test-results')
  mkdirSync(directory, { recursive: true })
  return resolve(directory, `issue386-${name}.png`)
}

async function exerciseSimpleAuxPage(page: Page, config: SimpleAuxPage) {
  const tag = randomBytes(4).toString('hex')
  const exactName = `${config.baseName}-${tag}-21`
  const renamedName = `${config.renamedBaseName}-${tag}`

  await page.setViewportSize(config.viewport)
  await openPage(page, config.entity)

  for (let index = 1; index <= 21; index += 1) {
    await page
      .getByRole('button', { name: config.createLabel, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog
      .getByLabel('名称', { exact: true })
      .fill(`${config.baseName}-${tag}-${String(index).padStart(2, '0')}`)
    await dialog
      .getByLabel('说明', { exact: true })
      .fill(`E2E ${config.title} ${index}`)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }

  const totalLabel = page.locator('.management-page__footer > span')
  await expect(totalLabel).toHaveText(/共 \d+ 项/)
  expect(
    Number((await totalLabel.innerText()).match(/\d+/)?.[0]),
  ).toBeGreaterThan(20)
  await search(page, exactName)
  let row = page.getByRole('row').filter({ hasText: exactName })
  await expect(row).toBeVisible()
  const code = (await row.innerText()).match(
    new RegExp(`${config.prefix}-\\d+`),
  )?.[0]
  expect(code).toBeTruthy()

  await search(page, code!)
  row = page.getByRole('row').filter({ hasText: exactName })
  await expect(row).toBeVisible()

  await search(page, `${config.py}-${tag}-21`)
  row = page.getByRole('row').filter({ hasText: exactName })
  await expect(row).toBeVisible()

  if (config.screenshot === 'list')
    await page.screenshot({
      animations: 'disabled',
      path: screenshotPath(`${config.screenshotPrefix}-list`),
    })
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('名称', { exact: true }).fill(renamedName)
  await dialog
    .getByLabel('说明', { exact: true })
    .fill(`已编辑 ${config.title}`)
  if (config.screenshot === 'editor')
    await page.screenshot({
      animations: 'disabled',
      path: screenshotPath(`${config.screenshotPrefix}-editor`),
    })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await search(page, renamedName)
  row = page.getByRole('row').filter({ hasText: renamedName })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '停用', exact: true }).click()
  await expect(
    row.getByRole('button', { name: '启用', exact: true }),
  ).toBeVisible()
  await row.getByRole('button', { name: '启用', exact: true }).click()
  await expect(
    row.getByRole('button', { name: '停用', exact: true }),
  ).toBeVisible()
  return { code: code!, tag, renamedName }
}

async function exerciseExistingSimpleAuxPage(
  page: Page,
  config: SimpleAuxPage,
  fact: { code: string; tag: string; renamedName: string },
) {
  await page.setViewportSize(config.viewport)
  await expect(
    page.getByLabel('编码、拼音或名称', { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('business-unimplemented')).toHaveCount(0)
  await search(page, fact.renamedName)
  let row = page.getByRole('row').filter({ hasText: fact.renamedName })
  await expect(row).toBeVisible()

  await search(page, fact.code)
  row = page.getByRole('row').filter({ hasText: fact.renamedName })
  await expect(row).toBeVisible()

  await search(page, `gaojicaigou-${fact.tag}`)
  row = page.getByRole('row').filter({ hasText: fact.renamedName })
  await expect(row).toBeVisible()

  await page
    .getByRole('button', { name: config.createLabel, exact: true })
    .click()
  const createDialog = page.getByRole('dialog')
  await createDialog
    .getByLabel('名称', { exact: true })
    .fill(`补充-${fact.tag}`)
  await createDialog
    .getByLabel('说明', { exact: true })
    .fill(`移动端 ${config.title}`)
  await createDialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(createDialog).toHaveCount(0)

  await search(page, fact.renamedName)
  row = page.getByRole('row').filter({ hasText: fact.renamedName })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  const editDialog = page.getByRole('dialog')
  await expect(editDialog).toBeVisible()
  await editDialog
    .getByLabel('说明', { exact: true })
    .fill(`复检 ${config.title}`)
  if (config.screenshot === 'editor')
    await page.screenshot({
      animations: 'disabled',
      path: screenshotPath(`${config.screenshotPrefix}-editor`),
    })
  await editDialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editDialog).toHaveCount(0)
  await row.getByRole('button', { name: '停用', exact: true }).click()
  await expect(
    row.getByRole('button', { name: '启用', exact: true }),
  ).toBeVisible()
  await row.getByRole('button', { name: '启用', exact: true }).click()
  await expect(
    row.getByRole('button', { name: '停用', exact: true }),
  ).toBeVisible()
}

test('employee categories support three-field search, CRUD, enablement, and both required viewports beyond one page', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await signIn(page)
  const desktop = {
    entity: 'employee-category',
    title: '员工分类',
    createLabel: '新增员工分类',
    prefix: 'ECT',
    baseName: '采购',
    renamedBaseName: '高级采购',
    py: 'caigou',
    viewport: { width: 1440, height: 960 },
    screenshotPrefix: 'employee-category-desktop',
    screenshot: 'list',
  } as const
  const fact = await exerciseSimpleAuxPage(page, desktop)
  await exerciseExistingSimpleAuxPage(
    page,
    {
      ...desktop,
      viewport: { width: 390, height: 844 },
      screenshotPrefix: 'employee-category-mobile',
      screenshot: 'editor',
    },
    fact,
  )
})

test('positions support three-field search, CRUD, enablement, and both required viewports beyond one page', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await signIn(page)
  const desktop = {
    entity: 'position',
    title: '岗位',
    createLabel: '新增岗位',
    prefix: 'POS',
    baseName: '采购',
    renamedBaseName: '高级采购',
    py: 'caigou',
    viewport: { width: 1440, height: 960 },
    screenshotPrefix: 'position-desktop',
    screenshot: 'list',
  } as const
  const fact = await exerciseSimpleAuxPage(page, desktop)
  await exerciseExistingSimpleAuxPage(
    page,
    {
      ...desktop,
      viewport: { width: 390, height: 844 },
      screenshotPrefix: 'position-mobile',
      screenshot: 'editor',
    },
    fact,
  )
})
