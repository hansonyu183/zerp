import { randomUUID } from 'node:crypto'

import {
  expect,
  test,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test'

type MaintainedAuxEntity =
  | 'product-category'
  | 'product-type'
  | 'employee-category'
  | 'department'
  | 'position'
  | 'payment-method'
  | 'dictionary-type'
  | 'dictionary-item'
  | 'measurement-unit'
  | 'income-expense-type'
  | 'asset-category'

const auxPages: ReadonlyArray<{
  entity: MaintainedAuxEntity | 'settlement-method'
  title: string
}> = [
  { entity: 'product-category', title: '产品分类' },
  { entity: 'product-type', title: '产品类型' },
  { entity: 'employee-category', title: '员工分类' },
  { entity: 'department', title: '部门' },
  { entity: 'position', title: '岗位' },
  { entity: 'settlement-method', title: '结算方式' },
  { entity: 'payment-method', title: '收款方式' },
  { entity: 'dictionary-type', title: '字典类型' },
  { entity: 'dictionary-item', title: '字典项' },
  { entity: 'measurement-unit', title: '计量单位' },
  { entity: 'income-expense-type', title: '收支类型' },
  { entity: 'asset-category', title: '资产分类' },
]

function honoResponse(page: Page, pathname: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === pathname,
  )
}

async function expectSuccess<Data = unknown>(
  response: Promise<Response>,
  label: string,
): Promise<Data> {
  const received = await response
  expect(received.ok(), label).toBe(true)
  const body = (await received.json()) as { code?: unknown; data?: Data }
  expect(body.code, label).toBe(0)
  return body.data as Data
}

async function signIn(page: Page) {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(process.env.TARGET_E2E_USERNAME!)
  await page.getByLabel('密码').fill(process.env.TARGET_E2E_PASSWORD!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户名')).toHaveCount(0)
}

async function selectVuetifyOption(
  page: Page,
  control: Locator,
  optionText?: string,
) {
  const menuId = await control.getAttribute('aria-controls')
  if (!menuId) throw new Error('选择控件缺少 aria-controls')
  await control
    .locator('xpath=ancestor::*[contains(@class,"v-input")][1]')
    .locator('.v-field')
    .click()
  const options = page.locator(`#${menuId}`).getByRole('option')
  if (optionText) await options.filter({ hasText: optionText }).click()
  else await options.first().click()
}

async function visitListPage(
  page: Page,
  path: string,
  queryPath: string,
  title: string,
) {
  const query = honoResponse(page, queryPath)
  await page.goto(path)
  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expectSuccess(query, `${title}列表查询`)
  await expect(page.getByRole('main')).toContainText(title)
  await expect(
    page.getByRole('button', { name: '查询', exact: true }),
  ).toBeVisible()
}

async function deleteAux(
  page: Page,
  entity: MaintainedAuxEntity,
  dialog: Locator,
) {
  const deleted = honoResponse(page, `/aux/${entity}/delete`)
  page.once('dialog', (confirmation) => void confirmation.accept())
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await expectSuccess(deleted, `${entity}浏览器删除`)
  await expect(dialog).toBeHidden()
}

async function createAndReadBackAux(
  page: Page,
  entity: MaintainedAuxEntity,
  title: string,
  suffix: string,
  dictionaryTypeName?: string,
) {
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const name = `${title} E2E ${suffix}`
  await dialog.getByLabel('名称', { exact: true }).fill(name)

  if (entity === 'product-type')
    await selectVuetifyOption(
      page,
      dialog.getByLabel('行为模板', { exact: true }),
    )
  if (entity === 'dictionary-item') {
    if (!dictionaryTypeName) throw new Error('字典项缺少字典类型夹具')
    await selectVuetifyOption(
      page,
      dialog.getByLabel('字典类型', { exact: true }),
      dictionaryTypeName,
    )
  }
  if (entity === 'measurement-unit')
    await dialog.getByLabel('符号', { exact: true }).fill('件')
  if (entity === 'income-expense-type')
    await selectVuetifyOption(page, dialog.getByLabel('方向', { exact: true }))

  const created = honoResponse(page, `/aux/${entity}/create`)
  const readBack = honoResponse(page, `/aux/${entity}/get`)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expectSuccess(created, `${entity}浏览器新增`)
  await expectSuccess(readBack, `${entity}新增 Hono 回读`)
  await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue(name)
  return { dialog, name }
}

test('APP 管理页可从浏览器导航、保存并由 Hono 回读', async ({ browser }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await signIn(page)

    await visitListPage(page, '/app/user', '/app/user/query', '用户管理')
    await expect(
      page.getByRole('textbox', {
        name: '用户名或显示名称',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '新增用户', exact: true }),
    ).toBeVisible()

    await visitListPage(page, '/app/role', '/app/role/query', '角色管理')
    await page.getByRole('button', { name: '新增角色', exact: true }).click()
    const roleDialog = page.getByRole('dialog')
    await expect(roleDialog).toBeVisible()
    await roleDialog
      .getByLabel('角色名称', { exact: true })
      .fill(`E2E 管理角色 ${randomUUID().slice(0, 8)}`)
    await selectVuetifyOption(
      page,
      roleDialog.getByLabel('权限', { exact: true }),
    )
    const roleCreated = honoResponse(page, '/app/role/create')
    const roleReadBack = honoResponse(page, '/app/role/get')
    await roleDialog.getByRole('button', { name: '保存', exact: true }).click()
    const createdRole = await expectSuccess<{ code: string }>(
      roleCreated,
      '角色浏览器新增',
    )
    const readBackRole = await expectSuccess<{ code: string }>(
      roleReadBack,
      '角色新增 Hono 回读',
    )
    expect(readBackRole.code).toBe(createdRole.code)
    await expect(
      roleDialog.getByLabel('角色编码', { exact: true }),
    ).toHaveValue(readBackRole.code)
    await roleDialog.getByRole('button', { name: '关闭', exact: true }).click()

    await visitListPage(
      page,
      '/app/permission',
      '/app/permission/query',
      '权限目录',
    )
    const permissionReadBack = honoResponse(page, '/app/permission/get')
    await page
      .getByRole('button', { name: '查看', exact: true })
      .first()
      .click()
    await expectSuccess(permissionReadBack, '权限详情 Hono 回读')
    await expect(page.getByRole('dialog')).toContainText('权限详情')
    await page.getByRole('button', { name: '关闭', exact: true }).click()

    await visitListPage(
      page,
      '/app/system-parameter',
      '/app/system-parameter/query',
      '系统参数',
    )
    const parameterRead = honoResponse(page, '/app/system-parameter/get')
    await page
      .getByRole('button', { name: '维护', exact: true })
      .first()
      .click()
    await expectSuccess(parameterRead, '系统参数详情 Hono 回读')
    const parameterDialog = page.getByRole('dialog')
    const originalValue = await parameterDialog
      .getByLabel('当前值', { exact: true })
      .inputValue()
    const parameterSaved = honoResponse(page, '/app/system-parameter/save')
    const parameterSavedReadBack = honoResponse(
      page,
      '/app/system-parameter/get',
    )
    await parameterDialog
      .getByRole('button', { name: '保存', exact: true })
      .click()
    await expectSuccess(parameterSaved, '系统参数浏览器保存原值')
    await expectSuccess(parameterSavedReadBack, '系统参数保存 Hono 回读')
    await expect(
      parameterDialog.getByLabel('当前值', { exact: true }),
    ).toHaveValue(originalValue)
    await parameterDialog
      .getByRole('button', { name: '关闭', exact: true })
      .click()

    const menuRead = honoResponse(page, '/app/menu/get')
    await page.goto('/app/menu')
    await expectSuccess(menuRead, '菜单读取')
    await expect(page.getByRole('main')).toContainText('菜单管理')
    await page.getByRole('button', { name: '新增菜单组', exact: true }).click()
    const newestMenuGroup = page.locator('tbody tr').last()
    await newestMenuGroup
      .getByRole('textbox')
      .first()
      .fill(`E2E 菜单组 ${randomUUID().slice(0, 8)}`)
    const menuSaved = honoResponse(page, '/app/menu/save-business')
    const menuSavedReadBack = honoResponse(page, '/app/menu/get')
    await page
      .getByRole('button', { name: '保存业务菜单', exact: true })
      .click()
    await expectSuccess(menuSaved, '菜单浏览器保存')
    await expectSuccess(menuSavedReadBack, '菜单保存 Hono 回读')
    const menuReset = honoResponse(page, '/app/menu/reset-business')
    const menuResetReadBack = honoResponse(page, '/app/menu/get')
    await page
      .getByRole('button', { name: '重置业务菜单', exact: true })
      .click()
    await expectSuccess(menuReset, '菜单浏览器重置')
    await expectSuccess(menuResetReadBack, '菜单重置 Hono 回读')
  } finally {
    await context.close()
  }
})

test('12 个 AUX 管理页均由浏览器保存、回读和删除', async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await signIn(page)
    const suffix = randomUUID().slice(0, 8)
    let dictionaryTypeName: string | undefined

    for (const { entity, title } of auxPages) {
      await visitListPage(page, `/aux/${entity}`, `/aux/${entity}/query`, title)
      if (entity === 'settlement-method') {
        const settlementRead = honoResponse(page, '/aux/settlement-method/get')
        await page
          .getByRole('button', { name: '维护', exact: true })
          .first()
          .click()
        await expectSuccess(settlementRead, '结算方式详情 Hono 回读')
        const dialog = page.getByRole('dialog')
        const surcharge = await dialog
          .getByLabel('默认销售加价（元/kg）', { exact: true })
          .inputValue()
        const settlementSaved = honoResponse(
          page,
          '/aux/settlement-method/save',
        )
        const settlementReadBack = honoResponse(
          page,
          '/aux/settlement-method/get',
        )
        await dialog.getByRole('button', { name: '保存', exact: true }).click()
        await expectSuccess(settlementSaved, '结算方式浏览器保存原值')
        await expectSuccess(settlementReadBack, '结算方式保存 Hono 回读')
        await expect(
          dialog.getByLabel('默认销售加价（元/kg）', { exact: true }),
        ).toHaveValue(surcharge)
        await dialog.getByRole('button', { name: '关闭', exact: true }).click()
        continue
      }

      const created = await createAndReadBackAux(
        page,
        entity,
        title,
        suffix,
        dictionaryTypeName,
      )
      if (entity === 'dictionary-type') {
        dictionaryTypeName = created.name
        await created.dialog
          .getByRole('button', { name: '关闭', exact: true })
          .click()
        continue
      }
      await deleteAux(page, entity, created.dialog)
    }

    if (!dictionaryTypeName) throw new Error('字典类型浏览器夹具未创建')
    await visitListPage(
      page,
      '/aux/dictionary-type',
      '/aux/dictionary-type/query',
      '字典类型',
    )
    const dictionaryTypeRead = honoResponse(page, '/aux/dictionary-type/get')
    await page
      .getByRole('row')
      .filter({ hasText: dictionaryTypeName })
      .getByRole('button', { name: '维护', exact: true })
      .click()
    await expectSuccess(dictionaryTypeRead, '字典类型删除前 Hono 回读')
    await deleteAux(page, 'dictionary-type', page.getByRole('dialog'))
  } finally {
    await context.close()
  }
})
