import { randomBytes } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

type Envelope = { code: number; errorKey: string; data: any }

async function openFromMenu(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 960 })
  await page.reload()
  const drawer = page.locator('.v-navigation-drawer')
  if (
    !(await drawer.getAttribute('class'))?.includes(
      'v-navigation-drawer--active',
    )
  )
    await page.getByRole('button', { name: '切换导航', exact: true }).click()
  const group = drawer
    .locator('.v-list-group')
    .filter({ has: page.locator(`a[href="${path}"]`) })
  if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
    await group.locator('.v-list-group__header').click()
  await drawer.locator(`a[href="${path}"]`).click()
  await page.waitForURL(`**${path}`)
  await expect(page.getByTestId('list-page-shell')).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
}

async function selectOption(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
  label: string,
  name: string,
) {
  await dialog
    .locator('.v-select, .v-autocomplete')
    .filter({ hasText: label })
    .locator('.v-field')
    .click()
  await page.getByRole('option').filter({ hasText: name }).click()
}

async function search(page: Page, name: string) {
  await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '查询', exact: true }).click()
}

test('AUX assets have temporary forms, direct CRUD, enablement, navigation, and mobile layouts', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('/signin')
  await page
    .getByLabel('用户编码', { exact: true })
    .fill(process.env.TARGET_E2E_USERNAME!)
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TARGET_E2E_PASSWORD!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)

  const base = process.env.TARGET_API_BASE_URL!
  const headers = { 'x-zerp-model-build': modelBuildId }
  const restored = (await (
    await page.request.post(`${base}/session/auth/restore`, {
      data: {},
      headers,
    })
  ).json()) as Envelope & { data: { csrfToken: string } }
  expect(restored.code).toBe(0)
  const post = async (path: string, data: Record<string, unknown>) =>
    (await (
      await page.request.post(`${base}${path}`, {
        data,
        headers: { ...headers, 'x-csrf-token': restored.data.csrfToken },
      })
    ).json()) as Envelope
  const tag = randomBytes(8).toString('hex').toUpperCase()

  const operatingEntityName = `E2E资产主体${tag}`
  await openFromMenu(page, '/aux/operating-entity', 1440)
  await page.getByRole('button', { name: '新增经营主体', exact: true }).click()
  const entityEditor = page.getByRole('dialog')
  await entityEditor
    .getByLabel('法定名称', { exact: true })
    .fill(operatingEntityName)
  await entityEditor.getByLabel('简称', { exact: true }).fill('E2E资产主体')
  await entityEditor
    .getByLabel('统一社会信用代码', { exact: true })
    .fill(`A0${tag}`)
  await entityEditor
    .getByLabel('注册地址', { exact: true })
    .fill('测试注册地址')
  await entityEditor.getByLabel('联系人', { exact: true }).fill('测试联系人')
  await entityEditor.getByLabel('联系电话', { exact: true }).fill('13800000000')
  await entityEditor
    .getByLabel('开票抬头', { exact: true })
    .fill(operatingEntityName)
  await entityEditor
    .getByLabel('开票地址', { exact: true })
    .fill('测试开票地址')
  await entityEditor.getByLabel('开票电话', { exact: true }).fill('01012345678')
  await entityEditor.getByLabel('开户行', { exact: true }).fill('测试银行')
  await entityEditor
    .getByLabel('银行账号', { exact: true })
    .fill('6222020000000000')
  await entityEditor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(entityEditor).toHaveCount(0)

  const warehouseName = `E2E仓库${tag}`
  await openFromMenu(page, '/aux/warehouse', 1440)
  await page.getByRole('button', { name: '新增仓库', exact: true }).click()
  const warehouseEditor = page.getByRole('dialog')
  await warehouseEditor
    .getByLabel('名称', { exact: true })
    .fill(`未保存仓库${tag}`)
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '新增仓库', exact: true }).click()
  await warehouseEditor.getByLabel('名称', { exact: true }).fill(warehouseName)
  await warehouseEditor.getByLabel('地址', { exact: true }).fill('北京')
  await warehouseEditor
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await search(page, warehouseName)
  const warehouseRow = page.getByRole('row').filter({ hasText: warehouseName })
  await warehouseRow.getByRole('button', { name: '编辑', exact: true }).click()
  await warehouseEditor.getByLabel('地址', { exact: true }).fill('上海')
  await warehouseEditor
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await warehouseRow.getByRole('button', { name: '停用', exact: true }).click()
  await expect(
    warehouseRow.getByRole('button', { name: '启用', exact: true }),
  ).toBeVisible()
  await warehouseRow.getByRole('button', { name: '启用', exact: true }).click()
  await warehouseRow.getByRole('button', { name: '删除', exact: true }).click()
  const deleteDialog = page.getByRole('dialog')
  await deleteDialog.getByRole('button', { name: '删除', exact: true }).click()
  await expect(warehouseRow).toHaveCount(0)

  const accountName = `E2E资金账户${tag}`
  await openFromMenu(page, '/aux/fund-account', 1440)
  await page.getByRole('button', { name: '新增资金账户', exact: true }).click()
  const accountEditor = page.getByRole('dialog')
  await accountEditor.getByLabel('名称', { exact: true }).fill(accountName)
  await selectOption(page, accountEditor, '所属经营主体', operatingEntityName)
  await accountEditor.getByLabel('币种', { exact: true }).fill('CNY')
  await accountEditor
    .getByLabel('户名', { exact: true })
    .fill(operatingEntityName)
  await accountEditor.getByLabel('开户行', { exact: true }).fill('示例银行')
  await accountEditor.getByLabel('账号', { exact: true }).fill(`ACC${tag}`)
  await accountEditor.getByRole('button', { name: '保存', exact: true }).click()
  await search(page, accountName)
  const accountRow = page.getByRole('row').filter({ hasText: accountName })
  await accountRow.getByRole('button', { name: '停用', exact: true }).click()
  await accountRow.getByRole('button', { name: '启用', exact: true }).click()
  await accountRow.getByRole('button', { name: '删除', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '删除', exact: true })
    .click()
  await expect(accountRow).toHaveCount(0)

  const vehicleTypes = await post('/aux/reference/query', {
    entity: 'dictionary-item',
  })
  const otherUnits = await post('/bob/reference/query', {
    entity: 'other-unit',
  })
  expect(vehicleTypes.code).toBe(0)
  expect(otherUnits.code).toBe(0)
  const vehicleType = vehicleTypes.data[0]
  const otherUnit = otherUnits.data[0]
  expect(vehicleType).toBeTruthy()
  expect(otherUnit).toBeTruthy()
  const vehicleName = `E2E车辆${tag}`
  await openFromMenu(page, '/aux/vehicle', 1440)
  await page.getByRole('button', { name: '新增车辆', exact: true }).click()
  const vehicleEditor = page.getByRole('dialog')
  await vehicleEditor.getByLabel('名称', { exact: true }).fill(vehicleName)
  await vehicleEditor
    .getByLabel('车牌号', { exact: true })
    .fill(`京E${tag.slice(0, 5)}`)
  await selectOption(page, vehicleEditor, '车型', vehicleType.code)
  await selectOption(page, vehicleEditor, '承运归属', '外部')
  await selectOption(
    page,
    vehicleEditor,
    '外部承运单位',
    `${otherUnit.code} · ${otherUnit.name}`,
  )
  await vehicleEditor.getByLabel('核定载重（kg）', { exact: true }).fill('1500')
  await vehicleEditor.getByRole('button', { name: '保存', exact: true }).click()
  await search(page, vehicleName)
  const vehicleRow = page.getByRole('row').filter({ hasText: vehicleName })
  await vehicleRow.getByRole('button', { name: '停用', exact: true }).click()
  await vehicleRow.getByRole('button', { name: '启用', exact: true }).click()
  await vehicleRow.getByRole('button', { name: '删除', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '删除', exact: true })
    .click()
  await expect(vehicleRow).toHaveCount(0)

  for (const [entity, caption] of [
    ['warehouse', '仓库'],
    ['fund-account', '资金账户'],
    ['vehicle', '车辆'],
  ] as const) {
    await openFromMenu(page, `/aux/${entity}`, 390)
    await page
      .getByRole('button', { name: `新增${caption}`, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    const mobileName = `手机${caption}${tag}`
    await dialog.getByLabel('名称', { exact: true }).fill(mobileName)
    if (entity === 'fund-account') {
      await selectOption(page, dialog, '所属经营主体', operatingEntityName)
      await dialog.getByLabel('币种', { exact: true }).fill('CNY')
      await dialog.getByLabel('户名', { exact: true }).fill(operatingEntityName)
      await dialog.getByLabel('开户行', { exact: true }).fill('手机测试银行')
      await dialog.getByLabel('账号', { exact: true }).fill(`M${tag}`)
    } else if (entity === 'vehicle') {
      await dialog
        .getByLabel('车牌号', { exact: true })
        .fill(`粤M${tag.slice(0, 5)}`)
      await selectOption(page, dialog, '车型', vehicleType.code)
      await selectOption(page, dialog, '所属经营主体', operatingEntityName)
      await dialog.getByLabel('核定载重（kg）', { exact: true }).fill('0')
    }
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await search(page, mobileName)
    const row = page.getByRole('row').filter({ hasText: mobileName })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: '删除', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '删除', exact: true })
      .click()
    await expect(row).toHaveCount(0)
  }
})
