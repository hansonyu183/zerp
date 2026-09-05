import { computed, ref } from 'vue'

import {
  accSubjectDimensions,
  vouEntities,
  vouEntityInputDescriptors,
  type AccSubjectDimension,
  type ApprovalAction,
  type VouEntity,
} from '@zerp/model'

import {
  deleteTargetArchive,
  getTargetArchive,
  queryTargetAccMappingCatalog,
  queryTargetArchive,
  reviewTargetArchive,
  submitTargetArchive,
  targetArchiveAuditHistory,
  targetArchiveVersions,
  type TargetArchiveDeleteRequest,
  type TargetArchiveQueryRequest,
  type TargetArchiveReviewRequest,
  type TargetArchiveSubmitRequest,
} from '../../../api.ts'
import {
  archiveSubmitRequest,
  cloneArchiveDraft,
  createArchiveDraft,
  type ArchiveDraft,
} from '../../../archive-drafts.ts'
import {
  parseArchiveQueryPage,
  parseArchiveSubmission,
  parseArchiveSubmissionPage,
  type ArchiveSubmissionListView,
  type ArchiveSubmissionView,
} from '../../../archive-view.ts'
import { TargetDraftRepository } from '../../../draft-storage.ts'
import { useTargetSession } from '../../../session/vm.ts'
import type { DclWorkbenchDeepLink } from '../shared/vm.ts'

export type AccMappingDraft = ArchiveDraft<'acc-mapping'>
export type AccMappingCatalog = Awaited<
  ReturnType<typeof queryTargetAccMappingCatalog>
>
type MappingTemplate =
  AccMappingDraft['snapshot']['definition']['templates'][number]
type MappingLine = MappingTemplate['lines'][number]
type MappingCondition =
  AccMappingDraft['snapshot']['definition']['rules'][number]['conditions'][number]
type AssetSubjectKind =
  | 'assetSubject'
  | 'accumulatedDepreciationSubject'
  | 'depreciationExpenseSubject'

export interface DclAccMappingContext {
  ownerUserId: string
  csrfToken: string
  permissions: readonly string[]
}

export interface DclAccMappingPorts {
  drafts: {
    list(ownerUserId: string, entity: 'acc-mapping'): Promise<AccMappingDraft[]>
    save(draft: AccMappingDraft): Promise<void>
    delete(
      ownerUserId: string,
      entity: 'acc-mapping',
      draftId: string,
    ): Promise<void>
  }
  query(
    csrfToken: string,
    request: TargetArchiveQueryRequest,
  ): Promise<{ submissions: ArchiveSubmissionListView[]; total: number }>
  get(
    csrfToken: string,
    entity: 'acc-mapping',
    subjectId: string,
  ): Promise<ArchiveSubmissionView>
  versions(
    csrfToken: string,
    subjectId: string,
  ): Promise<ArchiveSubmissionView[]>
  audit(csrfToken: string, subjectId: string): Promise<unknown>
  submit(csrfToken: string, request: TargetArchiveSubmitRequest): Promise<void>
  review(csrfToken: string, request: TargetArchiveReviewRequest): Promise<void>
  deleteSubmission(
    csrfToken: string,
    request: TargetArchiveDeleteRequest,
  ): Promise<void>
  catalog(csrfToken: string): Promise<AccMappingCatalog>
}

export function createDclAccMappingViewModel(
  context: DclAccMappingContext,
  ports: DclAccMappingPorts,
) {
  const drafts = ref<AccMappingDraft[]>([])
  const submissions = ref<ArchiveSubmissionListView[]>([])
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)
  const reason = ref('')
  const catalog = ref<AccMappingCatalog>({
    books: [],
    vouEntities: [],
    subjects: [],
  })
  const detail = ref<{
    submission: ArchiveSubmissionView
    versions: ArchiveSubmissionView[]
    audit: unknown
  } | null>(null)
  let queryVersion = 0
  let catalogVersion = 0
  let detailVersion = 0

  const canCreate = computed(() =>
    context.permissions.includes('/dcl/acc-mapping/submit-new'),
  )

  async function loadDrafts(): Promise<void> {
    drafts.value = await ports.drafts.list(context.ownerUserId, 'acc-mapping')
  }

  async function loadCatalog(): Promise<void> {
    if (!context.permissions.includes('/acc/mapping/catalog')) return
    const version = ++catalogVersion
    try {
      const result = await ports.catalog(context.csrfToken)
      if (version === catalogVersion) catalog.value = result
    } catch (cause) {
      if (version === catalogVersion)
        error.value = errorMessage(cause, '会计映射字段目录加载失败。')
    }
  }

  function subjectsFor(draft: AccMappingDraft) {
    return catalog.value.subjects.filter(
      (subject) => subject.bookId === draft.snapshot.book.id,
    )
  }

  function selectBook(draft: AccMappingDraft, bookId: string): void {
    const book = catalog.value.books.find((item) => item.id === bookId)
    if (!book) return
    draft.snapshot.book = { id: book.id, code: book.code, name: book.name }
  }

  function selectVouEntity(draft: AccMappingDraft, vouEntityId: string): void {
    const entity = catalog.value.vouEntities.find(
      (item) => item.id === vouEntityId,
    )
    if (!entity) return
    draft.snapshot.vouEntity = {
      id: entity.id,
      code: entity.code,
      name: entity.name,
    }
  }

  function fieldsFor(draft: AccMappingDraft): string[] {
    const vouEntity = catalog.value.vouEntities.find(
      (item) => item.id === draft.snapshot.vouEntity.id,
    )
    return vouEntity
      ? [
          ...vouEntity.fieldCatalog.headerFields,
          ...vouEntity.fieldCatalog.lineFields,
        ]
      : []
  }

  function collectionOptions(draft: AccMappingDraft): string[] {
    const code = draft.snapshot.vouEntity.code
    if (!isVouEntity(code)) return []
    return vouEntityInputDescriptors[code]
      .filter((field) => field.kind === 'array' && field.key !== 'attachments')
      .map((field) => field.key)
  }

  function templateOptions(
    draft: AccMappingDraft,
  ): { title: string; value: string }[] {
    return draft.snapshot.definition.templates.map((template, index) => ({
      title: `模板 ${index + 1}`,
      value: template.templateId,
    }))
  }

  function selectFixedSubject(
    draft: AccMappingDraft,
    line: MappingLine,
    subjectId: string,
  ): void {
    line.subjectValue = subjectId
    const subject = subjectsFor(draft).find((item) => item.id === subjectId)
    line.dimensions = Object.fromEntries(
      (subject?.requiredDimensions ?? []).map((dimension) => [dimension, '']),
    )
  }

  function selectCostCounterpartSubject(
    draft: AccMappingDraft,
    line: MappingLine,
    subjectId: string | null,
  ): void {
    line.costCounterpartSubjectId = subjectId
    const subject = subjectId
      ? subjectsFor(draft).find((item) => item.id === subjectId)
      : undefined
    line.costCounterpartDimensions = Object.fromEntries(
      (subject?.requiredDimensions ?? []).map((dimension) => [dimension, '']),
    )
  }

  function setLineDimensions(
    line: MappingLine,
    dimensions: readonly string[],
  ): void {
    line.dimensions = Object.fromEntries(
      dimensions
        .filter(isAccSubjectDimension)
        .map((dimension) => [dimension, line.dimensions[dimension] ?? '']),
    )
  }

  function setAssetConfiguration(
    draft: AccMappingDraft,
    enabled: boolean,
  ): void {
    draft.snapshot.definition.assetConfiguration = enabled
      ? {
          assetSubjectId: '',
          assetDimensions: {},
          accumulatedDepreciationSubjectId: '',
          accumulatedDepreciationDimensions: {},
          depreciationExpenseSubjectId: '',
          depreciationExpenseDimensions: {},
        }
      : null
  }

  function selectAssetSubject(
    draft: AccMappingDraft,
    kind: AssetSubjectKind,
    subjectId: string,
  ): void {
    const configuration = draft.snapshot.definition.assetConfiguration
    if (!configuration) return
    const subject = subjectsFor(draft).find((item) => item.id === subjectId)
    const dimensions = Object.fromEntries(
      (subject?.requiredDimensions ?? []).map((dimension) => [dimension, '']),
    )
    if (kind === 'assetSubject') {
      configuration.assetSubjectId = subjectId
      configuration.assetDimensions = dimensions
    } else if (kind === 'accumulatedDepreciationSubject') {
      configuration.accumulatedDepreciationSubjectId = subjectId
      configuration.accumulatedDepreciationDimensions = dimensions
    } else {
      configuration.depreciationExpenseSubjectId = subjectId
      configuration.depreciationExpenseDimensions = dimensions
    }
  }

  async function query(nextPage = page.value): Promise<void> {
    if (!context.permissions.includes('/dcl/acc-mapping/query')) return
    const version = ++queryVersion
    loading.value = true
    try {
      const result = await ports.query(context.csrfToken, {
        entity: 'acc-mapping',
        input: { page: nextPage, pageSize: 20, filters: {} },
      })
      if (version !== queryVersion) return
      submissions.value = result.submissions
      total.value = result.total
      page.value = nextPage
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '会计映射候选查询失败。')
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function newDraft(): Promise<void> {
    if (!canCreate.value) {
      error.value = '没有权限新建会计映射草稿。'
      return
    }
    const draft = accMappingDraft(
      createArchiveDraft(context.ownerUserId, 'acc-mapping'),
    )
    await ports.drafts.save(draft)
    drafts.value = [draft, ...drafts.value]
  }

  async function saveDraft(draft: AccMappingDraft): Promise<void> {
    draft.updatedAt = new Date().toISOString()
    await ports.drafts.save(draft)
    message.value = '草稿已保存在当前设备。'
  }

  async function createChange(item: ArchiveSubmissionListView): Promise<void> {
    if (
      item.status !== 'APPROVED' ||
      !context.permissions.includes('/dcl/acc-mapping/submit-change')
    ) {
      error.value = '只能基于已批准版本创建变更草稿。'
      return
    }
    try {
      const detail = await ports.get(
        context.csrfToken,
        'acc-mapping',
        item.subjectId,
      )
      if (detail.submissionId !== item.submissionId)
        throw new Error('正式版本已变化，请刷新后重试。')
      const draft = accMappingDraft(
        cloneArchiveDraft(
          context.ownerUserId,
          'acc-mapping',
          item.subjectId,
          detail.snapshot,
          { submissionId: item.submissionId, revision: item.revision },
        ),
      )
      await ports.drafts.save(draft)
      drafts.value = [draft, ...drafts.value]
    } catch (cause) {
      error.value = errorMessage(cause, '创建变更草稿失败。')
    }
  }

  function addTemplate(draft: AccMappingDraft): void {
    const next = draft.snapshot.definition.templates.length + 1
    const template: MappingTemplate = {
      templateId: `template-${next}`,
      collection: null,
      lines: [],
    }
    draft.snapshot.definition = {
      ...draft.snapshot.definition,
      templates: [...draft.snapshot.definition.templates, template],
    }
  }

  function addTemplateLine(
    draft: AccMappingDraft,
    templateIndex: number,
  ): void {
    const template = draft.snapshot.definition.templates[templateIndex]
    if (!template) return
    const line: MappingLine = {
      subjectSource: 'FIXED',
      subjectValue: '',
      direction: template.lines.length % 2 === 0 ? 'DEBIT' : 'CREDIT',
      amountField: '',
      currencyField: '',
      dimensions: {},
      quantityField: null,
      costCounterpartSubjectId: null,
      costCounterpartDimensions: {},
    }
    const templates = [...draft.snapshot.definition.templates]
    templates[templateIndex] = { ...template, lines: [...template.lines, line] }
    draft.snapshot.definition = { ...draft.snapshot.definition, templates }
  }

  function addRule(draft: AccMappingDraft): void {
    const condition: MappingCondition = {
      field: '',
      operator: 'EQ',
      values: [],
    }
    draft.snapshot.definition = {
      ...draft.snapshot.definition,
      rules: [
        ...draft.snapshot.definition.rules,
        { conditions: [condition], result: 'POST', templateId: null },
      ],
    }
  }

  function setDefaultResult(
    draft: AccMappingDraft,
    result: AccMappingDraft['snapshot']['defaultResult'],
  ): void {
    draft.snapshot.defaultResult = result
    if (result === 'UN_POST') draft.snapshot.definition.defaultTemplateId = null
  }

  function setSubjectSource(
    line: MappingLine,
    source: MappingLine['subjectSource'],
  ): void {
    line.subjectSource = source
    line.subjectValue = ''
    line.dimensions = {}
  }

  function validationError(draft: AccMappingDraft): string | null {
    if (!draft.snapshot.book.id) return '请选择会计账簿。'
    if (!draft.snapshot.vouEntity.id) return '请选择 VOU 单据类型。'
    if (
      draft.snapshot.defaultResult === 'POST' &&
      !draft.snapshot.definition.defaultTemplateId
    )
      return '默认生成凭证时必须指定默认模板。'
    if (
      draft.snapshot.definition.templates.some(
        (template) => template.lines.length < 2,
      )
    )
      return '每个凭证模板至少需要两条分录。'
    const asset = draft.snapshot.definition.assetConfiguration
    if (
      asset &&
      (!asset.assetSubjectId ||
        !asset.accumulatedDepreciationSubjectId ||
        !asset.depreciationExpenseSubjectId ||
        [
          asset.assetDimensions,
          asset.accumulatedDepreciationDimensions,
          asset.depreciationExpenseDimensions,
        ].some((dimensions) =>
          Object.values(dimensions).some((value) => !value),
        ))
    )
      return '固定资产三科目及其核算维度字段必须完整。'
    return null
  }

  async function submitDraft(draft: AccMappingDraft): Promise<void> {
    const permission = `/dcl/acc-mapping/submit-${draft.mode === 'NEW' ? 'new' : 'change'}`
    if (!context.permissions.includes(permission)) {
      error.value = '没有权限提交会计映射草稿。'
      return
    }
    const invalid = validationError(draft)
    if (invalid) {
      error.value = invalid
      return
    }
    saving.value = true
    try {
      await ports.drafts.save(draft)
      await ports.submit(context.csrfToken, archiveSubmitRequest(draft))
      await ports.drafts.delete(draft.ownerUserId, 'acc-mapping', draft.draftId)
      drafts.value = drafts.value.filter(
        (item) => item.draftId !== draft.draftId,
      )
      message.value = '会计映射已提交，状态以服务器返回为准。'
      error.value = null
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '提交失败；本地草稿已保留。')
    } finally {
      saving.value = false
    }
  }

  function canReview(
    item: ArchiveSubmissionListView,
    action: ApprovalAction,
  ): boolean {
    return item.availableApprovalActions.includes(action)
  }

  async function openDetail(subjectId: string): Promise<void> {
    const version = ++detailVersion
    try {
      const [submission, versions, audit] = await Promise.all([
        ports.get(context.csrfToken, 'acc-mapping', subjectId),
        ports.versions(context.csrfToken, subjectId),
        ports.audit(context.csrfToken, subjectId),
      ])
      if (version === detailVersion)
        detail.value = { submission, versions, audit }
    } catch (cause) {
      if (version === detailVersion)
        error.value = errorMessage(cause, '会计映射详情加载失败。')
    }
  }

  async function synchronizeDeepLink(
    deepLink: DclWorkbenchDeepLink,
  ): Promise<void> {
    const version = ++detailVersion
    const objectId = deepLink.objectId?.trim()
    const submissionId = deepLink.submissionId?.trim()
    const revision = deepLink.revision?.trim()
    if (!objectId && !submissionId && !revision && !deepLink.mode) {
      detail.value = null
      return
    }
    if (
      !objectId ||
      !submissionId ||
      !revision ||
      (deepLink.mode !== 'view' && deepLink.mode !== 'edit')
    ) {
      error.value = '工作台深链缺少精确会计映射版本上下文。'
      return
    }
    try {
      const [current, versions, audit] = await Promise.all([
        ports.get(context.csrfToken, 'acc-mapping', objectId),
        ports.versions(context.csrfToken, objectId),
        ports.audit(context.csrfToken, objectId),
      ])
      if (version !== detailVersion) return
      const exact = versions.find(
        (candidate) => candidate.submissionId === submissionId,
      )
      if (
        current.subjectId !== objectId ||
        current.submissionId !== submissionId ||
        current.revision !== revision ||
        !exact ||
        exact.revision !== revision
      )
        throw new Error('工作台会计映射版本已变化，请刷新后重试。')
      if (deepLink.mode === 'edit') await createChange(exact)
      else detail.value = { submission: exact, versions, audit }
      error.value = null
    } catch (cause) {
      if (version === detailVersion)
        error.value = errorMessage(cause, '工作台会计映射深链加载失败。')
    }
  }

  async function review(
    item: ArchiveSubmissionListView,
    action: ApprovalAction,
  ): Promise<void> {
    if (!canReview(item, action)) return
    const submittedReason = reason.value.trim()
    if ((action === 'reject' || action === 'unapprove') && !submittedReason) {
      error.value = '请填写审批原因。'
      return
    }
    const identity = {
      subjectId: item.subjectId,
      submissionId: item.submissionId,
      expectedRevision: item.revision,
    }
    let actionError: string | null = null
    try {
      await ports.review(
        context.csrfToken,
        action === 'reject' || action === 'unapprove'
          ? {
              entity: 'acc-mapping',
              action,
              input: { ...identity, reason: submittedReason },
            }
          : { entity: 'acc-mapping', action, input: identity },
      )
    } catch (cause) {
      actionError = errorMessage(cause, '审批动作失败。')
    }
    await query(page.value)
    if (detail.value?.submission.subjectId === item.subjectId)
      await openDetail(item.subjectId)
    if (actionError) error.value = actionError
  }

  async function removeSubmission(
    item: ArchiveSubmissionListView,
  ): Promise<void> {
    if (
      !item.canDelete ||
      !context.permissions.includes('/dcl/acc-mapping/delete')
    )
      return
    await ports.deleteSubmission(context.csrfToken, {
      entity: 'acc-mapping',
      input: {
        subjectId: item.subjectId,
        submissionId: item.submissionId,
        expectedRevision: item.revision,
      },
    })
    await query(page.value)
  }

  return {
    drafts,
    submissions,
    total,
    page,
    loading,
    saving,
    error,
    message,
    reason,
    canCreate,
    catalog,
    detail,
    loadDrafts,
    loadCatalog,
    query,
    newDraft,
    saveDraft,
    createChange,
    addTemplate,
    addTemplateLine,
    addRule,
    setDefaultResult,
    setSubjectSource,
    subjectsFor,
    selectBook,
    selectVouEntity,
    fieldsFor,
    collectionOptions,
    templateOptions,
    selectFixedSubject,
    selectCostCounterpartSubject,
    setLineDimensions,
    setAssetConfiguration,
    selectAssetSubject,
    validationError,
    submitDraft,
    canReview,
    openDetail,
    synchronizeDeepLink,
    review,
    removeSubmission,
  }
}

export const accMappingDimensionOptions = accSubjectDimensions.map((value) => ({
  value,
  title: {
    CUSTOMER_SUBUNIT: '客户子单位',
    SUPPLIER: '供应商',
    OTHER_UNIT: '其他单位',
    EMPLOYEE: '员工',
    SALES_PARTNER: '销售合作方',
    DEPARTMENT: '部门',
    PRODUCT: '产品',
    WAREHOUSE: '仓库',
    FUND_ACCOUNT: '资金账户',
    ASSET: '资产',
    BILL: '票据',
  }[value],
}))

function isVouEntity(value: string): value is VouEntity {
  return vouEntities.some((entity) => entity === value)
}

function isAccSubjectDimension(value: string): value is AccSubjectDimension {
  return accSubjectDimensions.some((dimension) => dimension === value)
}

export function useDclAccMappingViewModel() {
  const session = useTargetSession()
  if (!session.csrfToken || !session.user)
    throw new Error('DCL ACC mapping requires an authenticated session.')
  const repository = new TargetDraftRepository()
  return createDclAccMappingViewModel(
    {
      ownerUserId: session.user.id,
      csrfToken: session.csrfToken,
      permissions: session.permissions,
    },
    {
      drafts: {
        list: (ownerUserId, entity) =>
          repository.list<AccMappingDraft>(ownerUserId, entity),
        save: (draft) => repository.save(draft),
        delete: (ownerUserId, entity, draftId) =>
          repository.delete(ownerUserId, entity, draftId),
      },
      query: async (csrfToken, request) =>
        parseArchiveQueryPage(
          'acc-mapping',
          await queryTargetArchive(csrfToken, request),
        ),
      get: async (csrfToken, entity, subjectId) => {
        const detail = parseArchiveSubmission(
          entity,
          await getTargetArchive(csrfToken, entity, subjectId),
        )
        if (!detail) throw new Error('服务器返回了无效会计映射详情。')
        return detail
      },
      versions: async (csrfToken, subjectId) =>
        parseArchiveSubmissionPage(
          'acc-mapping',
          await targetArchiveVersions(csrfToken, 'acc-mapping', subjectId),
        ),
      audit: (csrfToken, subjectId) =>
        targetArchiveAuditHistory(csrfToken, 'acc-mapping', subjectId),
      submit: async (csrfToken, request) => {
        await submitTargetArchive(csrfToken, request)
      },
      review: async (csrfToken, request) => {
        await reviewTargetArchive(csrfToken, request)
      },
      deleteSubmission: async (csrfToken, request) => {
        await deleteTargetArchive(csrfToken, request)
      },
      catalog: queryTargetAccMappingCatalog,
    },
  )
}

function accMappingDraft(
  draft: ReturnType<typeof createArchiveDraft>,
): AccMappingDraft {
  if (draft.entity !== 'acc-mapping')
    throw new Error('Invalid ACC mapping Draft.')
  return draft
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
