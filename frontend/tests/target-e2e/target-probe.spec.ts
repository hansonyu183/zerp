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
  userCreatableVouEntities,
  type VouEntity,
  type VouInputFieldDescriptor,
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
  return page.getByRole('region', { name: '目标业务档案' })
}

async function selectArchiveEntity(page: Page, entity: ArchiveEntity) {
  const region = archiveRegion(page)
  if (new URL(page.url()).pathname !== `/dcl/${entity}`) {
    await region
      .getByRole('navigation', { name: 'DCL 业务档案页面' })
      .getByRole('link', {
        name: archiveLabel(entity),
        exact: true,
      })
      .click()
  }
  await expect(page).toHaveURL(new RegExp(`/dcl/${entity}$`))
  await queryArchiveEntity(page, entity)
  return region
}

async function queryArchiveEntity(page: Page, entity: ArchiveEntity) {
  const queryButton = archiveRegion(page)
    .getByRole('form', { name: '业务档案查询条件' })
    .getByRole('button', { name: '查询', exact: true })
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
  const body = await (await responsePromise).json()
  expect(body.code, `${pathname}: ${JSON.stringify(body)}`).toBe(0)
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
  await group
    .getByLabel('选择资料')
    .selectOption(requiredString(value.objectId ?? value.id, '候选资料'))
}

async function submitArchiveDraft(
  page: Page,
  entity: ArchiveEntity,
  draft: Locator,
  mode: 'new' | 'change' = 'new',
): Promise<ArchiveSubmissionResponse> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/dcl/${entity}/submit-${mode}`,
    { timeout: 5_000 },
  )
  await draft.getByRole('button', { name: '提交', exact: true }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  const payload: unknown = await response.json()
  if (!isRecord(payload)) throw new Error(`${entity} submit 响应无效`)
  expect(payload.code, `${entity}: ${JSON.stringify(payload)}`).toBe(0)
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
  if (entity !== 'acc-mapping')
    await expect(
      archiveRegion(page).locator(
        `[data-archive-submission-id="${submission.submissionId}"]`,
      ),
    ).toContainText('待批准')
  return submission
}

async function approveArchiveSubmission(
  page: Page,
  entity: ArchiveEntity,
  submissionId: string,
) {
  const region = await selectArchiveEntity(page, entity)
  const submission = region.locator(
    `[data-archive-submission-id="${submissionId}"]`,
  )
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
  await expect(submission).toContainText('已批准')
}

async function createAndSubmitArchive(
  page: Page,
  entity: ArchiveEntity,
  configure: (draft: Locator) => Promise<void>,
) {
  const region = await selectArchiveEntity(page, entity)
  await expect(
    region.getByRole('button', { name: '新建本地草稿' }),
  ).toBeEnabled()
  await region.getByRole('button', { name: '新建本地草稿' }).click()
  const draft = region.locator('[data-archive-draft-id]').last()
  await expect(draft).toBeVisible()
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
      const reviewerV1 = reviewerRegion.locator(
        `[data-archive-submission-id="${initial.submissionId}"]`,
      )
      await reviewerRegion
        .getByLabel('审批原因')
        .fill(`${archiveLabel(entity)}驳回验证`)
      await reviewerV1
        .getByRole('button', { name: '驳回', exact: true })
        .click()
      await expect(reviewerV1).toContainText('已驳回')
      await reviewerV1
        .getByRole('button', { name: '恢复审核', exact: true })
        .click()
      await expect(reviewerV1).toContainText('待批准')
      await reviewerV1
        .getByRole('button', { name: '批准', exact: true })
        .click()
      await expect(reviewerV1).toContainText('已批准')
    })

    let change!: ArchiveSubmissionResponse
    await test.step('克隆并提交 V2', async () => {
      const submitterRegion = await selectArchiveEntity(submitterPage, entity)
      await submitterRegion
        .locator(`[data-archive-submission-id="${initial.submissionId}"]`)
        .getByRole('button', { name: '克隆为本地草稿', exact: true })
        .click()
      const changeDraft = submitterRegion
        .locator('[data-archive-draft-id]')
        .last()
      change = await submitArchiveDraft(
        submitterPage,
        entity,
        changeDraft,
        'change',
      )
      await expect(
        submitterRegion
          .locator(`[data-archive-submission-id="${initial.submissionId}"]`)
          .getByRole('button', { name: '克隆为本地草稿' }),
      ).toBeDisabled()
      const openCandidateClone = submitterRegion
        .locator(`[data-archive-submission-id="${change.submissionId}"]`)
        .getByRole('button', { name: '克隆为本地草稿' })
      await expect(openCandidateClone).toBeEnabled()
      await openCandidateClone.click()
      const openCandidateDraft = submitterRegion
        .locator('[data-archive-draft-id]')
        .last()
      await expect(openCandidateDraft).toBeVisible()
      await openCandidateDraft
        .getByRole('button', { name: '删除本地草稿' })
        .click()
      await expect(openCandidateDraft).toHaveCount(0)
    })

    await test.step('批准并反批准 V2 回落', async () => {
      await selectArchiveEntity(reviewerPage, entity)
      const reviewerV2 = archiveRegion(reviewerPage).locator(
        `[data-archive-submission-id="${change.submissionId}"]`,
      )
      await reviewerV2
        .getByRole('button', { name: '批准', exact: true })
        .click()
      await expect(reviewerV2).toContainText('已批准')
      await archiveRegion(reviewerPage)
        .getByLabel('审批原因')
        .fill(`${archiveLabel(entity)}回落验证`)
      await reviewerV2
        .getByRole('button', { name: '反批准', exact: true })
        .click()
      await expect(reviewerV2).toContainText('待批准')
    })

    await test.step('提交人删除回落后的开放 V2', async () => {
      await selectArchiveEntity(submitterPage, entity)
      const submitterV2 = archiveRegion(submitterPage).locator(
        `[data-archive-submission-id="${change.submissionId}"]`,
      )
      await submitterV2
        .getByRole('button', { name: '撤回', exact: true })
        .click()
      await expect(submitterV2).toHaveCount(0)
      await expect(
        archiveRegion(submitterPage).locator(
          `[data-archive-submission-id="${initial.submissionId}"]`,
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
  await expect(
    archiveRegion(page).getByRole('heading', { name: '车辆维护' }),
  ).toBeVisible()
  await expect(
    archiveRegion(page)
      .getByRole('navigation', { name: 'DCL 业务档案页面' })
      .getByRole('link', { name: '车辆', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    archiveRegion(page).getByText('请提交查询条件加载服务端档案。'),
  ).toBeVisible()
  await queryArchiveEntity(page, 'vehicle')
})

function vouRegion(page: Page) {
  return page.getByRole('region', { name: '目标单据' })
}

interface VouInputEntry {
  field: VouInputFieldDescriptor
  path: string[]
  referenceEntity?: string
  allowedEntities?: readonly string[]
}

function vouInputEntries(entity: VouEntity): VouInputEntry[] {
  const result: VouInputEntry[] = []
  const visit = (
    fields: readonly VouInputFieldDescriptor[],
    parent: string[] = [],
    referenceEntity?: string,
    allowedEntities?: readonly string[],
  ) => {
    for (const field of fields) {
      if (field.key === 'attachments') continue
      if (!field.required) continue
      const path = [...parent, field.key]
      if (field.kind === 'object' && field.fields?.length) {
        visit(field.fields, path, field.referenceEntity, field.allowedEntities)
        continue
      }
      if (field.kind === 'array' && field.item?.length) {
        // The local Draft creates one row for every required collection.
        if (field.required) visit(field.item, [...path, '0'])
        continue
      }
      result.push({ field, path, referenceEntity, allowedEntities })
    }
  }
  visit(vouEntityInputDescriptors[entity])
  return result
}

function vouInputTestId(entry: VouInputEntry) {
  return `vou-field-${entry.path.join('-')}`
}

function fallbackVouFact(facts: Record<string, VouReferenceFact>) {
  return facts.product ?? Object.values(facts)[0]!
}

function vouReferenceFact(
  entry: VouInputEntry,
  facts: Record<string, VouReferenceFact>,
) {
  const entity = entry.referenceEntity
  const key =
    entity === 'operating-entity'
      ? 'operatingEntity'
      : entity === 'customer-subunit'
        ? 'customerSubunit'
        : entity === 'fund-account'
          ? 'fundAccount'
          : entity === 'other-unit'
            ? 'otherUnit'
            : entity
  return (key && facts[key]) || fallbackVouFact(facts)
}

async function fillCompleteVouDraft(
  draft: Locator,
  entity: VouEntity,
  facts: Record<string, VouReferenceFact>,
  _accObjectFacts: Record<'asset' | 'bill', VouAccObjectFact>,
) {
  for (const entry of vouInputEntries(entity)) {
    const leaf = entry.path.at(-1)!
    const reference = vouReferenceFact(entry, facts)
    if (leaf === 'objectId' || leaf === 'assetId' || leaf === 'billId') {
      const candidates = draft.getByTestId(`${vouInputTestId(entry)}-candidate`)
      await expect
        .poll(() => candidates.locator('option').count())
        .toBeGreaterThan(1)
      await candidates.selectOption({ index: 1 })
      continue
    }
    const control = draft.getByTestId(vouInputTestId(entry))
    if (
      (entry.referenceEntity || entry.allowedEntities?.length) &&
      ['approvalEntryId', 'selectionOrigin', 'entity', 'code', 'name'].includes(
        leaf,
      )
    )
      continue
    const value =
      leaf === 'approvalEntryId'
        ? reference.approvalEntryId
        : leaf === 'code'
          ? reference.code
          : leaf === 'name'
            ? reference.name
            : `目标-${entry.path.join('-')}`
    if (entry.field.kind === 'enum') {
      if (leaf === 'entity' && entry.field.enumValues?.includes('product'))
        await control.selectOption('product')
      continue
    }
    if (entry.field.kind === 'boolean') continue
    if (entry.field.kind === 'date') {
      await control.fill('2026-08-01')
      continue
    }
    if (entry.field.kind === 'decimal') {
      await control.fill('1.00')
      continue
    }
    if (entry.field.kind === 'integer') {
      await control.fill('1')
      continue
    }
    if (leaf === 'sourceHash' || leaf === 'hash') {
      await control.fill('0'.repeat(64))
      continue
    }
    if (leaf.endsWith('DocumentId')) {
      await control.fill(targetId())
      continue
    }
    if (leaf.endsWith('DocumentNo')) {
      await control.fill('DOC-0001')
      continue
    }
    if (leaf === 'settlementTermCode') {
      await control.fill('TERM-1')
      continue
    }
    await control.fill(value)
  }
  if (entity === 'purchase-inbound') {
    const source = readVouSourceFacts().purchaseOrder
    await draft.getByTestId('vou-field-parentEntity').fill('purchase-order')
    await draft
      .getByTestId('vou-field-parentDocumentId')
      .fill(source.documentId)
    await draft
      .getByTestId('vou-field-sourceLines-0-sourceLineId')
      .fill(source.lineId)
  }
  if (entity === 'sale-signoff')
    await draft.getByTestId('vou-field-expectedSolventContainers').fill('1')
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
  const username = page.getByLabel('用户名')
  const signedIn = page.getByRole('status').filter({ hasText: '当前用户：' })
  await page.waitForLoadState('networkidle')
  if (!(await signedIn.isVisible())) {
    await expect(username).toBeVisible()
    await username.fill(process.env.TARGET_E2E_USERNAME!)
    await page.getByLabel('密码').fill(process.env.TARGET_E2E_PASSWORD!)
    await page.getByRole('button', { name: '登录' }).click()
  }
  await expect(signedIn).toBeVisible()
  const region = vouRegion(page)
  await region.getByRole('button', { name: '新建本地草稿' }).click()
  const draft = region.getByTestId('vou-local-draft')
  await expect(draft).toHaveCount(1)
  await fillCompleteVouDraft(draft, entity, facts, accObjectFacts)
  return { region, draft }
}

test('every user-creatable VOU completes its server-authorized approve to unapprove lifecycle', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  const reviewerContext = await browser.newContext()
  const reviewerPage = await reviewerContext.newPage()
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
  const consumerFirst = new Map<VouEntity, number>([
    ['asset-sale', 0],
    ['asset-liquidation', 1],
    ['bill-payment', 2],
    ['bill-discount', 3],
    ['bill-maturity', 4],
    ['asset-acquisition', 100],
    ['bill-receipt', 101],
    ['bill-issue', 102],
  ])
  const lifecycleEntities = userCreatableVouEntities
    .filter((candidate) => candidate !== 'service-acceptance')
    .map((entity, index) => ({
      entity,
      order: consumerFirst.get(entity) ?? 10 + index,
    }))
    .sort((left, right) => left.order - right.order)
    .map(({ entity }) => entity)
  for (const entity of lifecycleEntities) {
    const { region, draft } = await createCompleteVouDraft(
      page,
      entity,
      facts,
      readVouAccObjectFacts(),
    )
    const priorSubmissions = await region.getByTestId('vou-submission').count()
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/vou/${entity}/submit-new`,
    )
    await draft.getByRole('button', { name: '提交', exact: true }).click()
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
    const submitterSubmission = region
      .getByTestId('vou-submission')
      .filter({ hasText: '待批准' })
      .first()
    const documentId = requiredString(
      await submitterSubmission.getAttribute('data-vou-document-id'),
      `${entity} 单据标识`,
    )
    const submissionId = requiredString(
      await submitterSubmission.getAttribute('data-vou-submission-id'),
      `${entity} 提交标识`,
    )
    await expect(
      submitterSubmission.getByRole('button', { name: '批准', exact: true }),
    ).toHaveCount(0)
    await expect(
      submitterSubmission.getByRole('button', { name: '驳回', exact: true }),
    ).toHaveCount(0)

    await reviewerPage.goto(`/vou/${entity}`)
    const reviewerSubmission = vouRegion(reviewerPage).locator(
      `[data-testid="vou-submission"][data-vou-document-id="${documentId}"]`,
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
    await reviewerSubmission.getByLabel('审批原因').fill('逐类反批准验收')
    const unapprove = reviewerPage.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === `/vou/${entity}/unapprove`,
    )
    await reviewerSubmission
      .getByRole('button', { name: '反批准', exact: true })
      .click()
    expect((await (await unapprove).json()).code).toBe(0)
    await expect(reviewerSubmission).toContainText('待批准')
    expect(await vouEffectCounts(submissionId), `${entity} reversal`).toEqual({
      journals: 0,
      journalLines: 0,
      registers: 0,
      containers: 0,
    })
    await page.goto(`/vou/${entity}`)
    const submitterDeletion = vouRegion(page).locator(
      `[data-testid="vou-submission"][data-vou-document-id="${documentId}"]`,
    )
    await clickForTargetResponse(
      page,
      `/vou/${entity}/delete`,
      submitterDeletion.getByRole('button', {
        name: '删除提交件',
        exact: true,
      }),
    )
    await expect(submitterDeletion).toHaveCount(0)
  }
  await reviewerContext.close()
  await context.close()
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
  await failedDraft.getByLabel('附件').setInputFiles({
    name: 'evidence.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nlocal evidence'),
  })
  await failedDraft.getByRole('button', { name: '保存到本机' }).click()
  await page.reload()
  const recoveredFailedDraft = failedRegion.getByTestId('vou-local-draft')
  await expect(recoveredFailedDraft).toContainText('本地附件：1')
  await recoveredFailedDraft
    .getByTestId('vou-field-customerSubunit-approvalEntryId')
    .fill(targetId())
  const failedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/sale-order/submit-new',
  )
  await recoveredFailedDraft
    .getByRole('button', { name: '提交', exact: true })
    .click()
  expect((await (await failedResponse).json()).errorKey).toBe(
    'validation_failed',
  )
  await expect(recoveredFailedDraft).toContainText('本地附件：1')

  await page.goto('/vou/sale-pricing')
  const complete = await createCompleteVouDraft(
    page,
    'sale-pricing',
    facts,
    accObjectFacts,
  )
  await complete.draft.getByLabel('附件').setInputFiles({
    name: 'final.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nfinal evidence'),
  })
  await complete.draft
    .getByRole('button', { name: '提交', exact: true })
    .click()
  await expect(complete.region.getByTestId('vou-local-draft')).toHaveCount(0)
  const submission = complete.region
    .getByTestId('vou-submission')
    .filter({ hasText: '附件：1' })
    .first()
  await expect(submission).toContainText('附件：1')
  const attachmentSubmissionId = requiredString(
    await submission.getAttribute('data-vou-submission-id'),
    '附件单据提交标识',
  )

  const reviewerContext = await browser.newContext()
  const reviewerPage = await reviewerContext.newPage()
  await signIn(
    reviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
    '/vou/sale-pricing',
  )
  const reviewerSubmission = vouRegion(reviewerPage).locator(
    `[data-vou-submission-id="${attachmentSubmissionId}"]`,
  )
  await reviewerSubmission.getByLabel('审批原因').fill('请补充资料')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/sale-pricing/reject',
    reviewerSubmission.getByRole('button', { name: '驳回', exact: true }),
  )
  await expect(reviewerSubmission).toContainText('已驳回')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/sale-pricing/unreject',
    reviewerSubmission.getByRole('button', { name: '恢复审核', exact: true }),
  )
  await expect(reviewerSubmission).toContainText('待批准')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/sale-pricing/approve',
    reviewerSubmission.getByRole('button', { name: '批准', exact: true }),
  )
  await expect(reviewerSubmission).toContainText('已批准')
  await reviewerSubmission.getByLabel('审批原因').fill('测试反批准')
  const unapproveAttachment = reviewerPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/sale-pricing/unapprove',
  )
  await reviewerSubmission
    .getByRole('button', { name: '反批准', exact: true })
    .click()
  const unapproveAttachmentBody = await (await unapproveAttachment).json()
  expect(
    unapproveAttachmentBody.code,
    JSON.stringify(unapproveAttachmentBody),
  ).toBe(0)
  await expect(reviewerSubmission).toContainText('待批准')

  await page.goto('/vou/sale-pricing')
  const deletableSubmission = vouRegion(page).locator(
    `[data-vou-submission-id="${attachmentSubmissionId}"]`,
  )
  await clickForTargetResponse(
    page,
    '/vou/sale-pricing/delete',
    deletableSubmission.getByRole('button', {
      name: '删除提交件',
      exact: true,
    }),
  )
  await expect(page.getByRole('status')).toContainText('开放提交件已删除。')
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
      name: '提交',
      exact: true,
    }),
  )
  const submittedServiceContract = serviceContractDraft.region
    .getByTestId('vou-submission')
    .filter({ hasText: '待批准' })
    .first()
  const serviceContractDocumentId = requiredString(
    await submittedServiceContract.getAttribute('data-vou-document-id'),
    '服务合同单据标识',
  )
  const serviceContractSubmissionId = requiredString(
    await submittedServiceContract.getAttribute('data-vou-submission-id'),
    '服务合同提交标识',
  )
  await reviewerPage.goto('/vou/service-contract')
  const serviceContract = vouRegion(reviewerPage).locator(
    `[data-testid="vou-submission"][data-vou-document-id="${serviceContractDocumentId}"]`,
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
    .getByTestId('vou-field-serviceAcceptance-contractDocumentId')
    .fill(facts['service-contract']!.objectId)
  const acceptanceResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/service-acceptance/submit-new',
  )
  await acceptance.draft
    .getByRole('button', { name: '提交', exact: true })
    .click()
  expect((await (await acceptanceResponse).json()).code).toBe(0)
  await expect(acceptance.region).toContainText('服务器 Submission：1')
  const acceptanceSubmission = acceptance.region.getByTestId('vou-submission')
  const acceptanceDocumentId = requiredString(
    await acceptanceSubmission.getAttribute('data-vou-document-id'),
    '服务验收单据标识',
  )
  const acceptanceSubmissionId = requiredString(
    await acceptanceSubmission.getAttribute('data-vou-submission-id'),
    '服务验收提交标识',
  )
  await reviewerPage.goto('/vou/service-acceptance')
  const reviewerAcceptance = vouRegion(reviewerPage).locator(
    `[data-testid="vou-submission"][data-vou-document-id="${acceptanceDocumentId}"]`,
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
  await reviewerAcceptance.getByLabel('审批原因').fill('服务验收逐类反批准')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/service-acceptance/unapprove',
    reviewerAcceptance.getByRole('button', {
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
  const submitterAcceptance = vouRegion(page).locator(
    `[data-testid="vou-submission"][data-vou-document-id="${acceptanceDocumentId}"]`,
  )
  await clickForTargetResponse(
    page,
    '/vou/service-acceptance/delete',
    submitterAcceptance.getByRole('button', {
      name: '删除提交件',
      exact: true,
    }),
  )
  await reviewerPage.goto('/vou/service-contract')
  const serviceContractForCleanup = vouRegion(reviewerPage).locator(
    `[data-testid="vou-submission"][data-vou-document-id="${serviceContractDocumentId}"]`,
  )
  await serviceContractForCleanup
    .getByLabel('审批原因')
    .fill('服务合同测试清理')
  await clickForTargetResponse(
    reviewerPage,
    '/vou/service-contract/unapprove',
    serviceContractForCleanup.getByRole('button', {
      name: '反批准',
      exact: true,
    }),
  )
  await page.goto('/vou/service-contract')
  const submitterServiceContract = vouRegion(page).locator(
    `[data-testid="vou-submission"][data-vou-document-id="${serviceContractDocumentId}"]`,
  )
  await clickForTargetResponse(
    page,
    '/vou/service-contract/delete',
    submitterServiceContract.getByRole('button', {
      name: '删除提交件',
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
    await page.goto(`/vou/${entity}`)
    await signIn(
      page,
      process.env.TARGET_E2E_USERNAME!,
      process.env.TARGET_E2E_PASSWORD!,
    )
    await expect(page.getByRole('region', { name: '目标单据' })).toHaveCount(0)
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
  const currentPage = page.getByRole('region', { name: '当前会计映射' })
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
  const books = page.getByRole('region', { name: '会计账簿' })
  const createBook = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/book/create',
  )
  await books.getByRole('button', { name: '新建账簿' }).click()
  expect((await (await createBook).json()).code).toBe(0)
  const createdBook = books
    .getByTestId('acc-book')
    .filter({ hasText: '本地新账簿' })
  const bookId = requiredString(
    await createdBook.getAttribute('data-acc-book-id'),
    '新建账簿标识',
  )
  const book = books.locator(`[data-acc-book-id="${bookId}"]`)
  await book.getByLabel('名称').fill('保存后的目标账簿')
  const saveBook = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/book/save',
  )
  await book.getByRole('button', { name: '保存账簿' }).click()
  expect((await (await saveBook).json()).code).toBe(0)
  await expect(book).toContainText('保存后的目标账簿')

  await book.getByRole('button', { name: '选择账簿' }).click()
  await page.goto('/acc/subject')
  const subjects = page.getByRole('region', { name: '会计科目' })
  await subjects.getByLabel('账簿').selectOption(bookId)
  await subjects.getByLabel('新科目编码').fill('1999')
  await subjects.getByLabel('新科目名称').fill('本地借方科目')
  const createSubject = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/subject/create',
  )
  await subjects.getByRole('button', { name: '新建科目' }).click()
  expect((await (await createSubject).json()).code).toBe(0)
  const createdSubject = subjects
    .getByTestId('acc-subject')
    .filter({ hasText: '本地借方科目' })
  const subjectId = requiredString(
    await createdSubject.getAttribute('data-acc-subject-id'),
    '新建科目标识',
  )
  const subject = subjects.locator(`[data-acc-subject-id="${subjectId}"]`)
  await subject.getByLabel('名称').fill('保存后的目标科目')
  const saveSubject = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/subject/save',
  )
  await subject.getByRole('button', { name: '保存科目' }).click()
  expect((await (await saveSubject).json()).code).toBe(0)
  await expect(subject).toContainText('保存后的目标科目')
  const deleteSubject = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/subject/delete',
  )
  await subject.getByRole('button', { name: '删除科目' }).click()
  expect((await (await deleteSubject).json()).code).toBe(0)
  await expect(subject).toHaveCount(0)

  await page.goto('/acc/book')
  const savedBook = page
    .getByRole('region', { name: '会计账簿' })
    .getByTestId('acc-book')
    .filter({ hasText: '保存后的目标账簿' })
  const deleteBook = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/book/delete',
  )
  await savedBook.getByRole('button', { name: '删除账簿' }).click()
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
  const opening = submitterPage.getByRole('region', { name: '账簿期初' })
  await opening.getByLabel('账簿').selectOption(facts.book.id)
  await expect(opening.getByTestId('acc-opening-submission')).toHaveCount(0)
  await opening.getByRole('button', { name: '新建本地期初草稿' }).click()
  const draft = opening.getByTestId('opening-local-draft')
  await expect(draft).toHaveCount(1)
  const openingAssetId = targetId()
  const openingBillId = targetId()
  const openingAuxFacts = readAuxiliaryFacts()
  const openingReferences = readVouReferenceFacts()
  const assetCategory = auxiliaryReference(openingAuxFacts, 'asset-category')
  const department = auxiliaryReference(openingAuxFacts, 'department')
  const supplier = openingReferences.supplier!
  const equity = draft.locator('fieldset').nth(1)
  await equity.getByLabel('金额').fill('300.00')
  await draft.getByRole('button', { name: '新增期初明细' }).click()
  await draft.getByRole('button', { name: '新增期初明细' }).click()
  const assetSubject = facts.subjects.find(
    (subject) => subject.requiredDimensions.length === 0,
  )!
  const billSubject = facts.subjects.find((subject) =>
    subject.requiredDimensions.includes('BILL'),
  )!
  const assetLine = draft.locator('fieldset').nth(2)
  await assetLine.getByLabel('科目').selectOption(assetSubject.id)
  await assetLine.getByLabel('金额').fill('100.00')
  await assetLine
    .getByLabel('辅助维度（JSON）')
    .fill(JSON.stringify({ ASSET: openingAssetId }))
  await assetLine.getByLabel('辅助维度（JSON）').press('Tab')
  const billLine = draft.locator('fieldset').nth(3)
  await billLine.getByLabel('科目').selectOption(billSubject.id)
  await billLine.getByLabel('金额').fill('100.00')
  await billLine
    .getByLabel('辅助维度（JSON）')
    .fill(JSON.stringify({ BILL: openingBillId }))
  await billLine.getByLabel('辅助维度（JSON）').press('Tab')
  await draft.getByTestId('opening-assets').fill(
    JSON.stringify([
      {
        assetId: openingAssetId,
        assetNo: `AST-${openingAssetId.slice(0, 8)}`,
        name: '目标期初资产',
        categoryId: assetCategory.id,
        departmentId: department.id,
        usefulLifeMonths: 60,
        residualRate: '0.00',
        acquiredOn: '2026-08-01',
        currency: 'CNY',
        originalValue: '100.00',
        accumulatedDepreciation: '0.00',
      },
    ]),
  )
  await draft.getByTestId('opening-assets').press('Tab')
  await draft.getByTestId('opening-bills').fill(
    JSON.stringify([
      {
        billId: openingBillId,
        billNo: `BIL-${openingBillId.slice(0, 8)}`,
        billType: 'CHECK',
        positionType: 'ASSET',
        medium: 'PAPER',
        currency: 'CNY',
        faceAmount: '100.00',
        issueDate: '2026-08-01',
        maturityDate: '2026-09-01',
        drawer: '目标出票人',
        acceptor: '目标承兑人',
        payee: '目标收款人',
        annualRateBps: 0,
        interestDays: 0,
        interestAmount: '0.00',
        customerCostAmount: '0.00',
        valueAmount: '100.00',
        originatingCounterparty: {
          entity: 'supplier',
          objectId: supplier.objectId,
          approvalEntryId: supplier.approvalEntryId,
          code: supplier.code,
          name: supplier.name,
        },
      },
    ]),
  )
  await draft.getByTestId('opening-bills').press('Tab')
  const customerSubunit = readVouReferenceFacts().customerSubunit!
  await draft.getByTestId('opening-containers').fill(
    JSON.stringify([
      {
        subunit: {
          entity: 'customer-subunit',
          objectId: customerSubunit.objectId,
          customerId: readVouReferenceFacts().customer!.objectId,
          approvalEntryId: customerSubunit.approvalEntryId,
          code: customerSubunit.code,
          name: customerSubunit.name,
        },
        containerType: 'SOLVENT',
        quantity: 2,
      },
    ]),
  )
  await draft.getByTestId('opening-containers').press('Tab')
  await draft.getByRole('button', { name: '保存到本机' }).click()
  await submitterPage.reload()
  await opening.getByLabel('账簿').selectOption(facts.book.id)
  await expect(opening.getByTestId('opening-local-draft')).toHaveCount(1)
  const submit = submitterPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/acc/opening/submit-new',
  )
  await opening
    .getByTestId('opening-local-draft')
    .getByRole('button', { name: '提交' })
    .click()
  const submitted = await submit
  const submittedBody: unknown = await submitted.json()
  if (
    !isRecord(submittedBody) ||
    !isRecord(submittedBody.data) ||
    !isRecord(submittedBody.data.payload)
  )
    throw new Error('期初提交响应缺少完整 snapshot')
  expect(submittedBody.code).toBe(0)
  expect(submittedBody.data.payload.assets).toHaveLength(1)
  expect(submittedBody.data.payload.assets[0].assetId).toBe(openingAssetId)
  expect(submittedBody.data.payload.bills).toHaveLength(1)
  expect(submittedBody.data.payload.bills[0].billId).toBe(openingBillId)
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
  const reviewerOpening = reviewerPage.getByRole('region', { name: '账簿期初' })
  await reviewerOpening.getByLabel('账簿').selectOption(facts.book.id)
  const pending = reviewerOpening.getByTestId('acc-opening-submission')
  const approveOpening = reviewerPage.waitForResponse(
    (response) => new URL(response.url()).pathname === '/acc/opening/approve',
  )
  await pending.getByRole('button', { name: '批准' }).click()
  const approvedOpeningBody = await (await approveOpening).json()
  expect(approvedOpeningBody.code, JSON.stringify(approvedOpeningBody)).toBe(0)
  await expect(pending).toContainText('已批准')

  await reviewerPage.goto('/acc/period')
  const period = reviewerPage.getByRole('region', { name: '会计期间' })
  await period.getByLabel('账簿').selectOption(facts.book.id)
  await period.getByLabel('期间').fill(facts.book.startMonth)
  await clickForTargetResponse(
    reviewerPage,
    '/acc/period/lock',
    period.getByRole('button', { name: '锁定期间', exact: true }),
  )
  await expect(reviewerPage.getByRole('status')).toContainText(
    '会计期间已锁定。',
  )
  const locked = period
    .getByTestId('acc-period')
    .filter({ hasText: facts.book.startMonth })
  await expect(locked).toContainText('已锁定')
  await clickForTargetResponse(
    reviewerPage,
    '/acc/period/unlock',
    locked.getByRole('button', { name: '解锁', exact: true }),
  )
  await expect(reviewerPage.getByRole('status')).toContainText(
    '会计期间已解锁。',
  )
  await expect(locked).toContainText('未锁定')
  await reviewerContext.close()
  await submitterContext.close()
})

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
    await clickForTargetResponse(
      submitterPage,
      '/vou/sale-order/submit-new',
      rootDraft.draft.getByRole('button', { name: '提交', exact: true }),
    )
    const rootSubmission = rootDraft.region
      .getByTestId('vou-submission')
      .filter({ hasText: '待批准' })
      .first()
    const rootSubmissionId = requiredString(
      await rootSubmission.getAttribute('data-vou-submission-id'),
      'WFL 根销售订单提交标识',
    )
    const rootDocumentId = requiredString(
      await rootSubmission.getAttribute('data-vou-document-id'),
      'WFL 根销售订单标识',
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
    const definitions = submitterPage.getByRole('region', {
      name: '流程定义维护',
    })
    await definitions.getByRole('button', { name: '新建本地流程草稿' }).click()
    const draft = definitions.getByTestId('wfl-local-draft')
    const definitionSubmissionId = requiredString(
      await draft.getAttribute('data-wfl-submission-id'),
      '流程定义提交件标识',
    )
    await draft
      .getByLabel('脚本')
      .fill(
        `root = node(key="root", name="销售订单", entity="sale-order")\n` +
          `outbound = node(key="outbound", name="销售出库", entity="sale-outbound")\n` +
          `delivery = node(key="delivery", name="销售送货", entity="sale-delivery")\n` +
          `workflow(code="local-flow", name="本地流程", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${rootLineId}","baseQuantity":"1"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${rootLineId}","baseQuantity":"1"}]}))])`,
      )
    await draft.getByLabel('试运行单据标识').fill(rootDocumentId)
    await draft.getByRole('button', { name: '保存到本机' }).click()
    await submitterPage.reload()
    await expect(definitions.getByTestId('wfl-local-draft')).toHaveCount(1)
    const trial = submitterPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/wfl/process-definition/trial',
    )
    await definitions
      .getByTestId('wfl-local-draft')
      .getByRole('button', { name: '试运行' })
      .click()
    expect((await (await trial).json()).code).toBe(0)
    await expect(definitions.getByTestId('wfl-local-draft')).toContainText(
      '已通过',
    )
    const submit = submitterPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        '/dcl/wfl-process-definition/submit-new',
    )
    await definitions
      .getByTestId('wfl-local-draft')
      .getByRole('button', { name: '提交', exact: true })
      .click()
    expect((await (await submit).json()).code).toBe(0)
    await expect(definitions.getByTestId('wfl-local-draft')).toHaveCount(0)

    await signIn(
      reviewerPage,
      process.env.TARGET_E2E_REVIEWER_USERNAME!,
      process.env.TARGET_E2E_REVIEWER_PASSWORD!,
      '/dcl/wfl-process-definition',
    )
    const reviewDefinitions = reviewerPage.getByRole('region', {
      name: '流程定义维护',
    })
    const definition = reviewDefinitions.locator(
      `[data-wfl-submission-id="${definitionSubmissionId}"]`,
    )
    await definition.getByLabel('审批原因').fill('流程定义驳回验证')
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
    const current = reviewerPage.getByRole('region', { name: '当前流程定义' })
    const currentDefinition = current
      .getByTestId('wfl-current-definition')
      .filter({ hasText: '本地流程' })
    await expect(currentDefinition).toBeVisible()
    await currentDefinition.getByRole('button', { name: '查看详情' }).click()
    await expect(current.locator('pre')).toContainText('local-flow')

    await reviewerPage.goto('/vou/sale-order')
    const rootForApproval = vouRegion(reviewerPage).locator(
      `[data-testid="vou-submission"][data-vou-document-id="${rootDocumentId}"]`,
    )
    await clickForTargetResponse(
      reviewerPage,
      '/vou/sale-order/approve',
      rootForApproval.getByRole('button', { name: '批准', exact: true }),
    )
    await expect(rootForApproval).toContainText('已批准')

    await submitterPage.goto('/wfl/process-instance')
    const instances = submitterPage.getByRole('region', { name: '流程实例' })
    const instance = instances
      .getByTestId('wfl-instance')
      .filter({ hasText: '本地流程' })
    await instance.getByRole('button', { name: '查看实例' }).click()
    const detail = instances.getByTestId('wfl-instance-detail')
    const root = detail.locator('fieldset').filter({ hasText: '销售订单' })
    await clickForTargetResponse(
      submitterPage,
      '/wfl/process-instance/action',
      root.getByRole('button', { name: '打开单据' }),
    )
    await clickForTargetResponse(
      submitterPage,
      '/wfl/process-instance/action',
      root.getByRole('button', { name: '创建 销售出库' }),
    )

    await reviewerPage.goto('/wfl/process-instance')
    const reviewerInstances = reviewerPage.getByRole('region', {
      name: '流程实例',
    })
    await reviewerInstances
      .getByTestId('wfl-instance')
      .filter({ hasText: '本地流程' })
      .getByRole('button', { name: '查看实例' })
      .click()
    let reviewerDetail = reviewerInstances.getByTestId('wfl-instance-detail')
    let outbound = reviewerDetail
      .locator('fieldset')
      .filter({ hasText: '销售出库' })
    await clickForTargetResponse(
      reviewerPage,
      '/wfl/process-instance/action',
      outbound.getByRole('button', { name: '批准下游单据' }),
    )

    await submitterPage.goto('/wfl/process-instance')
    const submitterInstances = submitterPage.getByRole('region', {
      name: '流程实例',
    })
    await submitterInstances
      .getByTestId('wfl-instance')
      .filter({ hasText: '本地流程' })
      .getByRole('button', { name: '查看实例' })
      .click()
    const submitterDetail = submitterInstances.getByTestId(
      'wfl-instance-detail',
    )
    const approvedOutbound = submitterDetail
      .locator('fieldset')
      .filter({ hasText: '销售出库' })
    await clickForTargetResponse(
      submitterPage,
      '/wfl/process-instance/action',
      approvedOutbound.getByRole('button', { name: '创建 销售送货' }),
    )

    await reviewerPage.goto('/wfl/process-instance')
    await reviewerInstances
      .getByTestId('wfl-instance')
      .filter({ hasText: '本地流程' })
      .getByRole('button', { name: '查看实例' })
      .click()
    reviewerDetail = reviewerInstances.getByTestId('wfl-instance-detail')
    let delivery = reviewerDetail
      .locator('fieldset')
      .filter({ hasText: '销售送货' })
    await delivery.getByLabel('原因').fill('流程节点驳回验证')
    await clickForTargetResponse(
      reviewerPage,
      '/wfl/process-instance/action',
      delivery.getByRole('button', { name: '驳回下游单据' }),
    )
    delivery = reviewerDetail
      .locator('fieldset')
      .filter({ hasText: '销售送货' })
    await clickForTargetResponse(
      reviewerPage,
      '/wfl/process-instance/action',
      delivery.getByRole('button', { name: '重新提交下游单据' }),
    )
    delivery = reviewerDetail
      .locator('fieldset')
      .filter({ hasText: '销售送货' })
    await delivery.getByLabel('原因').fill('流程节点取消验证')
    await clickForTargetResponse(
      reviewerPage,
      '/wfl/process-instance/action',
      delivery.getByRole('button', { name: '驳回下游单据' }),
    )

    await submitterPage.goto('/wfl/process-instance')
    await submitterInstances
      .getByTestId('wfl-instance')
      .filter({ hasText: '本地流程' })
      .getByRole('button', { name: '查看实例' })
      .click()
    const cancelDelivery = submitterInstances
      .getByTestId('wfl-instance-detail')
      .locator('fieldset')
      .filter({ hasText: '销售送货' })
    await clickForTargetResponse(
      submitterPage,
      '/wfl/process-instance/action',
      cancelDelivery.getByRole('button', { name: '取消下游单据' }),
    )
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

test('browser runs the shared model corpus and preserves the APP foundation', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )
  const corpus = JSON.parse(
    (await page.getByTestId('model-corpus').textContent()) ?? '{}',
  )
  expect(corpus.pendingView.availableActions).toEqual(['reject', 'approve'])
  expect(corpus.stale.error.errorKey).toBe('approval_stale_revision')

  await page.getByRole('button', { name: '查询用户' }).click()
  await expect(page.getByRole('status')).toContainText('已查询')
  await expect(page.getByRole('list', { name: '用户列表' })).toContainText(
    process.env.TARGET_E2E_USERNAME!,
  )
})

test('Operating Entity local Draft drives the complete target archive lifecycle', async ({
  browser,
}) => {
  const submitterContext = await browser.newContext()
  const submitterPage = await submitterContext.newPage()
  await signIn(
    submitterPage,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )
  const submitterRegion = submitterPage.getByRole('region', {
    name: '目标业务档案',
  })
  await submitterRegion.getByRole('button', { name: '新建本地草稿' }).click()
  await submitterRegion
    .getByRole('button', { name: '提交', exact: true })
    .click()
  await expect(submitterPage.getByRole('status')).toContainText(
    '已提交，状态以服务器返回为准',
  )
  const createdV1 = submitterRegion
    .locator('[data-archive-submission-id]')
    .filter({ hasText: '待批准' })
    .last()
  const v1SubmissionId = requiredString(
    await createdV1.getAttribute('data-archive-submission-id'),
    '经营主体 V1 提交件标识',
  )
  const submitterV1 = submitterRegion.locator(
    `[data-archive-submission-id="${v1SubmissionId}"]`,
  )
  await expect(submitterV1).toContainText('待批准')
  await expect(submitterV1.getByRole('button', { name: '撤回' })).toBeVisible()

  const reviewerContext = await browser.newContext()
  const reviewerPage = await reviewerContext.newPage()
  await signIn(
    reviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  const reviewerRegion = reviewerPage.getByRole('region', {
    name: '目标业务档案',
  })
  const reviewerV1 = () =>
    reviewerRegion.locator(`[data-archive-submission-id="${v1SubmissionId}"]`)
  await queryArchiveEntity(reviewerPage, 'operating-entity')
  await reviewerRegion.getByLabel('审批原因').fill('经营主体页面驳回验证')
  await reviewerV1().getByRole('button', { name: '驳回' }).click()
  await expect(reviewerV1()).toContainText('已驳回')
  await reviewerV1().getByRole('button', { name: '恢复审核' }).click()
  await expect(reviewerV1()).toContainText('待批准')
  await reviewerV1().getByRole('button', { name: '批准' }).click()
  await expect(reviewerRegion).toContainText('当前正式版本')

  await submitterPage.reload()
  await queryArchiveEntity(submitterPage, 'operating-entity')
  await submitterRegion
    .locator(`[data-archive-submission-id="${v1SubmissionId}"]`)
    .getByRole('button', { name: '克隆为本地草稿' })
    .click()
  const draftEditor = submitterRegion.getByLabel('法定名称')
  await draftEditor.fill('新经营主体二期')
  await draftEditor.blur()
  await submitterRegion
    .getByRole('button', { name: '提交', exact: true })
    .click()
  const createdV2 = submitterRegion
    .locator('[data-archive-submission-id]')
    .filter({ hasText: '待批准' })
    .last()
  const v2SubmissionId = requiredString(
    await createdV2.getAttribute('data-archive-submission-id'),
    '经营主体 V2 提交件标识',
  )
  await expect(createdV2).toContainText('V2')

  await reviewerPage.reload()
  await queryArchiveEntity(reviewerPage, 'operating-entity')
  const reviewerV2 = () =>
    reviewerRegion.locator(`[data-archive-submission-id="${v2SubmissionId}"]`)
  await reviewerV2().getByRole('button', { name: '批准' }).click()
  await expect(reviewerRegion).toContainText('当前正式版本')
  await reviewerRegion.getByLabel('审批原因').fill('经营主体页面回落验证')
  await reviewerV2().getByRole('button', { name: '反批准' }).click()
  await expect(reviewerPage.getByRole('status')).toContainText('已反批准')
  await expect(reviewerV2()).toContainText('待批准')
  await expect(reviewerV1()).toContainText('已批准')

  await submitterPage.reload()
  await queryArchiveEntity(submitterPage, 'operating-entity')
  await submitterRegion
    .locator(`[data-archive-submission-id="${v2SubmissionId}"]`)
    .getByRole('button', { name: '撤回' })
    .click()
  await expect(
    submitterRegion.locator(`[data-archive-submission-id="${v2SubmissionId}"]`),
  ).toHaveCount(0)

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

    const submitterRegion = archiveRegion(submitterPage)
    await submitterRegion.getByRole('button', { name: '新建本地草稿' }).click()
    const operatingEntityDraft = submitterRegion
      .locator('[data-archive-draft-id]')
      .last()
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
    await expect(
      archiveRegion(submitterPage).locator(
        `[data-archive-submission-id="${operatingEntity.submissionId}"]`,
      ),
    ).toContainText('已批准')
    const historyRequests = ['/get', '/versions', '/audit-history'].map(
      (suffix) =>
        submitterPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname ===
              `/dcl/operating-entity${suffix}`,
        ),
    )
    await archiveRegion(submitterPage)
      .locator(`[data-archive-submission-id="${operatingEntity.submissionId}"]`)
      .getByRole('button', { name: '查看详情与历史' })
      .click()
    await Promise.all(historyRequests)
    const history = archiveRegion(submitterPage).getByRole('region', {
      name: '档案详情与历史',
    })
    await expect(
      history.getByRole('list', { name: '档案版本历史' }),
    ).toContainText('V1')
    await expect(
      history.getByRole('list', { name: '档案审计历史' }),
    ).toContainText('已提交')
    await expect(history.getByLabel('V1 快照摘要')).toContainText(
      '统一社会信用代码',
    )
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
        await fillArchiveStructure(
          draft,
          '产品类型引用',
          auxiliaryReference(auxiliaryFacts, 'product-type'),
        )
        await fillArchiveStructure(
          draft,
          '产品分类引用',
          auxiliaryReference(auxiliaryFacts, 'product-category'),
        )
        await fillArchiveStructure(
          draft,
          '计价单位引用',
          auxiliaryReference(auxiliaryFacts, 'measurement-unit'),
        )
        await fillArchiveStructure(
          draft,
          '默认入库单位引用',
          auxiliaryReference(auxiliaryFacts, 'measurement-unit'),
        )
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
        await fillArchiveField(draft, '法定识别号', legalIdentifier)
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

    const mapping = await createAndSubmitArchive(
      submitterPage,
      'acc-mapping',
      async (draft) => {
        await fillArchiveStructure(draft, '账簿引用', accountingFacts.book)
        await fillArchiveStructure(
          draft,
          '凭证类型引用',
          accountingFacts.vouEntity,
        )
      },
    )
    for (const targetPage of [submitterPage, reviewerPage]) {
      const mappingRegion = await selectArchiveEntity(targetPage, 'acc-mapping')
      await mappingRegion
        .getByLabel('账簿筛选')
        .selectOption(accountingFacts.book.id)
      await mappingRegion
        .getByLabel('凭证类型筛选')
        .selectOption(accountingFacts.vouEntity.code)
      await queryArchiveEntity(targetPage, 'acc-mapping')
    }
    await exerciseArchiveLifecycle(
      submitterPage,
      reviewerPage,
      'acc-mapping',
      mapping,
    )
    await submitterPage.goto('/acc/mapping')
    const mappingPage = submitterPage.getByRole('region', {
      name: '当前会计映射',
    })
    await mappingPage.getByLabel('账簿').selectOption(accountingFacts.book.id)
    await mappingPage
      .getByLabel('凭证类型')
      .selectOption(accountingFacts.vouEntity.code)
    await mappingPage.getByRole('button', { name: '查询当前正式映射' }).click()
    const currentMappings = mappingPage.getByRole('list', {
      name: '当前正式映射列表',
    })
    await expect(currentMappings).toContainText(accountingFacts.vouEntity.code)
    await currentMappings
      .getByRole('button')
      .filter({ hasText: accountingFacts.vouEntity.code })
      .click()
    await expect(mappingPage).toContainText('正式版本：')

    await mappingPage.getByRole('link', { name: '维护记账映射' }).click()
    await expect(submitterPage).toHaveURL(/\/dcl\/acc-mapping$/)

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
    await expect(
      archiveRegion(submitterPage).locator(
        `[data-archive-submission-id="${report.submissionId}"]`,
      ),
    ).toContainText('技术有效')

    const reportCode = requiredString(report.code, '报表定义编码')
    const deepLinkQuery = submitterPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/dcl/rpt-definition/query',
      { timeout: 5_000 },
    )
    const deepLinkGet = submitterPage.waitForResponse(
      (response) => {
        if (
          response.request().method() !== 'POST' ||
          new URL(response.url()).pathname !== '/dcl/rpt-definition/get'
        )
          return false
        const body = response.request().postDataJSON() as Record<
          string,
          unknown
        >
        return body.approvalEntryId === report.submissionId
      },
      { timeout: 5_000 },
    )
    await submitterPage.goto(
      `/dcl/rpt-definition?code=${encodeURIComponent(reportCode)}&approvalEntryId=${encodeURIComponent(report.submissionId)}`,
    )
    const [queryResponse, getResponse] = await Promise.all([
      deepLinkQuery,
      deepLinkGet,
    ])
    expect(queryResponse.ok()).toBe(true)
    expect(getResponse.ok()).toBe(true)
    const deepLinkedHistory = archiveRegion(submitterPage).getByRole('region', {
      name: '档案详情与历史',
    })
    await expect(deepLinkedHistory).toContainText(`${reportCode} · V1`)
    await expect(deepLinkedHistory.getByLabel('档案快照摘要')).toContainText(
      `测试报表-${runId.slice(0, 6)}`,
    )
  } finally {
    await reviewerContext.close()
    await submitterContext.close()
  }
})

test('offline Warehouse Draft reloads locally and drives the complete Submission lifecycle', async ({
  browser,
}) => {
  const submitterContext = await browser.newContext()
  const submitterPage = await submitterContext.newPage()
  await signIn(
    submitterPage,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )

  await submitterContext.setOffline(true)
  await submitterPage.getByRole('button', { name: '新建仓库草稿' }).click()
  await submitterPage.getByLabel('仓库名称').fill('离线一号仓')
  await submitterPage.getByLabel('地址').fill('本机离线地址')
  await submitterPage
    .getByLabel('负责人标识')
    .fill(process.env.TARGET_E2E_MANAGER_EMPLOYEE_ID!)
  await submitterPage
    .getByLabel('负责人批准版本')
    .fill(process.env.TARGET_E2E_STALE_MANAGER_APPROVAL_ENTRY_ID!)
  await submitterPage.getByLabel('负责人编号').fill('EMP-E2E')
  await submitterPage.getByLabel('负责人姓名').fill('目标负责人')
  await expect(submitterPage.getByRole('status')).toContainText(
    '草稿已保存在当前设备',
  )
  await submitterContext.setOffline(false)
  await replaceSession(
    submitterContext,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  await submitterPage.reload()
  await expect(
    submitterPage
      .getByRole('region', { name: '本地仓库草稿' })
      .locator('article'),
  ).toHaveCount(0)
  await replaceSession(
    submitterContext,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )
  await submitterPage.reload()
  await expect(submitterPage.getByLabel('仓库名称')).toHaveValue('离线一号仓')
  await expect(
    submitterPage
      .getByRole('region', { name: '仓库提交件' })
      .locator('article')
      .filter({ hasText: '离线一号仓' }),
  ).toHaveCount(0)

  await submitterPage
    .getByRole('region', { name: '本地仓库草稿' })
    .getByRole('button', { name: '提交' })
    .click()
  await expect(submitterPage.getByRole('status')).toContainText(
    'warehouse_reference_stale',
  )
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
  await submitterPage.reload()
  await submitterPage
    .getByLabel('负责人批准版本')
    .fill(process.env.TARGET_E2E_MANAGER_APPROVAL_ENTRY_ID!)

  await submitterPage
    .getByRole('region', { name: '本地仓库草稿' })
    .getByRole('button', { name: '提交' })
    .click()
  await expect(submitterPage.getByRole('status')).toContainText('已提交 WHS-')
  const createdWarehouseV1 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('[data-submission-id]')
    .filter({ hasText: '离线一号仓' })
  const warehouseV1SubmissionId = requiredString(
    await createdWarehouseV1.getAttribute('data-submission-id'),
    '仓库 V1 提交件标识',
  )
  const pendingV1 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator(`[data-submission-id="${warehouseV1SubmissionId}"]`)
  await expect(pendingV1).toContainText('离线一号仓')
  await expect(pendingV1.getByRole('button', { name: '撤回' })).toBeVisible()
  await expect(pendingV1.getByRole('button', { name: '批准' })).toHaveCount(0)
  await expect(pendingV1.getByRole('button', { name: '驳回' })).toHaveCount(0)

  const reviewerContext = await browser.newContext()
  const reviewerPage = await reviewerContext.newPage()
  await signIn(
    reviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  const reviewerV1 = () =>
    reviewerPage
      .getByRole('region', { name: '仓库提交件' })
      .locator(`[data-submission-id="${warehouseV1SubmissionId}"]`)
  await expect(reviewerV1().getByRole('button', { name: '撤回' })).toHaveCount(
    0,
  )

  const staleReviewerContext = await browser.newContext()
  const staleReviewerPage = await staleReviewerContext.newPage()
  await signIn(
    staleReviewerPage,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  await reviewerPage
    .getByRole('region', { name: '仓库提交件' })
    .getByLabel('审批原因')
    .fill('页面驳回验证')
  await reviewerV1().getByRole('button', { name: '驳回' }).click()
  await expect(reviewerV1()).toContainText('已驳回')
  await expect(reviewerV1()).toContainText('页面驳回验证')
  await staleReviewerPage
    .getByRole('region', { name: '仓库提交件' })
    .locator(`[data-submission-id="${warehouseV1SubmissionId}"]`)
    .getByRole('button', { name: '批准', exact: true })
    .click()
  await expect(staleReviewerPage.getByRole('status')).toContainText(
    '提交件已被其他操作更新，请重新加载。',
  )
  await staleReviewerContext.close()

  await submitterPage.reload()
  await expect(
    submitterPage
      .getByRole('region', { name: '仓库提交件' })
      .locator(`[data-submission-id="${warehouseV1SubmissionId}"]`),
  ).toBeVisible()
  await expect(
    submitterPage.getByRole('button', { name: '恢复审核' }),
  ).toHaveCount(0)

  await reviewerV1().getByRole('button', { name: '恢复审核' }).click()
  await expect(reviewerV1()).toContainText('待批准')
  await reviewerV1().getByRole('button', { name: '批准' }).click()
  await expect(reviewerV1()).toContainText('已批准')

  await submitterPage.reload()
  const approvedV1 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator(`[data-submission-id="${warehouseV1SubmissionId}"]`)
  await expect(approvedV1.getByRole('button', { name: '反批准' })).toHaveCount(
    0,
  )
  await approvedV1.getByRole('button', { name: '克隆为本地草稿' }).click()
  await submitterPage.getByLabel('仓库名称').fill('变更二号仓')
  await submitterPage
    .getByRole('region', { name: '本地仓库草稿' })
    .getByRole('button', { name: '提交' })
    .click()
  let pendingV2 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('article')
    .filter({ hasText: 'V2 · 待批准' })
  await expect(pendingV2).toContainText('变更二号仓')

  await pendingV2.getByRole('button', { name: '撤回' }).click()
  await expect(pendingV2).toHaveCount(0)
  await approvedV1.getByRole('button', { name: '克隆为本地草稿' }).click()
  await submitterPage.getByLabel('仓库名称').fill('复用 V2 仓')
  await submitterPage
    .getByRole('region', { name: '本地仓库草稿' })
    .getByRole('button', { name: '提交' })
    .click()
  const createdWarehouseV2 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('[data-submission-id]')
    .filter({ hasText: '复用 V2 仓' })
  const warehouseV2SubmissionId = requiredString(
    await createdWarehouseV2.getAttribute('data-submission-id'),
    '仓库 V2 提交件标识',
  )
  pendingV2 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator(`[data-submission-id="${warehouseV2SubmissionId}"]`)
  await expect(pendingV2).toContainText('复用 V2 仓')

  await reviewerPage.reload()
  const reviewerV2 = () =>
    reviewerPage
      .getByRole('region', { name: '仓库提交件' })
      .locator(`[data-submission-id="${warehouseV2SubmissionId}"]`)
  await reviewerV2().getByRole('button', { name: '批准' }).click()
  await expect(reviewerV2()).toContainText('V2 · 已批准')
  await reviewerPage
    .getByRole('region', { name: '仓库提交件' })
    .getByLabel('审批原因')
    .fill('页面回落验证')
  await reviewerV2().getByRole('button', { name: '反批准' }).click()
  await expect(reviewerV2()).toContainText('V2 · 待批准')
  await expect(
    reviewerPage
      .getByRole('region', { name: '仓库提交件' })
      .locator(`[data-submission-id="${warehouseV1SubmissionId}"]`),
  ).toBeVisible()

  await reviewerContext.close()
  await submitterContext.close()
})
