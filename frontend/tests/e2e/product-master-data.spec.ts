import { expect, test, type Locator, type Page } from './fixtures'

test.describe.configure({ mode: 'serial' })
test.use({ storageState: { cookies: [], origins: [] } })

type Credentials = { username: string; password: string }

async function signIn(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username)
  await page.getByLabel('密码', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/signin/)
}

async function signOut(page: Page): Promise<void> {
  await page.locator('.account-button').click()
  await page.getByText('退出登录', { exact: true }).click()
  await expect(page).toHaveURL(/\/signin$/)
}

async function selectValue(
  page: Page,
  scope: Locator,
  label: string,
  value: string,
): Promise<void> {
  const input = scope.getByRole('combobox', { name: label, exact: true })
  await input.locator('..').click()
  const menuID = await input.getAttribute('aria-controls')
  if (!menuID) throw new Error(`${label}选择器未关联候选列表。`)
  await page
    .locator(`[id="${menuID}"]`)
    .getByRole('option', { name: value, exact: true })
    .click()
}

async function createProductType(
  page: Page,
  name: string,
  behaviorProfile: string,
): Promise<void> {
  await page.goto('/aux/product-type')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const editor = page.locator('.aux-entity-drawer')
  await editor.getByLabel('名称', { exact: true }).fill(name)
  await selectValue(page, editor, '行为模板', behaviorProfile)
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).toHaveAttribute('inert', '')
  await page.getByRole('textbox', { name: '产品类型关键字' }).fill(name)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(page.locator('tbody tr').filter({ hasText: name })).toHaveCount(
    1,
  )
}

function productRow(page: Page, name: string): Locator {
  return page.locator('tbody tr').filter({
    has: page.locator('td[data-label="名称"]').filter({ hasText: name }),
  })
}

async function searchProduct(page: Page, name: string): Promise<Locator> {
  await page.goto('/dcl/product')
  await page.getByRole('textbox', { name: '产品变更关键字' }).fill(name)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = productRow(page, name)
  await expect(row).toHaveCount(1)
  return row
}

async function selectRowAction(
  page: Page,
  row: Locator,
  label: string,
): Promise<void> {
  const direct = row.getByRole('button', { name: label, exact: true })
  if (await direct.count()) {
    await direct.click()
    return
  }
  await row.getByLabel(/更多操作/).click()
  const menu = page.locator('.v-overlay.v-menu.v-overlay--active').last()
  await expect(menu).toBeVisible()
  await menu.getByRole('listitem').filter({ hasText: label }).click()
}

async function selectReference(
  page: Page,
  scope: Locator,
  label: string,
  keyword: string,
): Promise<void> {
  const input = scope.getByRole('combobox', { name: label, exact: true })
  const searched = page.waitForResponse(
    (response) =>
      response.url().endsWith('/query') &&
      (response.request().postData() ?? '').includes(keyword),
  )
  await input.fill('')
  await input.fill(keyword)
  expect((await searched).ok()).toBe(true)
  const option = page
    .locator('.v-overlay.v-menu.v-overlay--active')
    .last()
    .getByRole('option')
    .filter({ hasText: keyword })
    .first()
  await expect(option).toBeVisible()
  await option.click()
}

async function addUnitConversion(
  page: Page,
  editor: Locator,
  unit: string,
  factor: string,
): Promise<void> {
  const conversions = editor.locator('.product-unit-conversions')
  await conversions
    .getByRole('button', { name: '添加单位', exact: true })
    .click()
  const row = conversions.locator('tbody tr').last()
  const unitInput = row.locator('.v-autocomplete input[role="combobox"]')
  await unitInput.fill(unit)
  await unitInput.press('ArrowDown')
  await page.getByRole('option').filter({ hasText: unit }).first().click()
  await row.locator('input[inputmode="decimal"]').fill(factor)
}

async function setDefaultUnits(
  page: Page,
  editor: Locator,
  defaultInput: string,
  pricing: string,
): Promise<void> {
  await selectValue(page, editor, '默认录入单位', defaultInput)
  await selectValue(page, editor, '计价单位', pricing)
}

interface ProductDraft {
  name: string
  productType: string
  units: Array<{ name: string; factor: string }>
  defaultInput: string
  pricing: string
  defaultPackagingSpec?: string
  returnable?: boolean
}

async function openProductCreate(page: Page): Promise<Locator> {
  await page.goto('/dcl/product')
  const unitsLoaded = page.waitForResponse((response) =>
    response.url().endsWith('/aux/measurement-unit/query'),
  )
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const response = await unitsLoaded
  expect(response.ok()).toBe(true)
  const envelope = (await response.json()) as {
    code: string | number
    data: { items: Array<{ data: { name?: string } }> }
  }
  expect(String(envelope.code)).toBe('0')
  expect(envelope.data.items.some((item) => item.data.name === '千克')).toBe(
    true,
  )
  return page.locator('.bob-entity-drawer')
}

async function createProductDraft(
  page: Page,
  input: ProductDraft,
): Promise<void> {
  const editor = await openProductCreate(page)
  await editor.getByLabel('产品名称', { exact: true }).fill(input.name)
  await selectReference(page, editor, '产品类型', input.productType)
  for (const unit of input.units) {
    await addUnitConversion(page, editor, unit.name, unit.factor)
  }
  await setDefaultUnits(page, editor, input.defaultInput, input.pricing)
  if (input.defaultPackagingSpec) {
    await editor
      .getByLabel('默认包装规格', { exact: true })
      .fill(input.defaultPackagingSpec)
  }
  if (input.returnable) {
    await editor.getByLabel('可回收周转', { exact: true }).check()
  }
  const saved = page.waitForResponse((response) =>
    response.url().endsWith('/dcl/product/create'),
  )
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  const response = await saved
  expect(response.ok()).toBe(true)
  const envelope = (await response.json()) as {
    code: string | number
    message?: string
  }
  expect(String(envelope.code), envelope.message).toBe('0')
  await expect(editor).not.toHaveClass(/v-navigation-drawer--active/)
  const row = await searchProduct(page, input.name)
  await expect(row).toContainText('草稿')
}

async function submitProduct(page: Page, name: string): Promise<void> {
  const row = await searchProduct(page, name)
  const submitted = page.waitForResponse((response) =>
    response.url().endsWith('/dcl/product/submit'),
  )
  await selectRowAction(page, row, '提交')
  const envelope = (await (await submitted).json()) as {
    code: string | number
    message?: string
  }
  expect(String(envelope.code), envelope.message).toBe('0')
  await expect(productRow(page, name)).toContainText('待批准')
}

async function approveProduct(page: Page, name: string): Promise<void> {
  const row = await searchProduct(page, name)
  const approved = page.waitForResponse((response) =>
    response.url().endsWith('/dcl/product/approve'),
  )
  await selectRowAction(page, row, '批准')
  const envelope = (await (await approved).json()) as {
    code: string | number
    message?: string
    data?: unknown
  }
  expect(
    String(envelope.code),
    `${envelope.message ?? ''} ${JSON.stringify(envelope.data)}`,
  ).toBe('0')
  await expect(productRow(page, name)).toContainText('已批准')
}

async function maintainFormula(
  page: Page,
  editor: Locator,
  rawMaterialName: string,
): Promise<void> {
  await editor
    .getByRole('button', { name: '维护固定配方', exact: true })
    .click()
  const dialog = page.getByRole('dialog').filter({ hasText: '固定配方' })
  await dialog.getByLabel('基准产量 · 录入数量', { exact: true }).fill('1')
  await selectValue(page, dialog, '录入单位', '千克')
  await dialog.getByRole('button', { name: '添加原料', exact: true }).click()
  const component = dialog.locator('tbody tr').last()
  const searched = page.waitForResponse((response) =>
    response.url().endsWith('/bob/reference/query'),
  )
  await component.locator('.v-autocomplete input').fill(rawMaterialName)
  const envelope = (await (await searched).json()) as {
    code: string | number
    message?: string
    data: Array<{ name: string }>
  }
  expect(String(envelope.code), envelope.message).toBe('0')
  expect(envelope.data.some((item) => item.name === rawMaterialName)).toBe(true)
  await page
    .getByRole('option')
    .filter({ hasText: rawMaterialName })
    .first()
    .click()
  await component.locator('input:not([role="combobox"])').first().fill('2')
  await component.locator('.v-select .v-field').click()
  await page.getByRole('option').filter({ hasText: '千克' }).first().click()
  await dialog.getByRole('button', { name: '保存配方', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function openProductEdit(page: Page, name: string): Promise<Locator> {
  const row = await searchProduct(page, name)
  await selectRowAction(
    page,
    row,
    `编辑 ${await row.locator('td').first().innerText()}`,
  )
  const editor = page.locator('.bob-entity-drawer')
  await expect(editor).toBeVisible()
  return editor
}

async function saveProductEditor(
  page: Page,
  editor: Locator,
): Promise<Record<string, unknown>> {
  const saved = page.waitForResponse((response) =>
    response.url().endsWith('/dcl/product/save'),
  )
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  const envelope = (await (await saved).json()) as {
    code: string | number
    message?: string
    data: Record<string, unknown>
  }
  expect(String(envelope.code), envelope.message).toBe('0')
  await expect(editor).not.toHaveClass(/v-navigation-drawer--active/)
  return envelope.data
}

async function createPackagingCandidate(
  page: Page,
  name: string,
  specification: string,
): Promise<Record<string, unknown>> {
  const editor = await openProductEdit(page, name)
  await editor.getByLabel('默认包装规格', { exact: true }).fill(specification)
  const persisted = await saveProductEditor(page, editor)
  await expect(await searchProduct(page, name)).toContainText('有候选版本')
  return persisted
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ clientWidth: 390, scrollWidth: 390 })
}

async function selectVoucherReference(
  page: Page,
  scope: Locator,
  label: string | RegExp,
  keyword: string,
): Promise<void> {
  const input = scope.getByRole('combobox', { name: label }).first()
  await input.click()
  await input.fill(keyword)
  const option = page.getByRole('option').filter({ hasText: keyword }).first()
  await expect(option).toBeVisible({ timeout: 15_000 })
  await option.click()
}

interface SavedProductSnapshot {
  documentNo: string
  productVersionId: string
  enteredQuantity: string
  enteredUnitVersionId: string
  baseQuantity: string
}

function productSnapshotFromDocument(
  document: Record<string, unknown>,
): SavedProductSnapshot {
  const data = document.data as {
    productLines: Array<{
      product: { approvalEntryId: string }
      enteredQuantity: string
      enteredUnit: { approvalEntryId: string }
      baseQuantity: string
    }>
  }
  const line = data.productLines[0]!
  return {
    documentNo: String(document.documentNo),
    productVersionId: line.product.approvalEntryId,
    enteredQuantity: line.enteredQuantity,
    enteredUnitVersionId: line.enteredUnit.approvalEntryId,
    baseQuantity: line.baseQuantity,
  }
}

async function createSaleOrderSnapshot(
  page: Page,
  customer: string,
  salesperson: string,
  warehouse: string,
  product: string,
): Promise<SavedProductSnapshot> {
  await page.goto('/vou/sale-order')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await selectVoucherReference(page, workspace, '客户', customer)
  await selectVoucherReference(page, workspace, /业务员/, salesperson)
  await selectVoucherReference(page, workspace, '仓库', warehouse)
  await selectVoucherReference(page, workspace, '产品', product)
  const line = workspace.locator('.voucher-lines__table tbody tr').first()
  await line.locator('td[data-label="录入数量"] input').fill('2')
  await line.locator('td[data-label="基础售价"] input').fill('12.50')
  const persisted = page.waitForResponse((response) =>
    response.url().endsWith('/vou/sale-order/get'),
  )
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  const envelope = (await (await persisted).json()) as {
    code: string | number
    message?: string
    data: Record<string, unknown>
  }
  expect(String(envelope.code), envelope.message).toBe('0')
  const snapshot = productSnapshotFromDocument(envelope.data)
  await workspace.getByLabel('关闭单据工作区').click()
  return snapshot
}

async function readSaleOrderSnapshot(
  page: Page,
  documentNo: string,
): Promise<SavedProductSnapshot> {
  await page.goto('/vou/sale-order')
  await page
    .getByRole('textbox', { name: '单号或往来方关键字' })
    .fill(documentNo)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = page.locator('tbody tr').filter({ hasText: documentNo })
  await expect(row).toHaveCount(1)
  const loaded = page.waitForResponse((response) =>
    response.url().endsWith('/vou/sale-order/get'),
  )
  await selectRowAction(page, row, `编辑 ${documentNo}`)
  const envelope = (await (await loaded).json()) as {
    code: string | number
    message?: string
    data: Record<string, unknown>
  }
  expect(String(envelope.code), envelope.message).toBe('0')
  return productSnapshotFromDocument(envelope.data)
}

async function verifyDclProductApproved(
  page: Page,
  name: string,
): Promise<void> {
  await page.goto('/dcl/product')
  await page.getByRole('textbox', { name: '产品变更关键字' }).fill(name)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = productRow(page, name)
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('已批准')
}

test('当前产品类型驱动三类产品、固定配方及候选换版', async ({
  page,
  workerState,
}, testInfo) => {
  test.setTimeout(240_000)
  const suffix = `${testInfo.project.name}-${testInfo.parallelIndex}-${Date.now()}`
  const rawType = `E2E 原料类型 ${suffix}`
  const packagingType = `E2E 包装类型 ${suffix}`
  const finishedType = `E2E 成品类型 ${suffix}`
  const rawProduct = `E2E 原料 ${suffix}`
  const replacementRawProduct = `E2E 替代原料 ${suffix}`
  const packagingProduct = `E2E 包装物 ${suffix}`
  const finishedProduct = `E2E 自制品 ${suffix}`

  await signIn(page, workerState.operator)
  await createProductType(page, rawType, '原材料')
  await createProductType(page, packagingType, '包装物')
  await createProductType(page, finishedType, '标准成品')

  await createProductDraft(page, {
    name: rawProduct,
    productType: rawType,
    units: [
      { name: '千克', factor: '1' },
      { name: '吨', factor: '1000' },
    ],
    defaultInput: '千克',
    pricing: '千克',
    defaultPackagingSpec: '25',
  })
  await createProductDraft(page, {
    name: replacementRawProduct,
    productType: rawType,
    units: [{ name: '千克', factor: '1' }],
    defaultInput: '千克',
    pricing: '千克',
    defaultPackagingSpec: '25',
  })
  await createProductDraft(page, {
    name: packagingProduct,
    productType: packagingType,
    units: [{ name: '件', factor: '1' }],
    defaultInput: '件',
    pricing: '件',
    returnable: true,
  })
  await submitProduct(page, rawProduct)
  await submitProduct(page, replacementRawProduct)
  await submitProduct(page, packagingProduct)

  await signOut(page)
  await signIn(page, workerState.reviewer)
  await approveProduct(page, rawProduct)
  await approveProduct(page, replacementRawProduct)
  await approveProduct(page, packagingProduct)

  await signOut(page)
  await signIn(page, workerState.operator)
  await verifyDclProductApproved(page, rawProduct)
  const editor = await openProductCreate(page)
  await editor.getByLabel('产品名称', { exact: true }).fill(finishedProduct)
  await selectReference(page, editor, '产品类型', finishedType)
  await addUnitConversion(page, editor, '千克', '1')
  await addUnitConversion(page, editor, '吨', '1000')
  await setDefaultUnits(page, editor, '千克', '千克')
  await editor.getByLabel('默认包装规格', { exact: true }).fill('20')
  await maintainFormula(page, editor, rawProduct)
  const created = page.waitForResponse((response) =>
    response.url().endsWith('/dcl/product/create'),
  )
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  const envelope = (await (await created).json()) as {
    code: string | number
    message?: string
  }
  expect(String(envelope.code), envelope.message).toBe('0')
  await expect(editor).not.toHaveClass(/v-navigation-drawer--active/)
  await submitProduct(page, finishedProduct)

  await signOut(page)
  await signIn(page, workerState.reviewer)
  await approveProduct(page, finishedProduct)

  await signOut(page)
  await signIn(page, workerState.operator)
  await createPackagingCandidate(page, rawProduct, '26')
  await submitProduct(page, rawProduct)

  await signOut(page)
  await signIn(page, workerState.reviewer)
  await approveProduct(page, rawProduct)

  await signOut(page)
  await signIn(page, workerState.operator)
  await createPackagingCandidate(page, finishedProduct, '30')

  const row = await searchProduct(page, finishedProduct)
  await expect(row).toContainText('有候选版本')
  const candidateEditor = await openProductEdit(page, finishedProduct)
  await expect(
    candidateEditor.getByText('默认包装规格：20', { exact: true }),
  ).toBeVisible()
  await expect(
    candidateEditor.getByLabel('默认包装规格', { exact: true }),
  ).toHaveValue('30')
  const effectiveCard = candidateEditor
    .locator('.v-card')
    .filter({ hasText: '当前交易使用' })
    .first()
  const effectiveConversion = effectiveCard.locator('tbody tr').first()
  await expect(effectiveConversion).toContainText('千克')
  await expect(effectiveConversion.locator('input').last()).toHaveValue('1')
  await effectiveCard
    .getByRole('button', { name: '查看当前已批准配方', exact: true })
    .click()
  const effectiveFormula = page
    .getByRole('dialog')
    .filter({ hasText: '固定配方' })
  await expect(effectiveFormula.locator('tbody tr').first()).toContainText(
    rawProduct,
  )
  await expect(
    effectiveFormula
      .locator('tbody tr')
      .first()
      .locator('td[data-label="确认的基准数量"] input'),
  ).toHaveValue('2')
  await effectiveFormula.getByRole('button', { name: '关闭' }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)
  await candidateEditor
    .getByRole('button', { name: '编辑固定配方', exact: true })
    .click()
  const refreshedFormula = page
    .getByRole('dialog')
    .filter({ hasText: '固定配方' })
  const refreshedLine = refreshedFormula.locator('tbody tr').first()
  await expect(refreshedLine.getByText('待确认', { exact: true })).toBeVisible()
  await expect(
    refreshedLine.locator('td[data-label="确认的基准数量"] input'),
  ).toHaveValue('2')
  await expectNoHorizontalOverflow(page)
  await refreshedLine
    .getByRole('button', { name: '确认刷新', exact: true })
    .click()
  await refreshedFormula
    .getByRole('button', { name: '保存配方', exact: true })
    .click()
  await saveProductEditor(page, candidateEditor)
  await page.setViewportSize({ width: 1280, height: 900 })
  await submitProduct(page, finishedProduct)

  await signOut(page)
  await signIn(page, workerState.reviewer)
  await approveProduct(page, finishedProduct)

  await signOut(page)
  await signIn(page, workerState.operator)
  const rawEditor = await openProductEdit(page, rawProduct)
  await selectReference(page, rawEditor, '产品类型', packagingType)
  const switchDialog = page.getByRole('dialog').filter({
    hasText: '切换产品行为模板？',
  })
  await expect(switchDialog).toContainText('确认后会清除：默认包装规格。')
  await switchDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(
    rawEditor.getByLabel('默认包装规格', { exact: true }),
  ).toHaveValue('26')
  await selectReference(page, rawEditor, '产品类型', packagingType)
  await switchDialog
    .getByRole('button', { name: '确认切换并清理', exact: true })
    .click()
  await expect(rawEditor.getByText('包装物', { exact: true })).toBeVisible()
  await expect(
    rawEditor.getByLabel('默认包装规格', { exact: true }),
  ).toHaveCount(0)
  await saveProductEditor(page, rawEditor)
  await submitProduct(page, rawProduct)

  await signOut(page)
  await signIn(page, workerState.reviewer)
  await approveProduct(page, rawProduct)

  await signOut(page)
  await signIn(page, workerState.operator)
  const effectivePackagingRaw = await openProductEdit(page, rawProduct)
  await expect(
    effectivePackagingRaw.getByText('包装物', { exact: true }),
  ).toBeVisible()
  await effectivePackagingRaw
    .getByRole('button', { name: '取消', exact: true })
    .click()
  const unresolvedCandidate = await createPackagingCandidate(
    page,
    finishedProduct,
    '31',
  )
  expect(
    (
      unresolvedCandidate.data as {
        formula?: { components?: Array<{ resolutionStatus?: string }> }
      }
    ).formula?.components?.[0]?.resolutionStatus,
  ).toBe('UNRESOLVED')
  let unresolvedEditor = await openProductEdit(page, finishedProduct)
  await unresolvedEditor
    .getByLabel('默认包装规格', { exact: true })
    .fill('31.5')
  await saveProductEditor(page, unresolvedEditor)
  unresolvedEditor = await openProductEdit(page, finishedProduct)
  await expect(
    unresolvedEditor.getByLabel('默认包装规格', { exact: true }),
  ).toHaveValue('31.5')
  await unresolvedEditor
    .getByRole('button', { name: '编辑固定配方', exact: true })
    .click()
  const unresolvedFormula = page
    .getByRole('dialog')
    .filter({ hasText: '固定配方' })
  const unresolvedLine = unresolvedFormula.locator('tbody tr').first()
  await expect(
    unresolvedLine.getByText('待修复', { exact: true }),
  ).toBeVisible()
  await unresolvedFormula
    .getByRole('button', { name: '保存配方', exact: true })
    .click()
  await expect(
    page.getByText('请修复并确认全部原材料行。', { exact: true }),
  ).toBeVisible()
  const materialInput = unresolvedLine.locator('.v-autocomplete input')
  const replacementSearched = page.waitForResponse(
    (response) =>
      response.url().endsWith('/bob/reference/query') &&
      (response.request().postData() ?? '').includes(replacementRawProduct),
  )
  await materialInput.click()
  await materialInput.fill(replacementRawProduct)
  expect((await replacementSearched).ok()).toBe(true)
  await page
    .getByRole('option')
    .filter({ hasText: replacementRawProduct })
    .first()
    .click()
  await unresolvedLine.locator('td[data-label="录入数量"] input').fill('2')
  await expect(
    unresolvedLine.locator('td[data-label="确认的基准数量"] input'),
  ).toHaveValue('2')
  await unresolvedFormula
    .getByRole('button', { name: '保存配方', exact: true })
    .click()
  await saveProductEditor(page, unresolvedEditor)
  await submitProduct(page, finishedProduct)

  await signOut(page)
  await signIn(page, workerState.reviewer)
  await approveProduct(page, finishedProduct)

  await signOut(page)
  await signIn(page, workerState.operator)
  const saleOrderSnapshot = await createSaleOrderSnapshot(
    page,
    workerState.fixtures.customer,
    workerState.fixtures.employee,
    workerState.fixtures.warehouse,
    finishedProduct,
  )
  expect(Number(saleOrderSnapshot.enteredQuantity)).toBe(2)
  expect(Number(saleOrderSnapshot.baseQuantity)).toBe(2)
  await createPackagingCandidate(page, finishedProduct, '32')
  const snapshotCandidateEditor = await openProductEdit(page, finishedProduct)
  await snapshotCandidateEditor
    .getByRole('button', { name: '编辑固定配方', exact: true })
    .click()
  const snapshotFormula = page
    .getByRole('dialog')
    .filter({ hasText: '固定配方' })
  await expect(
    snapshotFormula.getByText('已解析', { exact: true }),
  ).toBeVisible()
  await expect(
    snapshotFormula.getByRole('button', { name: '确认刷新', exact: true }),
  ).toHaveCount(0)
  await snapshotFormula
    .getByRole('button', { name: '保存配方', exact: true })
    .click()
  await saveProductEditor(page, snapshotCandidateEditor)
  await submitProduct(page, finishedProduct)

  await signOut(page)
  await signIn(page, workerState.reviewer)
  await approveProduct(page, finishedProduct)

  await signOut(page)
  await signIn(page, workerState.operator)
  expect(
    await readSaleOrderSnapshot(page, saleOrderSnapshot.documentNo),
  ).toEqual(saleOrderSnapshot)
})
