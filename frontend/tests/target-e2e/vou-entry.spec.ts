import { expect, test } from '@playwright/test'

const facts = JSON.parse(process.env.TARGET_E2E_VOU_ENTRY_JSON ?? '{}') as {
  serviceContract: string
  asset: string
  category: string
  department: string
  otherUnit: string
  bill: string
  maturedBill: string
  customer: string
  operatingEntity: string
  fundAccount: string
  employee: string
  subunit: string
  warehouse: string
  supplier: string
  product: string
  finished: string
  sources: Record<string, string>
}
const entities = [
  'sale-pricing',
  'service-contract',
  'service-acceptance',
  'sale-return',
  'purchase-inbound',
  'purchase-return',
  'purchase-inquiry',
  'order-production',
  'self-production',
  'inventory-count',
  'sales-receipt',
  'purchase-refund',
  'other-receipt',
  'sales-refund',
  'purchase-payment',
  'other-payment',
  'employee-loan',
  'employee-repayment',
  'employee-loan-writeoff',
  'expense-reimbursement',
  'other-income',
  'asset-acquisition',
  'asset-sale',
  'asset-liquidation',
  'bill-receipt',
  'bill-payment',
  'bill-issue',
  'bill-discount',
  'bill-maturity',
] as const
for (const width of [1280, 390])
  for (const entity of entities) {
    test(`${entity} menu candidates, input, persistence, readback and clone at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(90000)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto('/signin')
      await page
        .getByLabel('用户编码', { exact: true })
        .fill(process.env.TARGET_E2E_USERNAME!)
      await page
        .getByLabel('密码', { exact: true })
        .fill(process.env.TARGET_E2E_PASSWORD!)
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
      const drawer = page.locator('.v-navigation-drawer'),
        group = drawer.locator('.v-list-group').filter({ hasText: '业务单据' })
      if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
        await group.locator('.v-list-group__header').click()
      await drawer.locator(`a[href="/vou/${entity}"]`).click()
      await expect(page.getByTestId('vou-list-page')).toBeVisible()
      await page.getByRole('button', { name: '新建', exact: true }).click()
      const editor = page.getByTestId('document-editor')
      await expect(editor).toBeVisible()
      const choose = async (label: string, code: string) => {
        const field = editor.getByLabel(label, { exact: true })
        await expect(field).toBeEnabled()
        await field.fill(code)
        await page.getByRole('option').filter({ hasText: code }).first().click()
      }
      await editor.getByLabel('业务日期', { exact: true }).fill('2026-09-09')
      await editor
        .getByLabel('备注', { exact: true })
        .fill(`录入验证 ${entity} ${width}`)
      if (
        entity === 'asset-acquisition' ||
        entity === 'asset-sale' ||
        entity === 'asset-liquidation'
      ) {
        if (entity === 'asset-acquisition')
          await choose('供应商', facts.supplier)
        if (entity === 'asset-sale') await choose('相对方', facts.subunit)
        await editor
          .getByRole('button', { name: '添加资产行', exact: true })
          .click()
        if (entity === 'asset-acquisition') {
          await editor.getByLabel('资产名称', { exact: true }).fill('录入设备')
          await choose('资产类别', facts.category)
          await choose('使用部门', facts.department)
          await editor.getByLabel('原值', { exact: true }).fill('12345.67')
        } else {
          await choose('在用资产', facts.asset)
          if (entity === 'asset-sale')
            await editor.getByLabel('出让金额', { exact: true }).fill('12.34')
          else
            await editor
              .getByLabel('清理原因', { exact: true })
              .fill('设备报废')
        }
      } else if (
        entity === 'service-contract' ||
        entity === 'service-acceptance'
      ) {
        await choose('经办员工', facts.employee)
        if (entity === 'service-contract') {
          await choose('相对方', facts.otherUnit)
          await editor
            .getByLabel('合同条款', { exact: true })
            .fill('真实录入服务条款')
        } else {
          await choose('服务合同', facts.serviceContract)
          await editor
            .getByLabel('履约日期', { exact: true })
            .fill('2026-09-09')
          await editor
            .getByLabel('验收日期', { exact: true })
            .fill('2026-09-09')
          await editor.getByLabel('结算金额', { exact: true }).fill('12.34')
          await editor
            .getByLabel('履约事实', { exact: true })
            .fill('完成现场服务')
          await editor.getByLabel('验收事实', { exact: true }).fill('验收合格')
        }
      } else if (entity.startsWith('bill-')) {
        if (entity === 'bill-receipt') await choose('客户子单位', facts.subunit)
        if (entity === 'bill-issue' || entity === 'bill-payment')
          await choose('供应商', facts.supplier)
        if (entity === 'bill-receipt' || entity === 'bill-payment')
          await choose('经办人', facts.employee)
        if (entity === 'bill-discount')
          await choose('贴现相对方', facts.otherUnit)
        await editor
          .getByRole('button', { name: '添加票据行', exact: true })
          .click()
        if (entity === 'bill-receipt' || entity === 'bill-issue') {
          await editor
            .getByLabel('票据号码', { exact: true })
            .fill(`BROWSER-${entity}-${width}-${Date.now()}`)
          await editor.getByLabel('票面金额', { exact: true }).fill('10000.01')
          await editor
            .getByLabel('出票日期', { exact: true })
            .fill('2026-09-01')
          await editor
            .getByLabel('到期日期', { exact: true })
            .fill('2026-12-01')
          for (const label of ['出票人', '承兑人', '收款人'])
            await editor.getByLabel(label, { exact: true }).fill('录入测试单位')
        } else
          await choose(
            '可用票据',
            entity === 'bill-maturity' ? facts.maturedBill : facts.bill,
          )
        await editor
          .getByRole('button', { name: '添加现金行', exact: true })
          .click()
        await choose('现金资金账户', facts.fundAccount)
        await editor.getByLabel('现金金额', { exact: true }).fill('999.99')
      } else if (
        [
          'sales-receipt',
          'purchase-refund',
          'other-receipt',
          'sales-refund',
          'purchase-payment',
          'other-payment',
          'employee-loan',
          'employee-repayment',
          'employee-loan-writeoff',
          'expense-reimbursement',
          'other-income',
        ].includes(entity)
      ) {
        const expenses =
          entity === 'employee-loan-writeoff' ||
          entity === 'expense-reimbursement'
        if (entity.startsWith('employee-') || expenses)
          await choose('员工', facts.employee)
        else if (entity === 'sales-receipt') {
          await choose('客户', facts.customer)
          await choose('经营主体', facts.operatingEntity)
          await editor
            .getByRole('button', { name: '添加分摊行', exact: true })
            .click()
          await choose('客户子单位', facts.subunit)
          await editor.getByLabel('分摊金额', { exact: true }).fill('12.34')
        } else if (entity === 'sales-refund')
          await choose('客户子单位', facts.subunit)
        else if (entity.startsWith('purchase-'))
          await choose('供应商', facts.supplier)
        else if (entity === 'other-income')
          await editor
            .getByLabel('来源名称', { exact: true })
            .fill('其他业务收入')
        else if (entity === 'other-payment') {
          await editor
            .getByLabel('相对方类型', { exact: true })
            .press('ArrowDown')
          await page.getByRole('option', { name: '员工', exact: true }).click()
          await choose('相对方', facts.employee)
          await editor
            .getByLabel('其他类别', { exact: true })
            .press('ArrowDown')
          await page
            .getByRole('option', { name: '居间费', exact: true })
            .click()
        } else await choose('相对方', facts.subunit)
        if (expenses) {
          await editor
            .getByRole('button', { name: '添加费用行', exact: true })
            .click()
          await editor.getByLabel('费用类别', { exact: true }).fill('差旅')
          await editor.getByLabel('费用说明', { exact: true }).fill('现场服务')
          await editor.getByLabel('费用金额', { exact: true }).fill('12.34')
        } else {
          await choose('资金账户', facts.fundAccount)
          await choose('经办人', facts.employee)
          await editor.getByLabel('金额', { exact: true }).fill('12.34')
        }
      } else if (
        entity === 'order-production' ||
        entity === 'self-production'
      ) {
        await choose('材料仓库', facts.warehouse)
        await choose('成品仓库', facts.warehouse)
        await editor
          .getByRole('button', { name: '添加成品行', exact: true })
          .click()
        if (entity === 'order-production')
          await choose('来源行', facts.sources[entity]!)
        else await choose('成品', facts.finished)
        await expect(
          editor.getByLabel('实际基准领料量', { exact: true }),
        ).toHaveValue('1.000000')
      } else {
        if (
          entity !== 'sale-return' &&
          entity !== 'inventory-count' &&
          entity !== 'sale-pricing'
        )
          await choose('供应商', facts.supplier)
        if (entity !== 'purchase-inquiry' && entity !== 'sale-pricing')
          await choose('仓库', facts.warehouse)
        if (
          entity === 'purchase-inquiry' ||
          entity === 'inventory-count' ||
          entity === 'sale-pricing'
        ) {
          await editor
            .getByRole('button', { name: '添加商品行', exact: true })
            .click()
          await choose('产品', facts.product)
          if (entity !== 'inventory-count')
            await editor.getByLabel('单价', { exact: true }).fill('12.34')
          else {
            await editor.getByLabel('实盘数量', { exact: true }).fill('0')
            await editor.getByLabel('基准数量', { exact: true }).fill('0')
          }
        } else {
          await editor
            .getByRole('button', { name: '添加来源行', exact: true })
            .click()
          await choose('来源行', facts.sources[entity]!)
          await editor.getByLabel('基准数量', { exact: true }).fill('0.123456')
          if (entity !== 'purchase-inbound')
            await editor
              .getByLabel('退货原因', { exact: true })
              .fill('验收退货')
        }
      }
      await page.setViewportSize({ width, height: 900 })
      expect(
        await editor.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(false)
      const submitted = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/vou/${entity}/submit-new`,
      )
      await editor.getByRole('button', { name: '提交', exact: true }).click()
      const envelope = await (await submitted).json()
      expect(envelope.code, JSON.stringify(envelope)).toBe(0)
      await expect(editor).toHaveCount(0)
      const id = envelope.data.documentId
      const get = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/vou/${entity}/get`,
      )
      await page
        .getByTestId(`vou-row-${id}`)
        .getByRole('button', { name: '打开', exact: true })
        .click()
      const persisted = await (await get).json()
      expect(persisted.code, JSON.stringify(persisted)).toBe(0)
      expect(persisted.data.payload).toEqual(envelope.data.payload)
      const detail = page.getByTestId('vou-detail')
      await expect(detail).toContainText(`录入验证 ${entity} ${width}`)
      await detail
        .getByRole('button', { name: '复制到临时表单', exact: true })
        .click()
      await expect(editor).toBeVisible()
      await editor
        .getByLabel('备注', { exact: true })
        .fill(`复制验证 ${entity} ${width}`)
      const cloned = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/vou/${entity}/submit-new`,
      )
      await expect(
        editor.getByRole('button', { name: '提交', exact: true }),
      ).toBeEnabled()
      await editor.getByRole('button', { name: '提交', exact: true }).click()
      const clone = await (await cloned).json()
      expect(clone.code, JSON.stringify(clone)).toBe(0)
      expect(clone.data.documentId).not.toBe(id)
      expect(clone.data.submissionId).not.toBe(envelope.data.submissionId)
      await expect(editor).toHaveCount(0)
    })
  }

for (const [width, month, cloneMonth] of [
  [1280, '2026-10-31', '2026-11-30'],
  [390, '2026-12-31', '2027-01-31'],
] as const)
  test(`intermediary-calculation script maintenance, calculation, persistence and clone at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000)
    await page.goto('/signin')
    await page
      .getByLabel('用户编码', { exact: true })
      .fill(process.env.TARGET_E2E_USERNAME!)
    await page
      .getByLabel('密码', { exact: true })
      .fill(process.env.TARGET_E2E_PASSWORD!)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
    const drawer = page.locator('.v-navigation-drawer')
    const group = drawer
      .locator('.v-list-group')
      .filter({ hasText: '业务单据' })
    if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
      await group.locator('.v-list-group__header').click()
    await drawer.locator('a[href="/vou/intermediary-calculation"]').click()
    await expect(page.getByTestId('vou-list-page')).toBeVisible()
    await page
      .getByLabel('期间起', { exact: true })
      .fill(`${month.slice(0, 7)}-01`)
    await page.getByLabel('期间止', { exact: true }).fill(cloneMonth)
    await page.getByTestId('list-search').click()
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const editor = page.getByTestId('document-editor')
    await editor.getByLabel('计算月末日期', { exact: true }).fill(month)
    await editor
      .getByLabel('脚本名称', { exact: true })
      .fill(`月度计算 ${width}`)
    await editor
      .getByLabel('计算脚本', { exact: true })
      .fill('globalThis.calculate = () => ({lines:[], summaries:[]})')
    await editor
      .getByRole('button', { name: '试运行脚本', exact: true })
      .click()
    await expect(editor).toContainText('当前脚本试运行成功')
    const save = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        '/vou/intermediary-calculation/script-save',
    )
    await editor
      .getByRole('button', { name: '保存计算脚本', exact: true })
      .click()
    expect((await (await save).json()).code).toBe(0)
    await editor.getByRole('button', { name: '重新计算', exact: true }).click()
    await expect(editor).toContainText(`采用脚本：月度计算 ${width}`)
    await page.setViewportSize({ width, height: 900 })
    expect(
      await editor.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(false)
    const submit = async () => {
      const response = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
          '/vou/intermediary-calculation/submit-new',
      )
      await editor.getByRole('button', { name: '提交', exact: true }).click()
      const envelope = await (await response).json()
      expect(envelope.code, JSON.stringify(envelope)).toBe(0)
      await expect(editor).toHaveCount(0)
      return envelope.data
    }
    const first = await submit()
    const get = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        '/vou/intermediary-calculation/get',
    )
    await page
      .getByTestId(`vou-row-${first.documentId}`)
      .getByRole('button', { name: '打开', exact: true })
      .click()
    expect((await (await get).json()).data.payload).toEqual(first.payload)
    await page
      .getByTestId('vou-detail')
      .getByRole('button', { name: '复制到临时表单', exact: true })
      .click()
    await editor.getByLabel('计算月末日期', { exact: true }).fill(cloneMonth)
    await editor.getByRole('button', { name: '重新计算', exact: true }).click()
    await expect(editor).toContainText(`采用脚本：月度计算 ${width}`)
    const cloned = await submit()
    expect(cloned.documentId).not.toBe(first.documentId)
    expect(cloned.payload.businessDate).toBe(cloneMonth)
  })
