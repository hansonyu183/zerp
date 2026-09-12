import { randomBytes } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

type Envelope = { code: number; errorKey: string; data: any }

async function openFromMenu(
  page: Page,
  path: string,
  width: number,
): Promise<void> {
  await page.setViewportSize({ width, height: 960 })
  await page.reload()
  const drawer = page.locator('.v-navigation-drawer')
  if (
    !(await drawer.getAttribute('class'))?.includes(
      'v-navigation-drawer--active',
    )
  )
    await page.getByRole('button', { name: '切换导航', exact: true }).click()
  await expect(drawer).toHaveClass(/v-navigation-drawer--active/)
  const group = drawer
    .locator('.v-list-group')
    .filter({ has: page.locator(`a[href="${path}"]`) })
  if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
    await group.locator('.v-list-group__header').click()
  await drawer.locator(`a[href="${path}"]`).click()
  await page.waitForURL(`**${path}`)
  if (width === 390)
    await expect(drawer).not.toHaveClass(/v-navigation-drawer--active/)
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
): Promise<void> {
  const field = dialog
    .locator('.v-select, .v-autocomplete')
    .filter({ hasText: label })
  await field.locator('.v-field').click()
  await field.locator('input').fill(name)
  const option = page.getByRole('option').filter({ hasText: name })
  await expect(option).toHaveCount(1)
  await option.click()
}

test('operating entities and employees use direct AUX ListPages on desktop and 390px', async ({
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
  const categoryName = `E2E员工分类${tag}`
  const departmentName = `E2E员工部门${tag}`
  const positionName = `E2E员工岗位${tag}`
  const [category, department, position] = await Promise.all([
    post('/aux/employee-category/create', {
      name: categoryName,
      description: '',
    }),
    post('/aux/department/create', {
      name: departmentName,
      parentId: '',
      description: '',
    }),
    post('/aux/position/create', { name: positionName, description: '' }),
  ])
  for (const response of [category, department, position])
    expect(response.code).toBe(0)

  const operatingEntityName = `E2E经营主体${tag}`
  const operatingEntityIdentifier = `A0${tag}`
  await openFromMenu(page, '/aux/operating-entity', 1440)
  await page.getByRole('button', { name: '新增经营主体', exact: true }).click()
  const discarded = page.getByRole('dialog')
  await discarded
    .getByLabel('法定名称', { exact: true })
    .fill(`未保存主体${tag}`)
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: '新增经营主体', exact: true }).click()
  const operatingEntityEditor = page.getByRole('dialog')
  await operatingEntityEditor
    .getByLabel('法定名称', { exact: true })
    .fill(operatingEntityName)
  await operatingEntityEditor
    .getByLabel('简称', { exact: true })
    .fill('E2E主体')
  await operatingEntityEditor
    .getByLabel('统一社会信用代码', { exact: true })
    .fill(operatingEntityIdentifier)
  await operatingEntityEditor
    .getByLabel('注册地址', { exact: true })
    .fill('测试注册地址')
  await operatingEntityEditor
    .getByLabel('联系人', { exact: true })
    .fill('测试联系人')
  await operatingEntityEditor
    .getByLabel('联系电话', { exact: true })
    .fill('13800000000')
  await operatingEntityEditor
    .getByLabel('开票抬头', { exact: true })
    .fill('测试开票抬头')
  await operatingEntityEditor
    .getByLabel('开票地址', { exact: true })
    .fill('测试开票地址')
  await operatingEntityEditor
    .getByLabel('开票电话', { exact: true })
    .fill('01012345678')
  await operatingEntityEditor
    .getByLabel('开户行', { exact: true })
    .fill('测试银行')
  await operatingEntityEditor
    .getByLabel('银行账号', { exact: true })
    .fill('6222020000000000')
  await operatingEntityEditor
    .getByLabel('备注', { exact: true })
    .fill('初始备注')
  await operatingEntityEditor
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await expect(operatingEntityEditor).toHaveCount(0)

  await page
    .getByLabel('编码、拼音或名称', { exact: true })
    .fill(operatingEntityName)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const operatingEntityRow = page
    .getByRole('row')
    .filter({ hasText: operatingEntityName })
  await expect(operatingEntityRow).toBeVisible()
  await operatingEntityRow
    .getByRole('button', { name: '编辑', exact: true })
    .click()
  await expect(
    operatingEntityEditor.getByLabel('备注', { exact: true }),
  ).toHaveValue('初始备注')
  await operatingEntityEditor
    .getByLabel('备注', { exact: true })
    .fill('已编辑备注')
  await operatingEntityEditor
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await expect(operatingEntityEditor).toHaveCount(0)
  await operatingEntityRow
    .getByRole('button', { name: '停用', exact: true })
    .click()
  await expect(
    operatingEntityRow.getByRole('button', { name: '启用', exact: true }),
  ).toBeVisible()
  await operatingEntityRow
    .getByRole('button', { name: '启用', exact: true })
    .click()
  await expect(
    operatingEntityRow.getByRole('button', { name: '停用', exact: true }),
  ).toBeVisible()

  const operatingEntityQuery = await post('/aux/operating-entity/query', {
    keyword: operatingEntityName,
    page: 1,
    pageSize: 20,
  })
  expect(operatingEntityQuery.code).toBe(0)
  const operatingEntity = operatingEntityQuery.data.items.find(
    (item: { name: string }) => item.name === operatingEntityName,
  )
  expect(operatingEntity).toBeTruthy()

  const employeeName = `E2E员工${tag}`
  await openFromMenu(page, '/aux/employee', 1440)
  await page.getByRole('button', { name: '新增员工', exact: true }).click()
  const employeeEditor = page.getByRole('dialog')
  await expect(
    employeeEditor.getByRole('button', { name: '保存', exact: true }),
  ).toBeEnabled()
  await employeeEditor
    .getByLabel('法定名称', { exact: true })
    .fill(employeeName)
  await employeeEditor
    .getByLabel('显示名称', { exact: true })
    .fill(employeeName)
  await employeeEditor
    .getByLabel('法定标识', { exact: true })
    .fill(`EMP-${tag}`)
  await selectOption(page, employeeEditor, '任职经营主体', operatingEntityName)
  await selectOption(page, employeeEditor, '员工分类', categoryName)
  await selectOption(page, employeeEditor, '部门', departmentName)
  await selectOption(page, employeeEditor, '岗位', positionName)
  await employeeEditor
    .getByLabel('入职日期', { exact: true })
    .fill('2026-09-07')
  await employeeEditor
    .getByLabel('工作邮箱', { exact: true })
    .fill('e2e@example.com')
  await employeeEditor.getByLabel('备注', { exact: true }).fill('初始员工备注')
  const employeeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/aux/employee/create') &&
      response.request().method() === 'POST',
  )
  await employeeEditor
    .getByRole('button', { name: '保存', exact: true })
    .click()
  const employeeCreated = await (await employeeResponse).json()
  expect(employeeCreated.errorKey).toBe('')
  await expect(employeeEditor).toHaveCount(0)

  await page.getByLabel('编码、拼音或名称', { exact: true }).fill(employeeName)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const employeeRow = page.getByRole('row').filter({ hasText: employeeName })
  await expect(employeeRow).toBeVisible()
  await employeeRow.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(
    employeeEditor.getByLabel('显示名称', { exact: true }),
  ).toHaveValue(employeeName)
  await employeeEditor
    .getByLabel('显示名称', { exact: true })
    .fill(`${employeeName}已编辑`)
  await employeeEditor
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await expect(employeeEditor).toHaveCount(0)
  await employeeRow.getByRole('button', { name: '停用', exact: true }).click()
  await expect(
    employeeRow.getByRole('button', { name: '启用', exact: true }),
  ).toBeVisible()
  await employeeRow.getByRole('button', { name: '启用', exact: true }).click()
  await expect(
    employeeRow.getByRole('button', { name: '停用', exact: true }),
  ).toBeVisible()

  const employeeQuery = await post('/aux/employee/query', {
    keyword: employeeName,
    page: 1,
    pageSize: 20,
  })
  expect(employeeQuery.code).toBe(0)
  const employee = employeeQuery.data.items.find(
    (item: { name: string }) => item.name === `${employeeName}已编辑`,
  )
  expect(employee).toBeTruthy()
  const employeeDetail = await post('/aux/employee/get', { id: employee.id })
  expect(employeeDetail.code).toBe(0)
  expect(employeeDetail.data.operatingEntity.id).toBe(operatingEntity.id)
  expect(employeeDetail.data.employeeCategory.id).toBe(category.data.id)
  expect(employeeDetail.data.department.id).toBe(department.data.id)
  expect(employeeDetail.data.position.id).toBe(position.data.id)

  for (const path of ['/aux/operating-entity', '/aux/employee'])
    await openFromMenu(page, path, 390)
})
