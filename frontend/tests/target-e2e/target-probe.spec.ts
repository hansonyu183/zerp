import { randomBytes } from 'node:crypto'

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'
import { modelBuildId } from '@zerp/model'

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
  expect(payload.code).toBe(0)
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
  await expect(page.getByRole('status')).toContainText('当前用户：')
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

test('VOU stays browser-local until real HTTP submit succeeds', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/vou/sale-pricing')
  await signIn(page, process.env.TARGET_E2E_USERNAME!, process.env.TARGET_E2E_PASSWORD!)
  const region = page.getByRole('region', { name: '目标单据' })
  await expect(region).toContainText('服务器 Submission：0')
  await region.getByRole('button', { name: '新建本地草稿' }).click()
  const draft = region.locator('[data-testid="vou-local-draft"]')
  await expect(draft).toHaveCount(1)
  await draft.getByLabel('金额').fill('88.50')
  await draft.getByRole('button', { name: '保存到本机' }).click()
  await page.reload()
  await expect(region.locator('[data-testid="vou-local-draft"]')).toHaveCount(1)
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/vou/sale-pricing/submit-new')
  await region.getByRole('button', { name: '提交', exact: true }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  expect((await response.json()).code).toBe(0)
  await expect(region.locator('[data-testid="vou-local-draft"]')).toHaveCount(0)
  await expect(region).toContainText('服务器 Submission：1')
  await context.close()
})

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
  const submitterV1 = submitterRegion
    .locator('article')
    .filter({ hasText: 'V1' })
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
    reviewerRegion.locator('article').filter({ hasText: 'V1' })
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
    .locator('article')
    .filter({ hasText: 'V1' })
    .getByRole('button', { name: '克隆为本地草稿' })
    .click()
  const draftEditor = submitterRegion.getByLabel('法定名称')
  await draftEditor.fill('新经营主体二期')
  await draftEditor.blur()
  await submitterRegion
    .getByRole('button', { name: '提交', exact: true })
    .click()
  await expect(
    submitterRegion.locator('article').filter({ hasText: 'V2' }),
  ).toContainText('待批准')

  await reviewerPage.reload()
  await queryArchiveEntity(reviewerPage, 'operating-entity')
  const reviewerV2 = () =>
    reviewerRegion.locator('article').filter({ hasText: 'V2' })
  await reviewerV2().getByRole('button', { name: '批准' }).click()
  await expect(reviewerRegion).toContainText('当前正式版本')
  await reviewerRegion.getByLabel('审批原因').fill('经营主体页面回落验证')
  await reviewerV2().getByRole('button', { name: '反批准' }).click()
  await expect(reviewerPage.getByRole('status')).toContainText('已反批准')
  await expect(reviewerV2()).toContainText('待批准')
  await expect(
    reviewerRegion.locator('article').filter({ hasText: 'V1' }),
  ).toContainText('已批准')

  await submitterPage.reload()
  await queryArchiveEntity(submitterPage, 'operating-entity')
  await submitterRegion
    .locator('article')
    .filter({ hasText: 'V2' })
    .getByRole('button', { name: '撤回' })
    .click()
  await expect(
    submitterRegion.locator('article').filter({ hasText: 'V2' }),
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
      .locator('article'),
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
  const pendingV1 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('article')
    .filter({ hasText: 'V1 · 待批准' })
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
      .locator('article')
      .filter({ hasText: 'V1' })
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
    .locator('article')
    .filter({ hasText: 'V1' })
    .getByRole('button', { name: '批准', exact: true })
    .click()
  await expect(staleReviewerPage.getByRole('status')).toContainText(
    'approval_stale_revision',
  )
  await staleReviewerContext.close()

  await submitterPage.reload()
  await expect(
    submitterPage
      .getByRole('region', { name: '仓库提交件' })
      .locator('article')
      .filter({ hasText: 'V1 · 已驳回' }),
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
    .locator('article')
    .filter({ hasText: 'V1 · 已批准' })
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
  pendingV2 = submitterPage
    .getByRole('region', { name: '仓库提交件' })
    .locator('article')
    .filter({ hasText: 'V2 · 待批准' })
  await expect(pendingV2).toContainText('复用 V2 仓')

  await reviewerPage.reload()
  const reviewerV2 = () =>
    reviewerPage
      .getByRole('region', { name: '仓库提交件' })
      .locator('article')
      .filter({ hasText: 'V2' })
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
      .locator('article')
      .filter({ hasText: 'V1 · 已批准' }),
  ).toBeVisible()

  await reviewerContext.close()
  await submitterContext.close()
})
