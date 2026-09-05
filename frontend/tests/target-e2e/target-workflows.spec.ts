import { randomBytes } from 'node:crypto'

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'
import {
  modelBuildId,
  systemGeneratedVouEntities,
  vouEntityInputDescriptors,
  vouEntityPresentation,
  userCreatableVouEntities,
  type VouEntity,
} from '@zerp/model'
import pg from 'pg'

const effectPool = new pg.Pool({
  connectionString: process.env.TARGET_DATABASE_URL,
})
test.afterAll(async () => effectPool.end())

function postsJournal(entity: VouEntity) {
  return vouEntityInputDescriptors[entity].some(
    (field) =>
      field.kind === 'decimal' ||
      field.kind === 'integer' ||
      (field.kind === 'array' &&
        field.required &&
        field.key !== 'attachments' &&
        field.item?.some(
          (item) => item.kind === 'decimal' || item.kind === 'integer',
        )),
  )
}

async function vouEffectCounts(approvalEntryId: string) {
  const result = await effectPool.query<{
    journals: string
    journal_lines: string
    registers: string
    containers: string
  }>(
    `
    SELECT
      (SELECT count(*) FROM acc_journal_entries WHERE vou_approval_entry_id = $1)::text AS journals,
      (SELECT count(*) FROM acc_journal_lines line JOIN acc_journal_entries journal ON journal.id = line.journal_entry_id WHERE journal.vou_approval_entry_id = $1)::text AS journal_lines,
      (
        (SELECT count(*) FROM acc_register_entries WHERE vou_approval_entry_id = $1) +
        (SELECT count(*) FROM acc_asset_registers WHERE state_vou_approval_entry_id = $1) +
        (SELECT count(*) FROM acc_bill_registers WHERE state_vou_approval_entry_id = $1)
      )::text AS registers,
      (SELECT count(*) FROM acc_container_entries WHERE vou_approval_entry_id = $1)::text AS containers
  `,
    [approvalEntryId],
  )
  const row = result.rows[0]!
  return {
    journals: Number(row.journals),
    journalLines: Number(row.journal_lines),
    registers: Number(row.registers),
    containers: Number(row.containers),
  }
}

function targetId() {
  return randomBytes(13).toString('hex').toUpperCase()
}

const unifiedSocialCreditCodeAlphabet = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const unifiedSocialCreditCodeWeights = [
  1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28,
]

function customerLegalIdentifier(runId: string) {
  const body = runId.slice(0, 17)
  if (!/^[0-9A-HJ-NPQRTUWXY]{17}$/.test(body))
    throw new Error(`无效的测试运行标识: ${runId}`)
  const sum = body
    .split('')
    .reduce(
      (total, digit, index) =>
        total +
        unifiedSocialCreditCodeAlphabet.indexOf(digit) *
          unifiedSocialCreditCodeWeights[index]!,
      0,
    )
  return `${body}${unifiedSocialCreditCodeAlphabet[(31 - (sum % 31)) % 31]}`
}

type ArchiveEntity =
  | 'operating-entity'
  | 'vehicle'
  | 'fund-account'
  | 'product'
  | 'employee'
  | 'supplier'
  | 'customer'
  | 'other-unit'
  | 'sales-partner'
  | 'acc-mapping'
  | 'rpt-definition'

interface ArchiveSubmissionResponse {
  subjectId: string
  submissionId: string
  code: string | null
}

interface AuxiliaryFact {
  id: string
  entity: string
  code: string
  data: Record<string, unknown>
}

interface AccountingFacts {
  book: { id: string; code: string; name: string }
  vouEntity: { id: string; code: string; name: string }
}

interface AccUiFacts {
  book: { id: string; code: string; name: string; startMonth: string }
  subjects: Array<{
    id: string
    code: string
    name: string
    balanceDirection: string
    requiredDimensions: string[]
  }>
}

interface VouReferenceFact {
  entity: string
  objectId: string
  approvalEntryId: string
  code: string
  name: string
}

interface VouAccObjectFact {
  entity: 'asset' | 'bill'
  objectId: string
}

interface VouSourceFact {
  documentId: string
  submissionId: string
  lineId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, description: string): string {
  if (typeof value !== 'string' || !value)
    throw new Error(`缺少 ${description}`)
  return value
}

function readAuxiliaryFacts(): AuxiliaryFact[] {
  const source = process.env.TARGET_E2E_AUX_FACTS_JSON
  if (!source) throw new Error('缺少 TARGET_E2E_AUX_FACTS_JSON')
  const parsed: unknown = JSON.parse(source)
  if (!Array.isArray(parsed))
    throw new Error('TARGET_E2E_AUX_FACTS_JSON 不是数组')
  return parsed.map((item, index) => {
    if (!isRecord(item) || !isRecord(item.data))
      throw new Error(`TARGET_E2E_AUX_FACTS_JSON 第 ${index + 1} 项无效`)
    return {
      id: requiredString(item.id, '辅助事实标识'),
      entity: requiredString(item.entity, '辅助事实实体'),
      code: requiredString(item.code, '辅助事实编码'),
      data: item.data,
    }
  })
}

function readAccountingFacts(): AccountingFacts {
  const source = process.env.TARGET_E2E_ACC_FACTS_JSON
  if (!source) throw new Error('缺少 TARGET_E2E_ACC_FACTS_JSON')
  const parsed: unknown = JSON.parse(source)
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.book) ||
    !isRecord(parsed.vouEntity)
  )
    throw new Error('TARGET_E2E_ACC_FACTS_JSON 无效')
  return {
    book: {
      id: requiredString(parsed.book.id, '账簿标识'),
      code: requiredString(parsed.book.code, '账簿编码'),
      name: requiredString(parsed.book.name, '账簿名称'),
    },
    vouEntity: {
      id: requiredString(parsed.vouEntity.id, '凭证类型标识'),
      code: requiredString(parsed.vouEntity.code, '凭证类型编码'),
      name: requiredString(parsed.vouEntity.name, '凭证类型名称'),
    },
  }
}

function readAccUiFacts(): AccUiFacts {
  const source = process.env.TARGET_E2E_ACC_UI_FACTS_JSON
  if (!source) throw new Error('缺少 TARGET_E2E_ACC_UI_FACTS_JSON')
  const parsed: unknown = JSON.parse(source)
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.book) ||
    !Array.isArray(parsed.subjects)
  )
    throw new Error('TARGET_E2E_ACC_UI_FACTS_JSON 无效')
  return {
    book: {
      id: requiredString(parsed.book.id, 'ACC UI 账簿标识'),
      code: requiredString(parsed.book.code, 'ACC UI 账簿编码'),
      name: requiredString(parsed.book.name, 'ACC UI 账簿名称'),
      startMonth: requiredString(parsed.book.startMonth, 'ACC UI 开始期间'),
    },
    subjects: parsed.subjects.map((item) => {
      if (!isRecord(item)) throw new Error('ACC UI 科目无效')
      return {
        id: requiredString(item.id, 'ACC UI 科目标识'),
        code: requiredString(item.code, 'ACC UI 科目编码'),
        name: requiredString(item.name, 'ACC UI 科目名称'),
        balanceDirection: requiredString(
          item.balanceDirection,
          'ACC UI 科目方向',
        ),
        requiredDimensions: Array.isArray(item.requiredDimensions)
          ? item.requiredDimensions.map((value) =>
              requiredString(value, 'ACC UI 科目维度'),
            )
          : [],
      }
    }),
  }
}

function readVouReferenceFacts(): Record<string, VouReferenceFact> {
  const source = process.env.TARGET_E2E_VOU_REFERENCE_FACTS_JSON
  if (!source) throw new Error('缺少 TARGET_E2E_VOU_REFERENCE_FACTS_JSON')
  const parsed: unknown = JSON.parse(source)
  if (!isRecord(parsed))
    throw new Error('TARGET_E2E_VOU_REFERENCE_FACTS_JSON 无效')
  const entries = Object.entries(parsed).map(([key, value]) => {
    if (!isRecord(value)) throw new Error(`VOU 引用 ${key} 无效`)
    return [
      key,
      {
        entity: requiredString(value.entity, `${key} 实体`),
        objectId: requiredString(value.objectId, `${key} 标识`),
        approvalEntryId: requiredString(
          value.approvalEntryId,
          `${key} 审批标识`,
        ),
        code: requiredString(value.code, `${key} 编码`),
        name: requiredString(value.name, `${key} 名称`),
      },
    ] as const
  })
  return Object.fromEntries(entries) as Record<string, VouReferenceFact>
}

function readVouAccObjectFacts(): Record<'asset' | 'bill', VouAccObjectFact> {
  const source = process.env.TARGET_E2E_VOU_ACC_OBJECT_FACTS_JSON
  if (!source) throw new Error('缺少 TARGET_E2E_VOU_ACC_OBJECT_FACTS_JSON')
  const parsed: unknown = JSON.parse(source)
  if (!isRecord(parsed))
    throw new Error('TARGET_E2E_VOU_ACC_OBJECT_FACTS_JSON 无效')
  const asset = parsed.asset
  const bill = parsed.bill
  if (!isRecord(asset) || !isRecord(bill))
    throw new Error('VOU ACC 对象事实无效')
  return {
    asset: {
      entity: 'asset',
      objectId: requiredString(asset.objectId, '资产标识'),
    },
    bill: {
      entity: 'bill',
      objectId: requiredString(bill.objectId, '票据标识'),
    },
  }
}

function readVouSourceFacts(): Record<
  'saleOrder' | 'purchaseOrder',
  VouSourceFact
> {
  const source = process.env.TARGET_E2E_VOU_SOURCE_FACTS_JSON
  if (!source) throw new Error('缺少 TARGET_E2E_VOU_SOURCE_FACTS_JSON')
  const parsed: unknown = JSON.parse(source)
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.saleOrder) ||
    !isRecord(parsed.purchaseOrder)
  )
    throw new Error('TARGET_E2E_VOU_SOURCE_FACTS_JSON 无效')
  const fact = (value: Record<string, unknown>, label: string) => ({
    documentId: requiredString(value.documentId, `${label}单据标识`),
    submissionId: requiredString(value.submissionId, `${label}Submission 标识`),
    lineId: requiredString(value.lineId, `${label}行标识`),
  })
  return {
    saleOrder: fact(parsed.saleOrder, '销售订单'),
    purchaseOrder: fact(parsed.purchaseOrder, '采购订单'),
  }
}

function auxiliaryReference(facts: readonly AuxiliaryFact[], entity: string) {
  const fact = facts.find((candidate) => candidate.entity === entity)
  if (!fact) throw new Error(`缺少 ${entity} 辅助事实`)
  return {
    id: fact.id,
    code: fact.code,
    name: requiredString(fact.data.name, `${entity} 名称`),
    ...fact.data,
  }
}

function archiveRegion(page: Page) {
  const entity = new URL(page.url()).pathname.split('/').at(-1)
  return page.getByTestId(
    entity === 'warehouse' ? 'warehouse-page' : `dcl-${entity}-page`,
  )
}

function archiveSubmissionRow(region: Locator, submissionId: string) {
  return region.getByRole('row').filter({
    has: region
      .page()
      .locator(`[data-archive-submission-id="${submissionId}"]`),
  })
}

async function revealArchiveSubmission(
  page: Page,
  entity: ArchiveEntity | 'warehouse',
  submissionId: string,
) {
  const region = archiveRegion(page)
  const row = archiveSubmissionRow(region, submissionId)
  await expect(region.locator('.v-data-table-rows-loading')).toHaveCount(0)
  for (let index = 0; index < 100; index += 1) {
    if (await row.count()) return
    const next = region.getByRole('button', { name: '下一页', exact: true })
    if ((await next.count()) !== 1 || !(await next.isEnabled())) break
    const response = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/dcl/${entity}/query`,
    )
    await next.click()
    expect((await (await response).json()).code).toBe(0)
    await expect(region.locator('.v-data-table-rows-loading')).toHaveCount(0)
  }
  await expect(
    row,
    `Expected submission ${submissionId} across ${entity} pages`,
  ).toBeVisible()
}

async function selectArchiveEntity(
  page: Page,
  entity: ArchiveEntity | 'warehouse',
) {
  if (new URL(page.url()).pathname !== `/dcl/${entity}`) {
    await page.goto(`/dcl/${entity}`)
  }
  await expect(page).toHaveURL(new RegExp(`/dcl/${entity}$`))
  await queryArchiveEntity(page, entity)
  return archiveRegion(page)
}

async function queryArchiveEntity(
  page: Page,
  entity: ArchiveEntity | 'warehouse',
) {
  if (entity === 'acc-mapping' || entity === 'rpt-definition') {
    // These pages query automatically after async draft-store operations.
    // Close the previous document before observing the fresh mount, so its
    // delayed query cannot be captured and then canceled by navigation.
    await page.goto('about:blank')
    const queryResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/dcl/${entity}/query`,
      { timeout: 5_000 },
    )
    await page.goto(`/dcl/${entity}`)
    const response = await queryResponse
    expect(response.ok()).toBe(true)
    expect((await response.json()).code).toBe(0)
    await expect(
      archiveRegion(page).locator('.v-data-table-rows-loading'),
    ).toHaveCount(0)
    return
  }
  const queryButton = archiveRegion(page).getByRole('button', {
    name: '查询',
    exact: true,
  })
  await expect(queryButton).toBeVisible()
  await expect(queryButton).toBeEnabled()
  const queryResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/dcl/${entity}/query`,
    { timeout: 5_000 },
  )
  await queryButton.click()
  const response = await queryResponse
  expect(response.ok()).toBe(true)
  expect((await response.json()).code).toBe(0)
}

async function openArchiveDraft(draft: Locator) {
  const title = draft.locator('.v-expansion-panel-title')
  if (await title.count()) await title.click()
  else await draft.click()
}

async function expectArchiveStatus(
  submission: Locator,
  status: 'PENDING' | 'APPROVED' | 'REJECTED',
) {
  await expect(
    submission.locator('[data-archive-status]').first(),
  ).toHaveAttribute('data-archive-status', status)
  await expect(submission).toContainText(
    {
      PENDING: /待批准|PENDING/,
      APPROVED: /已批准|APPROVED/,
      REJECTED: /已驳回|REJECTED/,
    }[status],
  )
}

async function clickForTargetResponse(
  page: Page,
  pathname: string,
  control: Locator,
) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === pathname,
  )
  await control.click()
  const response = await responsePromise
  const body = await response.json()
  expect(
    body.code,
    `${pathname}: ${JSON.stringify(body)} request=${response.request().postData()}`,
  ).toBe(0)
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
    .getByRole('option')
    .filter({ hasText: optionText })
    .click()
}

function archiveLabel(entity: ArchiveEntity) {
  return {
    'operating-entity': '经营主体',
    vehicle: '车辆',
    'fund-account': '资金账户',
    product: '产品',
    employee: '员工',
    supplier: '供应商',
    customer: '客户',
    'other-unit': '其他单位',
    'sales-partner': '销售合作方',
    'acc-mapping': '记账映射',
    'rpt-definition': '报表定义',
  }[entity]
}

async function fillArchiveField(draft: Locator, label: string, value: string) {
  const control = draft.getByLabel(label)
  await control.fill(value)
  await control.blur()
}

async function fillArchiveStructure(
  draft: Locator,
  label: string,
  value: unknown,
) {
  if (!isRecord(value)) throw new Error(`${label} 不是资料引用`)
  const group = draft.getByRole('group', { name: label })
  if (label === '承运方设置') {
    await group
      .getByLabel('类型')
      .selectOption(requiredString(value.kind, '承运类型'))
    await group
      .getByRole('group', { name: '承运方引用' })
      .getByLabel('选择资料')
      .selectOption(
        requiredString(
          value.operatingEntityId ?? value.otherUnitId,
          '承运候选',
        ),
      )
    return
  }
  const candidateId = requiredString(value.objectId ?? value.id, '候选资料')
  const control = group.getByLabel('选择资料')
  await expect
    .poll(
      () =>
        control.locator('option').evaluateAll((options) =>
          options.map((option) => ({
            value: (option as HTMLOptionElement).value,
            label: option.textContent?.trim() ?? '',
          })),
        ),
      {
        message: `${label} 候选列表缺少夹具资料 ${candidateId}`,
        timeout: 15_000,
      },
    )
    .toContainEqual(expect.objectContaining({ value: candidateId }))
  await control.selectOption(candidateId)
}

async function submitArchiveDraft(
  page: Page,
  entity: ArchiveEntity | 'warehouse',
  draft: Locator,
  mode: 'new' | 'change' = 'new',
): Promise<ArchiveSubmissionResponse> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/dcl/${entity}/submit-${mode}`,
    { timeout: 15_000 },
  )
  await draft
    .getByRole('button', { name: /^提交(?:候选|完整客户版本)?$/ })
    .click()
  const response = await responsePromise.catch(async (cause) => {
    throw new Error(
      `${entity} submit produced no response; page: ${await archiveRegion(page).innerText()}`,
      { cause },
    )
  })
  expect(response.ok()).toBe(true)
  const payload: unknown = await response.json()
  if (!isRecord(payload)) throw new Error(`${entity} submit 响应无效`)
  expect(
    payload.code,
    `${entity}: ${JSON.stringify({ response: payload, request: response.request().postDataJSON() })}`,
  ).toBe(0)
  if (!isRecord(payload.data)) throw new Error(`${entity} submit data 无效`)
  const submission = {
    subjectId: requiredString(payload.data.subjectId, `${entity} subjectId`),
    submissionId: requiredString(
      payload.data.submissionId,
      `${entity} submissionId`,
    ),
    code:
      payload.data.code === null
        ? null
        : requiredString(payload.data.code, `${entity} code`),
  }
  await expect(draft).toHaveCount(0)
  await queryArchiveEntity(page, entity)
  await revealArchiveSubmission(page, entity, submission.submissionId)
  await expectArchiveStatus(
    archiveSubmissionRow(archiveRegion(page), submission.submissionId),
    'PENDING',
  )
  return submission
}

async function approveArchiveSubmission(
  page: Page,
  entity: ArchiveEntity,
  submissionId: string,
) {
  const region = await selectArchiveEntity(page, entity)
  await revealArchiveSubmission(page, entity, submissionId)
  const submission = archiveSubmissionRow(region, submissionId)
  await expect(submission).toBeVisible()
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/dcl/${entity}/approve`,
  )
  await submission.getByRole('button', { name: '批准', exact: true }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  expect((await response.json()).code).toBe(0)
  await expectArchiveStatus(submission, 'APPROVED')
}

async function createAndSubmitArchive(
  page: Page,
  entity: ArchiveEntity,
  configure: (draft: Locator) => Promise<void>,
) {
  const region = await selectArchiveEntity(page, entity)
  const newDraft = region.getByRole('button', {
    name: /^新建(?:本地|客户)草稿$/,
  })
  await expect(newDraft).toBeEnabled()
  await newDraft.click()
  const draft = region
    .locator('[data-archive-draft-id]')
    .last()
    .locator(
      'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " v-expansion-panel ")][1]',
    )
  await expect(draft).toBeVisible()
  await openArchiveDraft(draft)
  await configure(draft)
  return submitArchiveDraft(page, entity, draft)
}

async function exerciseArchiveLifecycle(
  submitterPage: Page,
  reviewerPage: Page,
  entity: ArchiveEntity,
  initial: ArchiveSubmissionResponse,
) {
  return test.step(`${archiveLabel(entity)}完整生命周期`, async () => {
    await test.step('V1 驳回、恢复审核并批准', async () => {
      const reviewerRegion = await selectArchiveEntity(reviewerPage, entity)
      await revealArchiveSubmission(reviewerPage, entity, initial.submissionId)
      const reviewerV1 = archiveSubmissionRow(
        reviewerRegion,
        initial.submissionId,
      )
      await reviewerRegion
        .getByLabel('驳回或反批准原因')
        .fill(`${archiveLabel(entity)}驳回验证`)
      await reviewerV1
        .getByRole('button', { name: '驳回', exact: true })
        .click()
      await expectArchiveStatus(reviewerV1, 'REJECTED')
      await reviewerV1
        .getByRole('button', { name: '恢复审核', exact: true })
        .click()
      await expectArchiveStatus(reviewerV1, 'PENDING')
      await reviewerV1
        .getByRole('button', { name: '批准', exact: true })
        .click()
      await expectArchiveStatus(reviewerV1, 'APPROVED')
    })

    let change!: ArchiveSubmissionResponse
    await test.step('克隆并提交 V2', async () => {
      const submitterRegion = await selectArchiveEntity(submitterPage, entity)
      await revealArchiveSubmission(submitterPage, entity, initial.submissionId)
      await archiveSubmissionRow(submitterRegion, initial.submissionId)
        .getByRole('button', {
          name:
            entity === 'rpt-definition' || entity === 'acc-mapping'
              ? '创建变更'
              : '克隆草稿',
          exact: true,
        })
        .click()
      const changeDraft = submitterRegion
        .locator('[data-archive-draft-id]')
        .last()
        .locator(
          'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " v-expansion-panel ")][1]',
        )
      await openArchiveDraft(changeDraft)
      change = await submitArchiveDraft(
        submitterPage,
        entity,
        changeDraft,
        'change',
      )
      await expectArchiveStatus(
        archiveSubmissionRow(submitterRegion, change.submissionId),
        'PENDING',
      )
    })

    await test.step('批准并反批准 V2 回落', async () => {
      await selectArchiveEntity(reviewerPage, entity)
      await revealArchiveSubmission(reviewerPage, entity, change.submissionId)
      const reviewerV2 = archiveSubmissionRow(
        archiveRegion(reviewerPage),
        change.submissionId,
      )
      await reviewerV2
        .getByRole('button', { name: '批准', exact: true })
        .click()
      await expectArchiveStatus(reviewerV2, 'APPROVED')
      await archiveRegion(reviewerPage)
        .getByLabel('驳回或反批准原因')
        .fill(`${archiveLabel(entity)}回落验证`)
      await reviewerV2
        .getByRole('button', { name: '反批准', exact: true })
        .click()
      await expectArchiveStatus(reviewerV2, 'PENDING')
    })

    await test.step('提交人删除回落后的开放 V2', async () => {
      await selectArchiveEntity(submitterPage, entity)
      await revealArchiveSubmission(submitterPage, entity, change.submissionId)
      const submitterV2 = archiveSubmissionRow(
        archiveRegion(submitterPage),
        change.submissionId,
      )
      await submitterV2
        .getByRole('button', {
          name:
            entity === 'rpt-definition' || entity === 'acc-mapping'
              ? '删除候选'
              : '撤回',
          exact: true,
        })
        .click()
      await expect(submitterV2).toHaveCount(0)
      await expect(
        archiveSubmissionRow(
          archiveRegion(submitterPage),
          initial.submissionId,
        ),
      ).toContainText('已批准')
    })
  })
}

async function signIn(
  page: Page,
  username: string,
  password: string,
  path = '/',
) {
  await page.goto(path)
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByLabel('用户名')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
}

test('APP workbench renders only server-returned actions and refreshes after a review', async ({
  browser,
}) => {
  const submitterContext = await browser.newContext()
  const reviewerContext = await browser.newContext()
  try {
    const submitterPage = await submitterContext.newPage()
    await signIn(
      submitterPage,
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
      '/dcl/operating-entity',
    )
    const submitterRegion = archiveRegion(submitterPage)
    await submitterRegion.getByRole('button', { name: '新建本地草稿' }).click()
    const draft = submitterRegion.locator('[data-archive-draft-id]').last()
    await draft.locator('.v-expansion-panel-title').click()
    await draft.getByLabel('统一社会信用代码').fill(targetId().slice(0, 18))
    await clickForTargetResponse(
      submitterPage,
      '/dcl/operating-entity/submit-new',
      submitterRegion.getByRole('button', { name: '提交', exact: true }),
    )
    const pending = submitterRegion
      .getByRole('row')
      .filter({ hasText: '待批准' })
      .last()
    const submissionId = requiredString(
      await pending
        .locator('[data-archive-submission-id]')
        .getAttribute('data-archive-submission-id'),
      '工作台提交件标识',
    )

    const reviewerPage = await reviewerContext.newPage()
    const workbenchQueries: unknown[] = []
    reviewerPage.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/app/workbench/query'
      )
        workbenchQueries.push(request.postDataJSON())
    })
    await signIn(
      reviewerPage,
      process.env.TARGET_E2E_REVIEWER_USERNAME!,
      process.env.TARGET_E2E_REVIEWER_PASSWORD!,
      '/home/dashboard',
    )
    const workbench = reviewerPage.getByRole('main')
    await expect(
      workbench.getByRole('tab', { name: '待办单据', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(workbenchQueries).toEqual([
      { page: 1, pageSize: 20, filters: { kind: 'DOCUMENT' } },
    ])
    await clickForTargetResponse(
      reviewerPage,
      '/app/workbench/query',
      workbench.getByRole('tab', { name: '待办资料', exact: true }),
    )
    expect(workbenchQueries).toContainEqual({
      page: 1,
      pageSize: 20,
      filters: { kind: 'ARCHIVE' },
    })
    const item = workbench.locator(
      `[data-workbench-submission-id="${submissionId}"]`,
    )
    await expect(item).toBeVisible()
    const detailResponse = reviewerPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/dcl/operating-entity/get',
    )
    await item.getByRole('button', { name: '查看', exact: true }).click()
    await detailResponse
    await expect(reviewerPage).toHaveURL(
      new RegExp(
        `/dcl/operating-entity\\?mode=view&objectId=.+&code=.+&submissionId=${submissionId}&revision=\\d+$`,
      ),
    )
    await expect(
      reviewerPage.getByText('经营主体详情与历史', { exact: true }),
    ).toBeVisible()
    await reviewerPage.goto('/home/dashboard')
    const archiveTab = reviewerPage.getByRole('tab', {
      name: '待办资料',
      exact: true,
    })
    await archiveTab.click()
    const refreshedItem = reviewerPage.locator(
      `[data-workbench-submission-id="${submissionId}"]`,
    )
    await expect(
      refreshedItem.getByRole('button', { name: '批准', exact: true }),
    ).toBeVisible()
    await clickForTargetResponse(
      reviewerPage,
      '/dcl/operating-entity/approve',
      refreshedItem.getByRole('button', { name: '批准', exact: true }),
    )
    await expect(refreshedItem).toHaveCount(0)
  } finally {
    await Promise.allSettled([
      submitterContext.close(),
      reviewerContext.close(),
    ])
  }
})

test('each DCL archive has a directly addressable target page', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
    '/dcl/vehicle',
  )
  await expect(page).toHaveURL(/\/dcl\/vehicle$/)
  await expect(archiveRegion(page)).toContainText('车辆申报')
  await expect(archiveRegion(page)).toContainText('当前设备的本地草稿')
  await queryArchiveEntity(page, 'vehicle')
})

test('per-run customer enterprise legal identifiers use the accepted checksum', () => {
  expect(customerLegalIdentifier('91350211M000100Y4')).toBe(
    '91350211M000100Y46',
  )
  const identifiers = [
    customerLegalIdentifier('00000000000000001'),
    customerLegalIdentifier('00000000000000002'),
  ]
  expect(new Set(identifiers).size).toBe(identifiers.length)
  expect(identifiers.every((identifier) => identifier.length === 18)).toBe(true)
})

function vouRegion(page: Page) {
  return page.getByTestId('vou-workspace')
}

function vouSubmissionRow(region: Locator, documentId: string) {
  return region.getByRole('row').filter({
    has: region
      .page()
      .locator(
        `[data-testid="vou-submission"][data-vou-document-id="${documentId}"]`,
      ),
  })
}

function pendingVouSubmissionRow(region: Locator) {
  return region.getByRole('row').filter({ hasText: '待批准' }).first()
}

async function fillCompleteVouDraft(
  draft: Locator,
  entity: VouEntity,
  _facts: Record<string, VouReferenceFact>,
  _accObjectFacts: Record<'asset' | 'bill', VouAccObjectFact>,
) {
  const page = draft.page()
  const editableInputs = draft.locator(
    'input:not([type="file"]):not([readonly]):not([disabled]):not([role="combobox"]), textarea:not([readonly]):not([disabled])',
  )
  for (let index = 0; index < (await editableInputs.count()); index += 1) {
    const input = editableInputs.nth(index)
    if (!(await input.isVisible())) continue
    const metadata = await input.evaluate((element) => ({
      type: element instanceof HTMLInputElement ? element.type : 'textarea',
      label:
        element.getAttribute('aria-label') ??
        Array.from((element as HTMLInputElement).labels ?? [])
          .map((label) => label.textContent ?? '')
          .join(' '),
    }))
    const label = metadata.label.trim()
    const currentValue = await input.inputValue()
    const numeric =
      metadata.type === 'number' ||
      /数量|金额|单价|成本|费率|比例|基点|月数/.test(label)
    if (currentValue && !(numeric && /^0(?:\.0+)?$/.test(currentValue)))
      continue
    const value =
      metadata.type === 'date' ||
      label.includes('日期') ||
      label.includes('期间')
        ? '2026-08-01'
        : label.includes('哈希')
          ? '0'.repeat(64)
          : label.includes('脚本版本')
            ? '1'
            : label.includes('Starlark')
              ? 'result = {"amount": "1.00"}'
              : numeric
                ? '1'
                : label.includes('单据号') || label.includes('票据号码')
                  ? `DOC-${Date.now()}`
                  : `目标${label || '值'}`
    await input.fill(value)
  }

  const comboboxes = draft.locator('select, input[role="combobox"]')
  for (let index = 0; index < (await comboboxes.count()); index += 1) {
    const combobox = comboboxes.nth(index)
    if (!(await combobox.isVisible()) || !(await combobox.isEnabled())) continue
    const nativeSelect = await combobox.evaluate(
      (element) => element instanceof HTMLSelectElement,
    )
    try {
      if (nativeSelect) {
        const options = combobox.locator('option:not([disabled])')
        if ((await options.count()) > 1)
          await combobox.selectOption({ index: 1 })
      } else {
        await combobox.press('ArrowDown')
        await page.getByRole('option').first().waitFor({
          state: 'visible',
          timeout: 1_000,
        })
        await combobox.press('Enter')
      }
    } catch {
      await page.keyboard.press('Escape')
    }
  }

  const productLines = draft.getByTestId('vou-product-lines-editor')
  if ((await productLines.count()) > 0) {
    await productLines
      .getByLabel('产品', { exact: true })
      .selectOption({ index: 1 })
    await productLines.getByLabel('录入数量', { exact: true }).fill('1')
    await productLines
      .getByLabel('录入单位', { exact: true })
      .selectOption({ index: 1 })
    await productLines.getByLabel('基础数量', { exact: true }).fill('1')
    await productLines.getByLabel('单价', { exact: true }).fill('1')
  }

  if (entity === 'sale-signoff') {
    const expected = draft.getByLabel('预期溶剂桶数')
    if (await expected.isVisible()) await expected.fill('1')
  }
}

async function createCompleteVouDraft(
  page: Page,
  entity: VouEntity,
  facts: Record<string, VouReferenceFact>,
  accObjectFacts: Record<'asset' | 'bill', VouAccObjectFact>,
) {
  const accCandidateEntity =
    entity.startsWith('asset-') && entity !== 'asset-acquisition'
      ? 'asset'
      : entity === 'bill-payment' ||
          entity === 'bill-discount' ||
          entity === 'bill-maturity'
        ? 'bill'
        : null
  const accCandidateResponse = accCandidateEntity
    ? page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/vou/reference/query' &&
          response.request().postDataJSON()?.entity === accCandidateEntity,
      )
    : null
  await page.goto(`/vou/${entity}`)
  if (accCandidateResponse) {
    const body = await (await accCandidateResponse).json()
    expect(body.code, `${entity} candidate: ${JSON.stringify(body)}`).toBe(0)
    expect(body.data.items.length, `${entity} candidate`).toBeGreaterThan(0)
  }
  await page.waitForLoadState('networkidle')
  const username = page.getByLabel('用户名')
  if (await username.isVisible()) {
    await expect(username).toBeVisible()
    await username.fill(process.env.TARGET_E2E_USERNAME!)
    await page.getByLabel('密码').fill(process.env.TARGET_E2E_PASSWORD!)
    await page.getByRole('button', { name: '登录' }).click()
    await expect(username).toHaveCount(0)
  }
  const region = vouRegion(page)
  await region.getByRole('button', { name: '新建本地草稿' }).click()
  const draft = region.getByTestId('vou-local-draft')
  await expect(draft).toHaveCount(1)
  await draft.locator('.v-expansion-panel-title').click()
  await expect(
    draft.getByRole('button', { name: '提交审批', exact: true }),
  ).toBeVisible()
  await fillCompleteVouDraft(draft, entity, facts, accObjectFacts)
  return { region, draft }
}

const vouLifecyclePriority = new Map<VouEntity, number>([
  ['asset-sale', 0],
  ['asset-liquidation', 1],
  ['bill-payment', 2],
  ['bill-discount', 3],
  ['bill-maturity', 4],
  ['asset-acquisition', 100],
  ['bill-receipt', 101],
  ['bill-issue', 102],
  ['intermediary-calculation', 200],
])
const vouLifecycleEntities = userCreatableVouEntities
  .filter((entity) => entity !== 'service-acceptance')
  .map((entity, index) => ({
    entity,
    order: vouLifecyclePriority.get(entity) ?? 10 + index,
  }))
  .sort((left, right) => left.order - right.order)
  .map(({ entity }) => entity)

for (const entity of vouLifecycleEntities)
  test(`VOU ${entity} completes its server-authorized approve to unapprove lifecycle`, async ({
    browser,
  }) => {
    test.fixme(
      entity === 'intermediary-calculation',
      '用户明确延期：来源、版本化脚本与结果校验后端能力需独立恢复。',
    )
    test.setTimeout(300_000)
    const context = await browser.newContext()
    const page = await context.newPage()
    const reviewerContext = await browser.newContext()
    const reviewerPage = await reviewerContext.newPage()
    try {
      await signIn(
        reviewerPage,
        process.env.TARGET_E2E_REVIEWER_USERNAME!,
        process.env.TARGET_E2E_REVIEWER_PASSWORD!,
        '/vou/sale-pricing',
      )
      await signIn(
        page,
        process.env.TARGET_E2E_USERNAME!,
        process.env.TARGET_E2E_PASSWORD!,
        '/vou/asset-sale',
      )
      const facts = readVouReferenceFacts()
      const { region, draft } = await createCompleteVouDraft(
        page,
        entity,
        facts,
        readVouAccObjectFacts(),
      )
      const priorSubmissions = await region
        .getByTestId('vou-submission')
        .count()
      const responsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/vou/${entity}/submit-new`,
      )
      await draft.getByRole('button', { name: '提交审批', exact: true }).click()
      const response = await responsePromise
      expect(response.ok()).toBe(true)
      const responseBody = await response.json()
      expect(
        responseBody.code,
        JSON.stringify({
          responseBody,
          request: response.request().postDataJSON(),
        }),
      ).toBe(0)
      await expect(region.getByTestId('vou-local-draft')).toHaveCount(0)
      await expect(region.getByTestId('vou-submission')).toHaveCount(
        priorSubmissions + 1,
      )
      const submitterSubmission = pendingVouSubmissionRow(region)
      const submitterMarker = submitterSubmission.getByTestId('vou-submission')
      const documentId = requiredString(
        await submitterMarker.getAttribute('data-vou-document-id'),
        `${entity} 单据标识`,
      )
      const submissionId = requiredString(
        await submitterMarker.getAttribute('data-vou-submission-id'),
        `${entity} 提交标识`,
      )
      await expect(
        submitterSubmission.getByRole('button', { name: '批准', exact: true }),
      ).toHaveCount(0)
      await expect(
        submitterSubmission.getByRole('button', { name: '驳回', exact: true }),
      ).toHaveCount(0)

      await reviewerPage.goto(`/vou/${entity}`)
      const reviewerSubmission = vouSubmissionRow(
        vouRegion(reviewerPage),
        documentId,
      )
      const approve = reviewerPage.waitForResponse(
        (candidate) =>
          new URL(candidate.url()).pathname === `/vou/${entity}/approve`,
      )
      await reviewerSubmission
        .getByRole('button', { name: '批准', exact: true })
        .click()
      expect((await (await approve).json()).code).toBe(0)
      await expect(reviewerSubmission).toContainText('已批准')
      const approvedEffects = await vouEffectCounts(submissionId)
      if (postsJournal(entity)) {
        expect(approvedEffects.journals, `${entity} journal`).toBe(1)
        expect(
          approvedEffects.journalLines,
          `${entity} journal lines`,
        ).toBeGreaterThanOrEqual(2)
      } else expect(approvedEffects.journals, `${entity} UN_POST`).toBe(0)
      if (
        entity === 'asset-acquisition' ||
        entity === 'asset-sale' ||
        entity === 'asset-liquidation' ||
        entity.startsWith('bill-')
      )
        expect(
          approvedEffects.registers,
          `${entity} register effect`,
        ).toBeGreaterThanOrEqual(1)
      if (entity === 'sale-signoff')
        expect(
          approvedEffects.containers,
          `${entity} container effect`,
        ).toBeGreaterThanOrEqual(1)
      await reviewerSubmission.getByRole('button', { name: '详情' }).click()
      const detail = reviewerPage.getByTestId('vou-submission-detail')
      await detail.getByLabel('驳回或反批准原因').fill('逐类反批准验收')
      const unapprove = reviewerPage.waitForResponse(
        (candidate) =>
          new URL(candidate.url()).pathname === `/vou/${entity}/unapprove`,
      )
      await detail.getByRole('button', { name: '反批准', exact: true }).click()
      expect((await (await unapprove).json()).code).toBe(0)
      await expect(reviewerSubmission).toContainText('待批准')
      expect(await vouEffectCounts(submissionId), `${entity} reversal`).toEqual(
        {
          journals: 0,
          journalLines: 0,
          registers: 0,
          containers: 0,
        },
      )
      await page.goto(`/vou/${entity}`)
      const submitterDeletion = vouSubmissionRow(vouRegion(page), documentId)
      await clickForTargetResponse(
        page,
        `/vou/${entity}/delete`,
        submitterDeletion.getByRole('button', {
          name: '撤回',
          exact: true,
        }),
      )
      await expect(submitterDeletion).toHaveCount(0)
    } finally {
      await reviewerContext.close()
      await context.close()
    }
  })

test('VOU drafts recover attachments locally, retain them after a failed submit, finalize them only after success, and expose the full approval lifecycle', async ({
  browser,
}) => {
  test.setTimeout(300_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  const facts = readVouReferenceFacts()
  const accObjectFacts = readVouAccObjectFacts()
  const { region: failedRegion, draft: failedDraft } =
    await createCompleteVouDraft(page, 'sale-order', facts, accObjectFacts)
  await failedDraft
    .getByTestId('vou-attachment-input')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'evidence.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nlocal evidence'),
    })
  await expect(failedDraft.getByTestId('vou-local-attachment')).toHaveCount(1)
  await page.reload()
  const recoveredFailedDraft = failedRegion.getByTestId('vou-local-draft')
  await recoveredFailedDraft.locator('.v-expansion-panel-title').click()
  await expect(
    recoveredFailedDraft.getByTestId('vou-local-attachment'),
  ).toHaveCount(1)
  await recoveredFailedDraft.getByLabel('基础数量').first().fill('invalid')
  const failedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/sale-order/submit-new',
  )
  await recoveredFailedDraft
    .getByRole('button', { name: '提交审批', exact: true })
    .click()
  expect((await (await failedResponse).json()).errorKey).toBe(
    'validation_failed',
  )
  await expect(
    recoveredFailedDraft.getByTestId('vou-local-attachment'),
  ).toHaveCount(1)

  await page.goto('/vou/sale-pricing')
  const complete = await createCompleteVouDraft(
    page,
    'sale-pricing',
    facts,
    accObjectFacts,
  )
  await complete.draft
    .getByTestId('vou-attachment-input')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'final.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nfinal evidence'),
    })
  await complete.draft
    .getByRole('button', { name: '提交审批', exact: true })
    .click()
  await expect(complete.region.getByTestId('vou-local-draft')).toHaveCount(0)
  const submission = pendingVouSubmissionRow(complete.region)
  const submissionMarker = submission.getByTestId('vou-submission')
  await submission.getByRole('button', { name: '详情' }).click()
  await expect(
    page
      .getByTestId('vou-submission-detail')
      .getByTestId('vou-submission-attachment'),
  ).toHaveCount(1)
  const attachmentSubmissionId = requiredString(
    await submissionMarker.getAttribute('data-vou-submission-id'),
    '附件单据提交标识',
  )
  const attachmentDocumentId = requiredString(
    await submissionMarker.getAttribute('data-vou-document-id'),
    '附件单据标识',
  )
  const downloadEvent = page.waitForEvent('download')
  const attachmentRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/sale-pricing/attachment-read',
  )
  await page
    .getByTestId('vou-submission-detail')
    .getByRole('button', { name: '下载', exact: true })
    .click()
  const readResponse = await attachmentRead
  expect(readResponse.request().postDataJSON().submissionId).toBe(
    attachmentSubmissionId,
  )
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('final.pdf')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.7\nfinal evidence')

  const reviewerContext = await browser.newContext()
  const reviewerPage = await reviewerContext.newPage()
  await signIn(
    reviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
    '/vou/sale-pricing',
  )
  const reviewerSubmission = vouSubmissionRow(
    vouRegion(reviewerPage),
    attachmentDocumentId,
  )
  await reviewerSubmission.getByRole('button', { name: '详情' }).click()
  let reviewerDetail = reviewerPage.getByTestId('vou-submission-detail')
  await reviewerDetail.getByLabel('驳回或反批准原因').fill('请补充资料')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/sale-pricing/reject',
    reviewerDetail.getByRole('button', { name: '驳回', exact: true }),
  )
  await expect(reviewerSubmission).toContainText('已驳回')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/sale-pricing/unreject',
    reviewerDetail.getByRole('button', { name: '恢复审核', exact: true }),
  )
  await expect(reviewerSubmission).toContainText('待批准')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/sale-pricing/approve',
    reviewerDetail.getByRole('button', { name: '批准', exact: true }),
  )
  await expect(reviewerSubmission).toContainText('已批准')
  reviewerDetail = reviewerPage.getByTestId('vou-submission-detail')
  await reviewerDetail.getByLabel('驳回或反批准原因').fill('测试反批准')
  const unapproveAttachment = reviewerPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/sale-pricing/unapprove',
  )
  await reviewerDetail
    .getByRole('button', { name: '反批准', exact: true })
    .click()
  const unapproveAttachmentBody = await (await unapproveAttachment).json()
  expect(
    unapproveAttachmentBody.code,
    JSON.stringify(unapproveAttachmentBody),
  ).toBe(0)
  await expect(reviewerSubmission).toContainText('待批准')

  await page.goto('/vou/sale-pricing')
  const deletableSubmission = vouSubmissionRow(
    vouRegion(page),
    attachmentDocumentId,
  )
  await clickForTargetResponse(
    page,
    '/vou/sale-pricing/delete',
    deletableSubmission.getByRole('button', {
      name: '撤回',
      exact: true,
    }),
  )
  await expect(deletableSubmission).toHaveCount(0)

  const serviceContractDraft = await createCompleteVouDraft(
    page,
    'service-contract',
    facts,
    accObjectFacts,
  )
  await clickForTargetResponse(
    page,
    '/vou/service-contract/submit-new',
    serviceContractDraft.draft.getByRole('button', {
      name: '提交审批',
      exact: true,
    }),
  )
  const submittedServiceContract = pendingVouSubmissionRow(
    serviceContractDraft.region,
  )
  const submittedServiceContractMarker =
    submittedServiceContract.getByTestId('vou-submission')
  const serviceContractDocumentId = requiredString(
    await submittedServiceContractMarker.getAttribute('data-vou-document-id'),
    '服务合同单据标识',
  )
  const serviceContractSubmissionId = requiredString(
    await submittedServiceContractMarker.getAttribute('data-vou-submission-id'),
    '服务合同提交标识',
  )
  await reviewerPage.goto('/vou/service-contract')
  const serviceContract = vouSubmissionRow(
    vouRegion(reviewerPage),
    serviceContractDocumentId,
  )
  await clickForTargetResponse(
    reviewerPage,
    '/vou/service-contract/approve',
    serviceContract.getByRole('button', { name: '批准', exact: true }),
  )
  await expect(serviceContract).toContainText('已批准')
  facts['service-contract'] = {
    entity: 'service-contract',
    objectId: serviceContractDocumentId,
    approvalEntryId: serviceContractSubmissionId,
    code: '服务合同',
    name: '目标服务合同',
  }
  const acceptance = await createCompleteVouDraft(
    page,
    'service-acceptance',
    facts,
    accObjectFacts,
  )
  await acceptance.draft
    .getByRole('combobox', { name: '服务合同 *', exact: true })
    .selectOption(serviceContractDocumentId)
  const acceptanceResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/service-acceptance/submit-new',
  )
  await acceptance.draft
    .getByRole('button', { name: '提交审批', exact: true })
    .click()
  expect((await (await acceptanceResponse).json()).code).toBe(0)
  await expect(acceptance.region.getByTestId('vou-submission')).toHaveCount(1)
  const acceptanceSubmission = pendingVouSubmissionRow(acceptance.region)
  const acceptanceSubmissionMarker =
    acceptanceSubmission.getByTestId('vou-submission')
  const acceptanceDocumentId = requiredString(
    await acceptanceSubmissionMarker.getAttribute('data-vou-document-id'),
    '服务验收单据标识',
  )
  const acceptanceSubmissionId = requiredString(
    await acceptanceSubmissionMarker.getAttribute('data-vou-submission-id'),
    '服务验收提交标识',
  )
  await reviewerPage.goto('/vou/service-acceptance')
  const reviewerAcceptance = vouSubmissionRow(
    vouRegion(reviewerPage),
    acceptanceDocumentId,
  )
  await clickForTargetResponse(
    reviewerPage,
    '/vou/service-acceptance/approve',
    reviewerAcceptance.getByRole('button', { name: '批准', exact: true }),
  )
  await expect(reviewerAcceptance).toContainText('已批准')
  const approvedAcceptanceEffects = await vouEffectCounts(
    acceptanceSubmissionId,
  )
  if (postsJournal('service-acceptance')) {
    expect(approvedAcceptanceEffects.journals).toBe(1)
    expect(approvedAcceptanceEffects.journalLines).toBeGreaterThanOrEqual(2)
  } else expect(approvedAcceptanceEffects.journals).toBe(0)
  await reviewerAcceptance.getByRole('button', { name: '详情' }).click()
  const acceptanceDetail = reviewerPage.getByTestId('vou-submission-detail')
  await acceptanceDetail
    .getByLabel('驳回或反批准原因')
    .fill('服务验收逐类反批准')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/service-acceptance/unapprove',
    acceptanceDetail.getByRole('button', {
      name: '反批准',
      exact: true,
    }),
  )
  await expect(reviewerAcceptance).toContainText('待批准')
  expect(await vouEffectCounts(acceptanceSubmissionId)).toEqual({
    journals: 0,
    journalLines: 0,
    registers: 0,
    containers: 0,
  })
  await page.goto('/vou/service-acceptance')
  const submitterAcceptance = vouSubmissionRow(
    vouRegion(page),
    acceptanceDocumentId,
  )
  await clickForTargetResponse(
    page,
    '/vou/service-acceptance/delete',
    submitterAcceptance.getByRole('button', {
      name: '撤回',
      exact: true,
    }),
  )
  await reviewerPage.goto('/vou/service-contract')
  const serviceContractForCleanup = vouSubmissionRow(
    vouRegion(reviewerPage),
    serviceContractDocumentId,
  )
  await serviceContractForCleanup.getByRole('button', { name: '详情' }).click()
  const serviceContractDetail = reviewerPage.getByTestId(
    'vou-submission-detail',
  )
  await serviceContractDetail
    .getByLabel('驳回或反批准原因')
    .fill('服务合同测试清理')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/service-contract/unapprove',
    serviceContractDetail.getByRole('button', {
      name: '反批准',
      exact: true,
    }),
  )
  await page.goto('/vou/service-contract')
  const submitterServiceContract = vouSubmissionRow(
    vouRegion(page),
    serviceContractDocumentId,
  )
  await clickForTargetResponse(
    page,
    '/vou/service-contract/delete',
    submitterServiceContract.getByRole('button', {
      name: '撤回',
      exact: true,
    }),
  )
  await reviewerContext.close()
  await context.close()
})

for (const entity of systemGeneratedVouEntities) {
  test(`system-generated VOU ${entity} has no browser new-Draft surface and rejects an untrusted HTTP submit`, async ({
    page,
  }) => {
    await signIn(
      page,
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
      `/vou/${entity}`,
    )
    await expect(vouRegion(page)).toBeVisible()
    await expect(
      vouRegion(page).getByRole('button', { name: '新建本地草稿' }),
    ).toHaveCount(0)
    const session = await replaceSession(
      page.context(),
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
    )
    const submissionId = targetId()
    const references = readVouReferenceFacts()
    const sources = readVouSourceFacts()
    const versioned = (key: string) => {
      const fact = references[key]!
      return {
        objectId: fact.objectId,
        approvalEntryId: fact.approvalEntryId,
        selectionOrigin: 'CURRENT' as const,
      }
    }
    const payload =
      entity === 'sale-signoff'
        ? {
            businessDate: '2026-08-01',
            currency: 'CNY',
            attachments: [],
            parentEntity: 'sale-order' as const,
            parentDocumentId: sources.saleOrder.documentId,
            customerSubunit: versioned('customerSubunit'),
            expectedSolventContainers: 1,
            expectedResinContainers: 0,
            returnedSolventContainers: 0,
            returnedResinContainers: 0,
            signoffLines: [
              {
                sourceLineId: sources.saleOrder.lineId,
                signedBaseQuantity: '1.00',
                rejectedBaseQuantity: '0.00',
              },
            ],
          }
        : entity === 'expense-payment'
          ? {
              businessDate: '2026-08-01',
              currency: 'CNY',
              attachments: [],
              employee: versioned('employee'),
              fundAccount: versioned('fundAccount'),
              handler: versioned('employee'),
              amount: '1.00',
            }
          : {
              businessDate: '2026-08-01',
              currency: 'CNY',
              attachments: [],
              sourceLines: [
                {
                  sourceLineId: sources.saleOrder.lineId,
                  baseQuantity: '1.00',
                },
              ],
            }
    const response = await page
      .context()
      .request.post(
        `${process.env.TARGET_API_BASE_URL}/vou/${entity}/submit-new`,
        {
          headers: {
            'X-ZERP-Model-Build': modelBuildId,
            'X-CSRF-Token': session.csrfToken,
          },
          data: {
            documentId: targetId(),
            submissionId,
            idempotencyKey: submissionId,
            expectedRevision: null,
            payload,
          },
        },
      )
    expect(response.ok()).toBe(true)
    expect((await response.json()).errorKey).toBe('approval_invalid_action')
  })
}

test('ACC current page is read-only and loads no DCL or warehouse surface', async ({
  page,
}) => {
  const unrelatedPosts: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    const path = new URL(request.url()).pathname
    if (
      path.startsWith('/dcl/') ||
      path.startsWith('/warehouse/') ||
      path.startsWith('/aux/') ||
      path.startsWith('/bob/')
    )
      unrelatedPosts.push(path)
  })
  await signIn(
    page,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
    '/acc/mapping',
  )
  const currentPage = page.getByTestId('acc-mapping-page')
  await expect(
    currentPage.getByRole('link', { name: '维护记账映射' }),
  ).toHaveAttribute('href', '/dcl/acc-mapping')
  await expect(page.getByRole('region', { name: '目标业务档案' })).toHaveCount(
    0,
  )
  await expect(page.getByRole('region', { name: '本地仓库草稿' })).toHaveCount(
    0,
  )
  expect(unrelatedPosts).toEqual([])
})

test('ACC book and subject save and delete through their target HTTP actions', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
    '/acc/book',
  )
  const books = page.getByTestId('acc-book-page')
  const createdName = `目标账簿-${Date.now()}`
  const createBook = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/book/create',
  )
  await books.getByRole('button', { name: '新增账簿' }).click()
  await page.getByLabel('账簿名称').fill(createdName)
  await page.getByLabel('开始月份').fill('2026-09')
  await selectVuetifyOption(page, page.getByLabel('建账科目模板'), '空白账簿')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect((await (await createBook).json()).code).toBe(0)
  const createdBook = books.getByRole('row').filter({ hasText: createdName })
  await expect(createdBook).toBeVisible()
  await createdBook.getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('账簿名称').fill(`${createdName}-已保存`)
  const saveBook = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/book/save',
  )
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect((await (await saveBook).json()).code).toBe(0)
  const book = books
    .getByRole('row')
    .filter({ hasText: `${createdName}-已保存` })
  await expect(book).toBeVisible()
  const bookCode = (await book.getByRole('cell').first().textContent())?.trim()
  expect(bookCode).toBeTruthy()

  await page.goto('/acc/subject')
  const subjects = page.getByTestId('acc-subject-page')
  await subjects.getByLabel('会计账簿').press('End')
  await subjects.getByLabel('会计账簿').press('Enter')
  await subjects.getByRole('button', { name: '新增科目' }).click()
  await page.getByLabel('科目编码', { exact: true }).fill('1999')
  await page.getByLabel('科目名称', { exact: true }).fill('目标借方科目')
  const createSubject = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/subject/create',
  )
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect((await (await createSubject).json()).code).toBe(0)
  const createdSubject = subjects
    .getByRole('row')
    .filter({ hasText: '目标借方科目' })
  await expect(createdSubject).toBeVisible()
  await createdSubject.getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('科目名称', { exact: true }).fill('保存后的目标科目')
  const saveSubject = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/subject/save',
  )
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect((await (await saveSubject).json()).code).toBe(0)
  const subject = subjects
    .getByRole('row')
    .filter({ hasText: '保存后的目标科目' })
  await expect(subject).toBeVisible()
  const deleteSubject = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/subject/delete',
  )
  page.once('dialog', (dialog) => dialog.accept())
  await subject.getByRole('button', { name: '删除' }).click()
  expect((await (await deleteSubject).json()).code).toBe(0)
  await expect(subject).toHaveCount(0)

  await page.goto('/acc/book')
  const savedBook = page
    .getByTestId('acc-book-page')
    .getByRole('row')
    .filter({ hasText: `${createdName}-已保存` })
  const deleteBook = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/book/delete',
  )
  page.once('dialog', (dialog) => dialog.accept())
  await savedBook.getByRole('button', { name: '删除' }).click()
  expect((await (await deleteBook).json()).code).toBe(0)
  await expect(savedBook).toHaveCount(0)
})

test('ACC Opening stays local until submit, then completes approval and period lock/unlock through real Hono', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const facts = readAccUiFacts()
  const submitterContext = await browser.newContext()
  const submitterPage = await submitterContext.newPage()
  await signIn(
    submitterPage,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
    '/acc/opening',
  )
  const opening = submitterPage.getByTestId('acc-opening-page')
  await selectVuetifyOption(
    submitterPage,
    opening.getByLabel('会计账簿'),
    facts.book.name,
  )
  await expect(opening.getByTestId('acc-opening-submission')).toHaveCount(0)
  await opening.getByRole('button', { name: '新建本地草稿' }).click()
  const draft = opening.getByTestId('opening-local-draft')
  await expect(draft).toHaveCount(1)
  await draft.locator('.v-expansion-panel-title').click()
  const openingObjects = readVouAccObjectFacts()
  const customerSubunit = readVouReferenceFacts().customerSubunit!

  await draft.getByRole('button', { name: '增加期初分录' }).click()
  let openingLines = draft.getByTestId('opening-line')
  await openingLines.first().getByLabel('金额').fill('100.00')
  await draft.getByRole('button', { name: '增加期初分录' }).click()
  openingLines = draft.getByTestId('opening-line')
  const creditSubject = facts.subjects.find(
    (subject) => subject.balanceDirection === 'CREDIT',
  )!
  await selectVuetifyOption(
    submitterPage,
    openingLines.nth(1).getByLabel('会计科目'),
    creditSubject.name,
  )
  await openingLines.nth(1).getByLabel('金额').fill('200.00')

  await draft.getByRole('button', { name: '增加固定资产' }).click()
  const assetCard = draft.getByTestId('opening-asset')
  const assetCandidates = submitterPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/reference/query' &&
      response.request().postDataJSON()?.entity === 'asset',
  )
  const assetSelect = assetCard.getByRole('combobox', {
    name: '关联已有资产（可选）',
  })
  await assetSelect.fill('目标')
  await assetCandidates
  await selectVuetifyOption(submitterPage, assetSelect, '目标资产')
  await assetCard.getByLabel('原值').fill('100.00')

  await draft.getByRole('button', { name: '增加票据' }).click()
  const billCard = draft.getByTestId('opening-bill')
  const billCandidates = submitterPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/reference/query' &&
      response.request().postDataJSON()?.entity === 'bill',
  )
  const billSelect = billCard.getByRole('combobox', {
    name: '关联已有票据（可选）',
  })
  await billSelect.fill('BIL')
  await billCandidates
  await selectVuetifyOption(submitterPage, billSelect, 'BIL-')
  await billCard.getByLabel('账面价值').fill('100.00')

  await selectVuetifyOption(
    submitterPage,
    openingLines.first().getByRole('combobox', { name: '资产（可选）' }),
    '目标资产',
  )

  const billSubject = facts.subjects.find((subject) =>
    subject.requiredDimensions.includes('BILL'),
  )!
  await draft.getByRole('button', { name: '增加期初分录' }).click()
  openingLines = draft.getByTestId('opening-line')
  const billLine = openingLines.nth(2)
  await selectVuetifyOption(
    submitterPage,
    billLine.getByLabel('会计科目'),
    billSubject.name,
  )
  await billLine.getByLabel('金额').fill('100.00')
  await selectVuetifyOption(
    submitterPage,
    billLine.getByRole('combobox', { name: '票据' }),
    'BIL-',
  )

  await draft
    .getByRole('combobox', { name: '客户子单位' })
    .fill(customerSubunit.name)
  await submitterPage
    .getByRole('option')
    .filter({ hasText: customerSubunit.name })
    .click()
  await draft.getByRole('button', { name: '增加空桶' }).click()
  await draft.getByLabel('数量').fill('2')

  await draft.getByRole('button', { name: '保存到当前设备' }).click()
  await submitterPage.reload()
  await selectVuetifyOption(
    submitterPage,
    opening.getByLabel('会计账簿'),
    facts.book.name,
  )
  await expect(opening.getByTestId('opening-local-draft')).toHaveCount(1)
  await opening
    .getByTestId('opening-local-draft')
    .locator('.v-expansion-panel-title')
    .click()
  const submit = submitterPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/acc/opening/submit-new',
  )
  await opening
    .getByTestId('opening-local-draft')
    .getByRole('button', { name: '提交审批' })
    .click()
  const submitted = await submit
  const submittedBody: unknown = await submitted.json()
  if (
    !isRecord(submittedBody) ||
    !isRecord(submittedBody.data) ||
    !isRecord(submittedBody.data.payload)
  )
    throw new Error(
      `期初提交响应缺少完整 snapshot: ${JSON.stringify({ response: submittedBody, request: submitted.request().postDataJSON() })}`,
    )
  expect(submittedBody.code).toBe(0)
  expect(submittedBody.data.payload.assets).toHaveLength(1)
  expect(submittedBody.data.payload.assets[0].assetId).toBe(
    openingObjects.asset.objectId,
  )
  expect(submittedBody.data.payload.bills).toHaveLength(1)
  expect(submittedBody.data.payload.bills[0].billId).toBe(
    openingObjects.bill.objectId,
  )
  expect(submittedBody.data.payload.containers).toHaveLength(1)
  await expect(opening.getByTestId('opening-local-draft')).toHaveCount(0)
  await expect(opening.getByTestId('acc-opening-submission')).toContainText(
    '待批准',
  )

  const reviewerContext = await browser.newContext()
  const reviewerPage = await reviewerContext.newPage()
  await signIn(
    reviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
    '/acc/opening',
  )
  const reviewerOpening = reviewerPage.getByTestId('acc-opening-page')
  await selectVuetifyOption(
    reviewerPage,
    reviewerOpening.getByLabel('会计账簿'),
    facts.book.name,
  )
  const pending = reviewerOpening.getByTestId('acc-opening-submission')
  const approveOpening = reviewerPage.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/opening/approve',
  )
  await pending.getByRole('button', { name: '批准' }).click()
  const approvedOpeningBody = await (await approveOpening).json()
  expect(approvedOpeningBody.code, JSON.stringify(approvedOpeningBody)).toBe(0)
  await expect(pending).toContainText('已批准')

  await reviewerPage.goto('/acc/period')
  const period = reviewerPage.getByTestId('acc-period-page')
  await selectVuetifyOption(
    reviewerPage,
    period.getByLabel('会计账簿'),
    facts.book.name,
  )
  await clickForTargetResponse(
    reviewerPage,
    '/acc/period/lock',
    period.getByRole('button', { name: `锁定 ${facts.book.startMonth}` }),
  )
  await expect(period).toContainText(`已锁定 ${facts.book.startMonth}。`)
  const locked = period
    .getByRole('row')
    .filter({ hasText: facts.book.startMonth })
  await expect(locked).toContainText('已锁定')
  await clickForTargetResponse(
    reviewerPage,
    '/acc/period/unlock',
    period.getByRole('button', { name: '解锁最新期间', exact: true }),
  )
  await expect(period).toContainText(`已解锁 ${facts.book.startMonth}。`)
  await expect(locked).toContainText('未锁定')
  await reviewerContext.close()
  await submitterContext.close()
})

async function clickForWflResponse(
  page: Page,
  pathname: string,
  control: Locator,
): Promise<Record<string, unknown>> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === pathname,
  )
  await control.click()
  const response = await responsePromise
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new Error(`${pathname}: 响应不是对象`)
  expect(
    body.code,
    `${pathname}: ${JSON.stringify(body)} request=${response.request().postData()}`,
  ).toBe(0)
  if (!isRecord(body.data)) throw new Error(`${pathname}: 成功响应缺少 data`)
  return body.data
}

async function openWflInstance(page: Page, definitionName: string) {
  await page.goto('/wfl/process-instance')
  const instances = page.getByTestId('wfl-instance-page')
  const instance = instances
    .getByRole('row')
    .filter({ hasText: definitionName })
    .getByTestId('wfl-instance')
  await expect(instance).toBeVisible()
  await instance.getByRole('button', { name: '查看实例', exact: true }).click()
  const detail = page.getByTestId('wfl-instance-detail')
  await expect(detail).toBeVisible()
  return detail
}

async function openWflInstanceNode(detail: Locator, nodeKey: string) {
  const node = detail.locator(`[data-wfl-node-key="${nodeKey}"]`)
  await expect(node).toBeVisible()
  const title = node.locator('.v-expansion-panel-title')
  if ((await title.getAttribute('aria-expanded')) !== 'true')
    await title.click()
  await expect(title).toHaveAttribute('aria-expanded', 'true')
  return node
}

test('WFL definition stays local until trial and submit, then exposes current definition and all six server-authorized instance actions', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const submitterContext = await browser.newContext()
  const reviewerContext = await browser.newContext()
  const submitterPage = await submitterContext.newPage()
  const reviewerPage = await reviewerContext.newPage()
  try {
    await signIn(
      submitterPage,
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
      '/vou/sale-order',
    )
    const rootDraft = await createCompleteVouDraft(
      submitterPage,
      'sale-order',
      readVouReferenceFacts(),
      readVouAccObjectFacts(),
    )
    const rootSubmissionResponse = await clickForWflResponse(
      submitterPage,
      '/vou/sale-order/submit-new',
      rootDraft.draft.getByRole('button', { name: '提交审批', exact: true }),
    )
    const rootSubmissionId = requiredString(
      rootSubmissionResponse.submissionId,
      'WFL 根销售订单提交标识',
    )
    const rootDocumentId = requiredString(
      rootSubmissionResponse.documentId,
      'WFL 根销售订单标识',
    )
    const rootDocumentNo = requiredString(
      rootSubmissionResponse.documentNo,
      'WFL 根销售订单单号',
    )
    const rootLine = await effectPool.query<{ line_id: string }>(
      `SELECT line_id FROM vou_product_line_snapshots
       WHERE approval_entry_id = $1 ORDER BY line_no LIMIT 1`,
      [rootSubmissionId],
    )
    const rootLineId = requiredString(
      rootLine.rows[0]?.line_id,
      'WFL 根销售订单行标识',
    )

    await submitterPage.goto('/dcl/wfl-process-definition')
    const definitions = submitterPage.getByTestId('dcl-wfl-definition-page')
    await definitions.getByRole('button', { name: '新建本地草稿' }).click()
    const draft = definitions.getByTestId('wfl-local-draft')
    await draft.locator('.v-expansion-panel-title').click()
    await draft
      .getByTestId('wfl-trial-script')
      .getByRole('textbox')
      .fill(
        `root = node(key="root", name="销售订单", entity="sale-order")\n` +
          `outbound = node(key="outbound", name="销售出库", entity="sale-outbound")\n` +
          `delivery = node(key="delivery", name="销售送货", entity="sale-delivery")\n` +
          `workflow(code="local-flow", name="本地流程", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${rootLineId}","baseQuantity":"1"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${rootLineId}","baseQuantity":"1"}]}))])`,
      )
    const trialCandidates = submitterPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/vou/sale-order/query',
    )
    await selectVuetifyOption(
      submitterPage,
      draft
        .getByTestId('wfl-trial-document-entity')
        .locator('input[role="combobox"]'),
      '销售订单',
    )
    const trialCandidateBody: unknown = await (await trialCandidates).json()
    if (!isRecord(trialCandidateBody) || !isRecord(trialCandidateBody.data))
      throw new Error('WFL 试算单据候选响应无效')
    expect(trialCandidateBody.code).toBe(0)
    if (!Array.isArray(trialCandidateBody.data.items))
      throw new Error('WFL 试算单据候选缺少 items')
    expect(trialCandidateBody.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: rootDocumentId,
          documentNo: rootDocumentNo,
        }),
      ]),
    )
    await selectVuetifyOption(
      submitterPage,
      draft.getByTestId('wfl-trial-document').locator('input[role="combobox"]'),
      rootDocumentNo,
    )
    await draft.getByRole('button', { name: '保存到本机' }).click()
    await expect(definitions).toContainText('草稿已保存在当前设备。')
    await submitterPage.reload()
    await expect(definitions.getByTestId('wfl-local-draft')).toHaveCount(1)
    const persistedDraft = definitions.getByTestId('wfl-local-draft')
    await persistedDraft.locator('.v-expansion-panel-title').click()
    const trial = await clickForWflResponse(
      submitterPage,
      '/wfl/process-definition/trial',
      persistedDraft.getByRole('button', { name: '试算', exact: true }),
    )
    expect(trial.result).toMatchObject({ ok: true })
    await expect(persistedDraft).toContainText('本地流程')
    const definitionSubmission = await clickForWflResponse(
      submitterPage,
      '/dcl/wfl-process-definition/submit-new',
      persistedDraft.getByRole('button', { name: '提交候选', exact: true }),
    )
    const definitionSubmissionId = requiredString(
      definitionSubmission.submissionId,
      '流程定义提交件标识',
    )
    await expect(definitions.getByTestId('wfl-local-draft')).toHaveCount(0)

    await signIn(
      reviewerPage,
      process.env.TARGET_E2E_REVIEWER_USERNAME!,
      process.env.TARGET_E2E_REVIEWER_PASSWORD!,
      '/dcl/wfl-process-definition',
    )
    const reviewDefinitions = reviewerPage.getByTestId(
      'dcl-wfl-definition-page',
    )
    const definition = reviewDefinitions.getByRole('row').filter({
      has: reviewerPage.locator(
        `[data-testid="dcl-wfl-submission"][data-wfl-submission-id="${definitionSubmissionId}"]`,
      ),
    })
    await expect(definition).toBeVisible()
    await expect(
      definition.getByRole('button', { name: '删除候选', exact: true }),
    ).toHaveCount(0)
    await reviewDefinitions
      .getByTestId('dcl-wfl-review-reason')
      .getByRole('textbox')
      .fill('流程定义驳回验证')
    await clickForTargetResponse(
      reviewerPage,
      '/dcl/wfl-process-definition/reject',
      definition.getByRole('button', { name: '驳回', exact: true }),
    )
    await expect(definition).toContainText('已驳回')
    await clickForTargetResponse(
      reviewerPage,
      '/dcl/wfl-process-definition/unreject',
      definition.getByRole('button', { name: '恢复审核', exact: true }),
    )
    await expect(definition).toContainText('待批准')
    await clickForTargetResponse(
      reviewerPage,
      '/dcl/wfl-process-definition/approve',
      definition.getByRole('button', { name: '批准', exact: true }),
    )
    await expect(definition).toContainText('已批准')
    await clickForTargetResponse(
      reviewerPage,
      '/dcl/wfl-process-definition/enable',
      definition.getByRole('button', { name: '启用', exact: true }),
    )
    await expect(
      definition.getByRole('button', { name: '停用', exact: true }),
    ).toBeVisible()

    await reviewerPage.goto('/wfl/process-definition')
    const current = reviewerPage.getByTestId('wfl-definition-page')
    const currentDefinition = current
      .getByRole('row')
      .filter({ hasText: '本地流程' })
      .getByTestId('wfl-current-definition')
    await expect(currentDefinition).toBeVisible()
    await currentDefinition.getByRole('button', { name: '查看结构' }).click()
    await expect(
      reviewerPage.getByTestId('wfl-definition-viewer'),
    ).toContainText('local-flow')

    await reviewerPage.goto('/vou/sale-order')
    const rootForApproval = vouSubmissionRow(
      vouRegion(reviewerPage),
      rootDocumentId,
    )
    await clickForTargetResponse(
      reviewerPage,
      '/vou/sale-order/approve',
      rootForApproval.getByRole('button', { name: '批准', exact: true }),
    )
    await expect(rootForApproval).toContainText('已批准')

    await submitterPage.goto('/wfl/local-flow')
    await expect(submitterPage.getByTestId('wfl-instance-page')).toContainText(
      '本地流程',
    )
    await submitterPage.goto('/wfl/unregistered-flow')
    await expect(submitterPage.getByTestId('wfl-instance-page')).toHaveCount(0)
    await expect(submitterPage).toHaveURL(/\/forbidden$/)
    await expect(submitterPage.getByRole('main')).toContainText('无权访问')

    let detail = await openWflInstance(submitterPage, '本地流程')
    let root = await openWflInstanceNode(detail, 'root')
    await clickForWflResponse(
      submitterPage,
      '/wfl/process-instance/action',
      root.getByRole('button', { name: '打开单据', exact: true }),
    )
    await expect(submitterPage).toHaveURL(/\/vou\/sale-order/)
    detail = await openWflInstance(submitterPage, '本地流程')
    root = await openWflInstanceNode(detail, 'root')
    await selectVuetifyOption(
      submitterPage,
      root.getByTestId('wfl-child-target').locator('input[role="combobox"]'),
      '销售出库',
    )
    await clickForWflResponse(
      submitterPage,
      '/wfl/process-instance/action',
      root.getByRole('button', { name: '创建下级', exact: true }),
    )
    await expect(
      detail.locator('[data-wfl-node-key="outbound"]'),
    ).toContainText('待批准')

    let reviewerDetail = await openWflInstance(reviewerPage, '本地流程')
    let outbound = await openWflInstanceNode(reviewerDetail, 'outbound')
    await clickForWflResponse(
      reviewerPage,
      '/wfl/process-instance/action',
      outbound.getByRole('button', { name: '批准下级', exact: true }),
    )
    await expect(outbound).toContainText('已批准')

    detail = await openWflInstance(submitterPage, '本地流程')
    let approvedOutbound = await openWflInstanceNode(detail, 'outbound')
    await selectVuetifyOption(
      submitterPage,
      approvedOutbound
        .getByTestId('wfl-child-target')
        .locator('input[role="combobox"]'),
      '销售送货',
    )
    await clickForWflResponse(
      submitterPage,
      '/wfl/process-instance/action',
      approvedOutbound.getByRole('button', { name: '创建下级', exact: true }),
    )
    await expect(
      detail.locator('[data-wfl-node-key="delivery"]'),
    ).toContainText('待批准')

    reviewerDetail = await openWflInstance(reviewerPage, '本地流程')
    let delivery = await openWflInstanceNode(reviewerDetail, 'delivery')
    await delivery
      .getByTestId('wfl-node-reason')
      .getByRole('textbox')
      .fill('流程节点驳回验证')
    await clickForWflResponse(
      reviewerPage,
      '/wfl/process-instance/action',
      delivery.getByRole('button', { name: '驳回下级', exact: true }),
    )
    await expect(delivery).toContainText('已驳回')
    delivery = await openWflInstanceNode(reviewerDetail, 'delivery')
    await clickForWflResponse(
      reviewerPage,
      '/wfl/process-instance/action',
      delivery.getByRole('button', { name: '重试下级', exact: true }),
    )
    await expect(delivery).toContainText('待批准')
    delivery = await openWflInstanceNode(reviewerDetail, 'delivery')
    await delivery
      .getByTestId('wfl-node-reason')
      .getByRole('textbox')
      .fill('流程节点取消验证')
    await clickForWflResponse(
      reviewerPage,
      '/wfl/process-instance/action',
      delivery.getByRole('button', { name: '驳回下级', exact: true }),
    )
    await expect(delivery).toContainText('已驳回')

    detail = await openWflInstance(submitterPage, '本地流程')
    const cancelDelivery = await openWflInstanceNode(detail, 'delivery')
    await cancelDelivery
      .getByTestId('wfl-node-reason')
      .getByRole('textbox')
      .fill('取消已驳回下级')
    await clickForWflResponse(
      submitterPage,
      '/wfl/process-instance/action',
      cancelDelivery.getByRole('button', { name: '取消下级', exact: true }),
    )
    await expect(
      detail.locator('[data-wfl-node-key="delivery"]'),
    ).toContainText('尚未创建单据')
  } finally {
    await Promise.allSettled([
      reviewerContext.close(),
      submitterContext.close(),
    ])
  }
})

async function replaceSession(
  context: BrowserContext,
  username: string,
  password: string,
) {
  const response = await context.request.post(
    process.env.TARGET_API_BASE_URL + '/app/user/signin',
    {
      headers: { 'X-ZERP-Model-Build': modelBuildId },
      data: { username, password },
    },
  )
  expect(response.ok()).toBe(true)
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data as { csrfToken: string }
}

test('Operating Entity local Draft drives the complete target archive lifecycle', async ({
  browser,
}) => {
  const submitterContext = await browser.newContext()
  const submitterPage = await submitterContext.newPage()
  await signIn(
    submitterPage,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
    '/dcl/operating-entity',
  )
  const submitterRegion = await selectArchiveEntity(
    submitterPage,
    'operating-entity',
  )
  await submitterRegion.getByRole('button', { name: '新建本地草稿' }).click()
  const firstDraft = submitterRegion.locator('[data-archive-draft-id]').last()
  await openArchiveDraft(firstDraft)
  const v1 = await submitArchiveDraft(
    submitterPage,
    'operating-entity',
    firstDraft,
  )
  const submitterV1 = archiveSubmissionRow(submitterRegion, v1.submissionId)
  await expectArchiveStatus(submitterV1, 'PENDING')
  await expect(
    submitterV1.getByRole('button', { name: '撤回', exact: true }),
  ).toBeVisible()

  const reviewerContext = await browser.newContext()
  const reviewerPage = await reviewerContext.newPage()
  await signIn(
    reviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
    '/dcl/operating-entity',
  )
  const reviewerRegion = await selectArchiveEntity(
    reviewerPage,
    'operating-entity',
  )
  const reviewerV1 = () => archiveSubmissionRow(reviewerRegion, v1.submissionId)
  await reviewerRegion
    .getByLabel('驳回或反批准原因')
    .fill('经营主体页面驳回验证')
  await reviewerV1().getByRole('button', { name: '驳回', exact: true }).click()
  await expectArchiveStatus(reviewerV1(), 'REJECTED')
  await reviewerV1()
    .getByRole('button', { name: '恢复审核', exact: true })
    .click()
  await expectArchiveStatus(reviewerV1(), 'PENDING')
  await reviewerV1().getByRole('button', { name: '批准', exact: true }).click()
  await expectArchiveStatus(reviewerV1(), 'APPROVED')

  await submitterPage.reload()
  await queryArchiveEntity(submitterPage, 'operating-entity')
  await archiveSubmissionRow(submitterRegion, v1.submissionId)
    .getByRole('button', { name: '克隆草稿', exact: true })
    .click()
  const changeDraft = submitterRegion.locator('[data-archive-draft-id]').last()
  await openArchiveDraft(changeDraft)
  await fillArchiveField(changeDraft, '法定名称', '新经营主体二期')
  const v2 = await submitArchiveDraft(
    submitterPage,
    'operating-entity',
    changeDraft,
    'change',
  )
  await expectArchiveStatus(
    archiveSubmissionRow(submitterRegion, v2.submissionId),
    'PENDING',
  )

  await reviewerPage.reload()
  await queryArchiveEntity(reviewerPage, 'operating-entity')
  const reviewerV2 = () => archiveSubmissionRow(reviewerRegion, v2.submissionId)
  await reviewerV2().getByRole('button', { name: '批准', exact: true }).click()
  await expectArchiveStatus(reviewerV2(), 'APPROVED')
  await reviewerRegion
    .getByLabel('驳回或反批准原因')
    .fill('经营主体页面回落验证')
  await reviewerV2()
    .getByRole('button', { name: '反批准', exact: true })
    .click()
  await expectArchiveStatus(reviewerV2(), 'PENDING')

  await submitterPage.reload()
  await queryArchiveEntity(submitterPage, 'operating-entity')
  await archiveSubmissionRow(submitterRegion, v2.submissionId)
    .getByRole('button', { name: '撤回', exact: true })
    .click()
  await expect(
    archiveSubmissionRow(submitterRegion, v2.submissionId),
  ).toHaveCount(0)
  await expectArchiveStatus(
    archiveSubmissionRow(submitterRegion, v1.submissionId),
    'APPROVED',
  )

  await reviewerContext.close()
  await submitterContext.close()
})

test('each supported archive submits through the browser and is read back by the archive query', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const submitterContext = await browser.newContext()
  const reviewerContext = await browser.newContext()
  const submitterPage = await submitterContext.newPage()
  const reviewerPage = await reviewerContext.newPage()
  const auxiliaryFacts = readAuxiliaryFacts()
  const accountingFacts = readAccountingFacts()
  const runId = targetId()
  const legalIdentifier = `91${runId.slice(0, 16)}`

  try {
    await signIn(
      submitterPage,
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
    )
    await signIn(
      reviewerPage,
      process.env.TARGET_E2E_REVIEWER_USERNAME!,
      process.env.TARGET_E2E_REVIEWER_PASSWORD!,
    )

    const submitterRegion = await selectArchiveEntity(
      submitterPage,
      'operating-entity',
    )
    await submitterRegion.getByRole('button', { name: '新建本地草稿' }).click()
    const operatingEntityDraft = submitterRegion
      .locator('[data-archive-draft-id]')
      .last()
    await openArchiveDraft(operatingEntityDraft)
    await fillArchiveField(
      operatingEntityDraft,
      '统一社会信用代码',
      legalIdentifier,
    )
    const operatingEntity = await submitArchiveDraft(
      submitterPage,
      'operating-entity',
      operatingEntityDraft,
    )
    await approveArchiveSubmission(
      reviewerPage,
      'operating-entity',
      operatingEntity.submissionId,
    )
    await submitterPage.reload()
    await queryArchiveEntity(submitterPage, 'operating-entity')
    await expectArchiveStatus(
      archiveSubmissionRow(
        archiveRegion(submitterPage),
        operatingEntity.submissionId,
      ),
      'APPROVED',
    )
    const historyRequests = ['/get', '/versions', '/audit-history'].map(
      (suffix) =>
        submitterPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname ===
              `/dcl/operating-entity${suffix}`,
        ),
    )
    await archiveSubmissionRow(
      archiveRegion(submitterPage),
      operatingEntity.submissionId,
    )
      .getByRole('button', { name: '详情与历史' })
      .click()
    await Promise.all(historyRequests)
    const history = submitterPage.getByTestId('dcl-detail')
    await expect(history).toBeVisible()
    await expect(history).toContainText('V1')
    await expect(history).toContainText('统一社会信用代码')
    await history.getByRole('button', { name: '关闭' }).click()
    const operatingEntityReference = {
      objectId: operatingEntity.subjectId,
      approvalEntryId: operatingEntity.submissionId,
      code: requiredString(operatingEntity.code, '经营主体编码'),
      name: '新经营主体',
    }

    const vehicle = await createAndSubmitArchive(
      submitterPage,
      'vehicle',
      async (draft) => {
        await fillArchiveField(
          draft,
          '车辆名称',
          `测试车辆-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(draft, '车牌号', `闽A${runId.slice(0, 6)}`)
        await fillArchiveStructure(
          draft,
          '车辆类型引用',
          auxiliaryReference(auxiliaryFacts, 'dictionary-item'),
        )
        await fillArchiveStructure(draft, '承运方设置', {
          kind: 'INTERNAL',
          operatingEntityId: operatingEntityReference.objectId,
          approvalEntryId: operatingEntityReference.approvalEntryId,
        })
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'vehicle',
      vehicle,
    )

    const fundAccount = await createAndSubmitArchive(
      submitterPage,
      'fund-account',
      async (draft) => {
        await fillArchiveField(
          draft,
          '账户名称',
          `测试账户-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(draft, '账号', `ACCOUNT-${runId}`)
        await fillArchiveStructure(
          draft,
          '所属经营主体',
          operatingEntityReference,
        )
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'fund-account',
      fundAccount,
    )

    const product = await createAndSubmitArchive(
      submitterPage,
      'product',
      async (draft) => {
        await fillArchiveField(
          draft,
          '产品名称',
          `测试产品-${runId.slice(0, 6)}`,
        )
        await selectVuetifyOption(
          submitterPage,
          draft.getByLabel('产品类型'),
          requiredString(
            auxiliaryReference(auxiliaryFacts, 'product-type').name,
            '产品类型名称',
          ),
        )
        await selectVuetifyOption(
          submitterPage,
          draft.getByLabel('产品分类'),
          requiredString(
            auxiliaryReference(auxiliaryFacts, 'product-category').name,
            '产品分类名称',
          ),
        )
        await selectVuetifyOption(
          submitterPage,
          draft.getByLabel('添加计量单位'),
          requiredString(
            auxiliaryReference(auxiliaryFacts, 'measurement-unit').name,
            '计量单位名称',
          ),
        )
        await fillArchiveField(draft, '默认包装规格（基准数量）', '1.000000')
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'product',
      product,
    )

    const employee = await createAndSubmitArchive(
      submitterPage,
      'employee',
      async (draft) => {
        await fillArchiveField(
          draft,
          '法定名称',
          `测试员工-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(
          draft,
          '显示名称',
          `测试员工-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(draft, '法定识别号', `EMP-${runId}`)
        await fillArchiveStructure(
          draft,
          '人员类别引用',
          auxiliaryReference(auxiliaryFacts, 'employee-category'),
        )
        await fillArchiveStructure(
          draft,
          '部门引用',
          auxiliaryReference(auxiliaryFacts, 'department'),
        )
        await fillArchiveStructure(
          draft,
          '岗位引用',
          auxiliaryReference(auxiliaryFacts, 'position'),
        )
        await fillArchiveStructure(
          draft,
          '任职经营主体',
          operatingEntityReference,
        )
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'employee',
      employee,
    )

    const supplier = await createAndSubmitArchive(
      submitterPage,
      'supplier',
      async (draft) => {
        await fillArchiveField(
          draft,
          '法定名称',
          `测试供应商-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(
          draft,
          '显示名称',
          `测试供应商-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(draft, '法定识别号', `SUP-${runId}`)
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'supplier',
      supplier,
    )

    const customer = await createAndSubmitArchive(
      submitterPage,
      'customer',
      async (draft) => {
        await fillArchiveField(
          draft,
          '法定名称',
          `测试客户-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(
          draft,
          '显示名称',
          `测试客户-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(
          draft,
          '法定识别号',
          customerLegalIdentifier(runId),
        )
        await fillArchiveField(
          draft,
          '子单位名称',
          `测试客户子单位-${runId.slice(0, 6)}`,
        )
        await selectVuetifyOption(
          submitterPage,
          draft.getByLabel('客户类型'),
          requiredString(
            auxiliaryReference(auxiliaryFacts, 'dictionary-item').name,
            '客户类型名称',
          ),
        )
        await fillArchiveField(draft, '运输方式编码', 'DELIVERY')
        await fillArchiveField(draft, '运输方式名称', '送货')
        await selectVuetifyOption(
          submitterPage,
          draft.getByLabel('主要业务归属', { exact: true }),
          `测试员工-${runId.slice(0, 6)}`,
        )
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'customer',
      customer,
    )

    const otherUnit = await createAndSubmitArchive(
      submitterPage,
      'other-unit',
      async (draft) => {
        await fillArchiveField(
          draft,
          '法定名称',
          `测试其他单位-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(
          draft,
          '显示名称',
          `测试其他单位-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(draft, '法定识别号', `OTH-${runId}`)
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'other-unit',
      otherUnit,
    )

    const salesPartner = await createAndSubmitArchive(
      submitterPage,
      'sales-partner',
      async (draft) => {
        await fillArchiveField(
          draft,
          '法定名称',
          `测试销售合作方-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(
          draft,
          '显示名称',
          `测试销售合作方-${runId.slice(0, 6)}`,
        )
        await fillArchiveField(draft, '法定识别号', `PAR-${runId}`)
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'sales-partner',
      salesPartner,
    )

    const mappingEntity =
      userCreatableVouEntities[
        test.info().repeatEachIndex * (test.info().project.retries + 1) +
          test.info().retry
      ]
    if (!mappingEntity) throw new Error('会计映射测试尝试数超出独立单据类型数')
    const mapping = await createAndSubmitArchive(
      submitterPage,
      'acc-mapping',
      async (draft) => {
        await selectVuetifyOption(
          submitterPage,
          draft.getByLabel('会计账簿'),
          accountingFacts.book.name,
        )
        await selectVuetifyOption(
          submitterPage,
          draft.getByLabel('VOU 单据类型'),
          vouEntityPresentation[mappingEntity].label,
        )
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'acc-mapping',
      mapping,
    )

    const report = await createAndSubmitArchive(
      submitterPage,
      'rpt-definition',
      async (draft) => {
        await fillArchiveField(
          draft,
          '报表名称',
          `测试报表-${runId.slice(0, 6)}`,
        )
      },
    )
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'rpt-definition',
      report,
    )
    await expectArchiveStatus(
      archiveSubmissionRow(archiveRegion(submitterPage), report.submissionId),
      'APPROVED',
    )
  } finally {
    await reviewerContext.close()
    await submitterContext.close()
  }
})

test('offline Warehouse Draft reloads locally and drives the complete Submission lifecycle', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const submitterContext = await browser.newContext()
  const reviewerContext = await browser.newContext()
  try {
    const submitterPage = await submitterContext.newPage()
    await signIn(
      submitterPage,
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
      '/dcl/warehouse',
    )
    const submitterRegion = await selectArchiveEntity(
      submitterPage,
      'warehouse',
    )

    await submitterContext.setOffline(true)
    await submitterRegion.getByRole('button', { name: '新建本地草稿' }).click()
    let draft = submitterRegion.getByTestId('dcl-draft')
    await openArchiveDraft(draft)
    await fillArchiveField(draft, '仓库名称', '离线一号仓')
    await fillArchiveField(draft, '地址', '本机离线地址')
    await selectVuetifyOption(
      submitterPage,
      draft.getByRole('combobox', { name: '仓库负责人', exact: true }),
      '目标负责人',
    )
    await submitterPage.waitForTimeout(700)
    await submitterContext.setOffline(false)
    await submitterPage.reload()
    draft = submitterRegion.getByTestId('dcl-draft')
    await expect(draft).toHaveCount(1)
    await openArchiveDraft(draft)
    await expect(draft.getByLabel('仓库名称')).toHaveValue('离线一号仓')

    await replaceSession(
      submitterContext,
      process.env.TARGET_E2E_REVIEWER_USERNAME!,
      process.env.TARGET_E2E_REVIEWER_PASSWORD!,
    )
    await submitterPage.reload()
    await expect(submitterRegion.getByTestId('dcl-draft')).toHaveCount(0)

    await replaceSession(
      submitterContext,
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
    )
    await submitterPage.reload()
    draft = submitterRegion.getByTestId('dcl-draft')
    await openArchiveDraft(draft)
    const v1 = await submitArchiveDraft(submitterPage, 'warehouse', draft)

    const submitterSession = await replaceSession(
      submitterContext,
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
    )
    const staleSubmissionId = targetId()
    const staleResponse = await submitterContext.request.post(
      process.env.TARGET_API_BASE_URL + '/dcl/warehouse/submit-new',
      {
        headers: {
          'X-ZERP-Model-Build': modelBuildId,
          'X-CSRF-Token': submitterSession.csrfToken,
        },
        data: {
          subjectId: targetId(),
          submissionId: staleSubmissionId,
          idempotencyKey: staleSubmissionId,
          expectedLatestApprovedSubmissionId: null,
          expectedLatestApprovedRevision: null,
          snapshot: {
            name: '服务端失效引用验证',
            address: null,
            contactName: null,
            contactPhone: null,
            managerEmployeeId: process.env.TARGET_E2E_MANAGER_EMPLOYEE_ID!,
            managerEmployeeApprovalEntryId:
              process.env.TARGET_E2E_STALE_MANAGER_APPROVAL_ENTRY_ID!,
            managerEmployeeCode: 'EMP-E2E',
            managerEmployeeName: '目标负责人',
            remark: null,
            enabled: true,
          },
        },
      },
    )
    expect(staleResponse.ok()).toBe(true)
    expect((await staleResponse.json()).errorKey).toBe(
      'warehouse_reference_stale',
    )

    const reviewerPage = await reviewerContext.newPage()
    await signIn(
      reviewerPage,
      process.env.TARGET_E2E_REVIEWER_USERNAME!,
      process.env.TARGET_E2E_REVIEWER_PASSWORD!,
      '/dcl/warehouse',
    )
    let reviewerRegion = await selectArchiveEntity(reviewerPage, 'warehouse')
    let reviewerV1 = archiveSubmissionRow(reviewerRegion, v1.submissionId)
    await reviewerRegion.getByLabel('驳回或反批准原因').fill('页面驳回验证')
    await reviewerV1.getByRole('button', { name: '驳回', exact: true }).click()
    await expectArchiveStatus(reviewerV1, 'REJECTED')
    await reviewerV1
      .getByRole('button', { name: '恢复审核', exact: true })
      .click()
    await reviewerV1.getByRole('button', { name: '批准', exact: true }).click()
    await expectArchiveStatus(reviewerV1, 'APPROVED')

    await submitterPage.reload()
    const approvedV1 = archiveSubmissionRow(submitterRegion, v1.submissionId)
    await approvedV1
      .getByRole('button', { name: '克隆草稿', exact: true })
      .click()
    let changeDraft = submitterRegion.getByTestId('dcl-draft')
    await openArchiveDraft(changeDraft)
    await fillArchiveField(changeDraft, '仓库名称', '复用 V2 仓')
    const v2 = await submitArchiveDraft(
      submitterPage,
      'warehouse',
      changeDraft,
      'change',
    )

    await reviewerPage.reload()
    reviewerRegion = archiveRegion(reviewerPage)
    const reviewerV2 = archiveSubmissionRow(reviewerRegion, v2.submissionId)
    await reviewerV2.getByRole('button', { name: '批准', exact: true }).click()
    await expectArchiveStatus(reviewerV2, 'APPROVED')
    await reviewerRegion.getByLabel('驳回或反批准原因').fill('页面回落验证')
    await reviewerV2
      .getByRole('button', { name: '反批准', exact: true })
      .click()
    await expectArchiveStatus(reviewerV2, 'PENDING')

    await submitterPage.reload()
    const pendingV2 = archiveSubmissionRow(
      archiveRegion(submitterPage),
      v2.submissionId,
    )
    await pendingV2.getByRole('button', { name: '撤回', exact: true }).click()
    await expect(pendingV2).toHaveCount(0)
    await expect(
      archiveSubmissionRow(archiveRegion(submitterPage), v1.submissionId),
    ).toContainText(/已批准|APPROVED/)
  } finally {
    await Promise.allSettled([
      reviewerContext.close(),
      submitterContext.close(),
    ])
  }
})
