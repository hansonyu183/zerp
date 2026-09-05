import { computed, ref } from 'vue'
import type {
  AccSubjectDimension,
  ApprovalAction,
  VouReferenceCandidateEntity,
} from '@zerp/model'
import { accSubjectDimensions } from '@zerp/model'

import {
  deleteTargetAccOpening,
  queryTargetAccBooks,
  queryTargetAccOpening,
  queryTargetAccSubjects,
  queryTargetVouReference,
  reviewTargetAccOpening,
  submitTargetAccOpening,
  TargetApiError,
  type TargetVouReferenceQueryInput,
  type TargetVouReferenceResult,
} from '../../../api.ts'
import {
  TargetDraftRepository,
  type TargetDraftRecord,
} from '../../../draft-storage.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { createTargetId } from '../../../warehouse-drafts.ts'
import type { AccBook } from '../book/vm.ts'
import type { AccSubject } from '../subject/vm.ts'

export type AccOpening = Awaited<ReturnType<typeof queryTargetAccOpening>>
export type AccOpeningSubmitInput = Parameters<typeof submitTargetAccOpening>[1]
export type AccOpeningLine = AccOpeningSubmitInput['lines'][number]
export type AccOpeningAsset = AccOpeningSubmitInput['assets'][number]
export type AccOpeningBill = AccOpeningSubmitInput['bills'][number]
export type AccOpeningContainer = AccOpeningSubmitInput['containers'][number]
export type AccOpeningReferenceCandidate =
  TargetVouReferenceResult['items'][number]
export type AccOpeningCustomerSubunitCandidate = Extract<
  AccOpeningReferenceCandidate,
  { entity: 'customer-subunit' }
>

const referenceEntityByDimension: Readonly<
  Record<AccSubjectDimension, VouReferenceCandidateEntity>
> = {
  CUSTOMER_SUBUNIT: 'customer-subunit',
  SUPPLIER: 'supplier',
  OTHER_UNIT: 'other-unit',
  EMPLOYEE: 'employee',
  SALES_PARTNER: 'sales-partner',
  DEPARTMENT: 'department',
  PRODUCT: 'product',
  WAREHOUSE: 'warehouse',
  FUND_ACCOUNT: 'fund-account',
  ASSET: 'asset',
  BILL: 'bill',
}

export interface AccOpeningDraft extends TargetDraftRecord {
  entity: 'acc-opening'
  bookId: string
  submissionId: string
  lines: AccOpeningLine[]
  assets: AccOpeningAsset[]
  bills: AccOpeningBill[]
  containers: AccOpeningContainer[]
}

export interface AccOpeningReviewInput {
  bookId: string
  submissionId: string
  expectedRevision: string
  reason?: string
}

export interface AccOpeningViewModelContext {
  ownerUserId: string
  csrfToken: string
  permissions: readonly string[]
}

export interface AccOpeningViewModelPorts {
  books(
    csrfToken: string,
    input: { page: 1; pageSize: 200 },
  ): Promise<{
    items: AccBook[]
    total: number
    page: number
    pageSize: number
  }>
  subjects(
    csrfToken: string,
    input: { bookId: string; page: 1; pageSize: 200 },
  ): Promise<{
    items: AccSubject[]
    total: number
    page: number
    pageSize: number
  }>
  opening(csrfToken: string, bookId: string): Promise<AccOpening | null>
  references(
    csrfToken: string,
    input: TargetVouReferenceQueryInput,
  ): Promise<TargetVouReferenceResult>
  submit(csrfToken: string, input: AccOpeningSubmitInput): Promise<AccOpening>
  review(
    csrfToken: string,
    action: ApprovalAction,
    input: AccOpeningReviewInput,
  ): Promise<AccOpening>
  deleteSubmission(
    csrfToken: string,
    input: Omit<AccOpeningReviewInput, 'reason'>,
  ): Promise<{ submissionId: string; deleted: true }>
  drafts: {
    list(ownerUserId: string, bookId: string): Promise<AccOpeningDraft[]>
    save(draft: AccOpeningDraft): Promise<void>
    delete(draft: AccOpeningDraft): Promise<void>
  }
  id(): string
  now(): string
}

export function createAccOpeningViewModel(
  context: AccOpeningViewModelContext,
  ports: AccOpeningViewModelPorts,
) {
  const books = ref<AccBook[]>([])
  const subjects = ref<AccSubject[]>([])
  const referenceOptions = ref<
    Partial<Record<VouReferenceCandidateEntity, AccOpeningReferenceCandidate[]>>
  >({})
  const selectedBookId = ref('')
  const selectedContainerSubunit =
    ref<AccOpeningCustomerSubunitCandidate | null>(null)
  const drafts = ref<AccOpeningDraft[]>([])
  const opening = ref<AccOpening | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)
  const reason = ref('')
  let loadVersion = 0
  const referenceVersions = new Map<VouReferenceCandidateEntity, number>()

  const canQuery = computed(() =>
    ['/acc/book/query', '/acc/subject/query', '/acc/opening/query'].every(
      (permission) => context.permissions.includes(permission),
    ),
  )
  const canCreateDraft = computed(
    () =>
      canQuery.value && context.permissions.includes('/acc/opening/submit-new'),
  )
  const canDeleteSubmission = computed(() =>
    context.permissions.includes('/acc/opening/delete'),
  )
  const canQueryReferences = computed(() =>
    context.permissions.includes('/vou/reference/query'),
  )
  const bookOptions = computed(() =>
    books.value.map((book) => ({
      title: `${book.code} · ${book.name}`,
      value: book.id,
    })),
  )
  const subjectOptions = computed(() =>
    subjects.value
      .filter((subject) => subject.enabled)
      .map((subject) => ({
        title: `${subject.code} · ${subject.name}`,
        value: subject.id,
      })),
  )
  const customerSubunitOptions = computed(
    () =>
      referenceOptions.value['customer-subunit']?.filter(
        (candidate): candidate is AccOpeningCustomerSubunitCandidate =>
          candidate.entity === 'customer-subunit',
      ) ?? [],
  )

  async function initialize(): Promise<void> {
    if (!canQuery.value) return
    loading.value = true
    try {
      const result = await ports.books(context.csrfToken, {
        page: 1,
        pageSize: 200,
      })
      books.value = result.items
      selectedBookId.value ||= books.value[0]?.id ?? ''
      await loadSelected()
    } catch (cause) {
      error.value = errorMessage(cause, '会计期初初始化失败。')
    } finally {
      loading.value = false
    }
  }

  async function loadSelected(): Promise<void> {
    if (!selectedBookId.value) return
    const version = ++loadVersion
    loading.value = true
    try {
      const [subjectPage, localDrafts, current] = await Promise.all([
        ports.subjects(context.csrfToken, {
          bookId: selectedBookId.value,
          page: 1,
          pageSize: 200,
        }),
        ports.drafts.list(context.ownerUserId, selectedBookId.value),
        ports.opening(context.csrfToken, selectedBookId.value),
      ])
      if (version !== loadVersion) return
      subjects.value = subjectPage.items
      drafts.value = localDrafts
      opening.value = current
      error.value = null
    } catch (cause) {
      if (version === loadVersion)
        error.value = errorMessage(cause, '会计期初加载失败。')
    } finally {
      if (version === loadVersion) loading.value = false
    }
  }

  async function selectBook(bookId: string): Promise<void> {
    selectedBookId.value = bookId
    selectedContainerSubunit.value = null
    await loadSelected()
  }

  async function newDraft(): Promise<void> {
    if (!canCreateDraft.value || !selectedBookId.value) {
      error.value = '没有权限新建会计期初草稿。'
      return
    }
    const draft: AccOpeningDraft = {
      entity: 'acc-opening',
      draftId: ports.id(),
      ownerUserId: context.ownerUserId,
      updatedAt: ports.now(),
      bookId: selectedBookId.value,
      submissionId: ports.id(),
      lines: [],
      assets: [],
      bills: [],
      containers: [],
    }
    await ports.drafts.save(draft)
    drafts.value.push(draft)
    message.value = '期初草稿已保存在当前设备。'
  }

  async function saveDraft(draft: AccOpeningDraft): Promise<void> {
    draft.updatedAt = ports.now()
    try {
      await ports.drafts.save(draft)
      message.value = '期初草稿已保存在当前设备。'
      error.value = null
    } catch (cause) {
      error.value = errorMessage(cause, '本地期初草稿保存失败。')
    }
  }

  function addLine(draft: AccOpeningDraft): void {
    const subject = subjects.value[0]
    if (!subject) return
    draft.lines.push({
      subjectId: subject.id,
      currency: selectedBook()?.baseCurrency ?? 'CNY',
      direction: subject.balanceDirection,
      amount: '0.00',
      dimensions: Object.fromEntries(
        subject.requiredDimensions.map((dimension) => [dimension, '']),
      ),
      ...(subject.inventoryQuantity ? { quantity: '0' } : {}),
    })
  }

  function selectLineSubject(line: AccOpeningLine, subjectId: string): void {
    const subject = subjects.value.find(
      (candidate) => candidate.id === subjectId,
    )
    if (!subject) return
    line.subjectId = subject.id
    line.direction = subject.balanceDirection
    line.dimensions = Object.fromEntries(
      subject.requiredDimensions.map((dimension) => [dimension, '']),
    )
    if (subject.inventoryQuantity) line.quantity = line.quantity ?? '0'
    else delete line.quantity
  }

  function referenceEntity(dimension: string): VouReferenceCandidateEntity {
    if (!isAccSubjectDimension(dimension))
      throw new Error('Unknown accounting subject dimension.')
    return referenceEntityByDimension[dimension]
  }

  async function loadReference(
    entity: VouReferenceCandidateEntity,
    keyword = '',
  ): Promise<void> {
    if (!canQueryReferences.value) {
      error.value = '没有权限查询期初业务对象候选。'
      return
    }
    const version = (referenceVersions.get(entity) ?? 0) + 1
    referenceVersions.set(entity, version)
    const search = keyword.trim()
    try {
      const result = await ports.references(context.csrfToken, {
        entity,
        ...(search ? { keyword: search } : {}),
      })
      if (version !== referenceVersions.get(entity)) return
      referenceOptions.value = {
        ...referenceOptions.value,
        [entity]: result.items,
      }
    } catch (cause) {
      if (version === referenceVersions.get(entity))
        error.value = errorMessage(cause, '期初业务对象候选加载失败。')
    }
  }

  function selectDimension(
    line: AccOpeningLine,
    dimension: string,
    objectId: string | null,
  ): void {
    if (objectId) line.dimensions[dimension] = objectId
    else delete line.dimensions[dimension]
  }

  function selectAsset(asset: AccOpeningAsset, objectId: string | null): void {
    if (objectId) asset.assetId = objectId
    else delete asset.assetId
  }

  function selectBill(bill: AccOpeningBill, objectId: string | null): void {
    if (objectId) bill.billId = objectId
    else delete bill.billId
  }

  function addAsset(draft: AccOpeningDraft): void {
    draft.assets.push({
      currency: selectedBook()?.baseCurrency ?? 'CNY',
      originalValue: '0.00',
      accumulatedDepreciation: '0.00',
    })
  }

  function addBill(draft: AccOpeningDraft): void {
    draft.bills.push({
      currency: selectedBook()?.baseCurrency ?? 'CNY',
      valueAmount: '0.00',
    })
  }

  function addContainer(draft: AccOpeningDraft): void {
    const candidate = selectedContainerSubunit.value
    if (!candidate) {
      error.value = '请选择客户子单位。'
      return
    }
    draft.containers.push({
      subunit: {
        entity: 'customer-subunit',
        objectId: candidate.objectId,
        customerId: candidate.customerId,
        approvalEntryId: candidate.approvalEntryId,
        code: candidate.code,
        name: candidate.name,
      },
      containerType: 'SOLVENT',
      quantity: 1,
    })
    selectedContainerSubunit.value = null
    error.value = null
  }

  async function deleteDraft(draft: AccOpeningDraft): Promise<void> {
    await ports.drafts.delete(draft)
    drafts.value = drafts.value.filter(
      (candidate) => candidate.draftId !== draft.draftId,
    )
    message.value = '本地期初草稿已删除，未发送服务器请求。'
  }

  async function submitDraft(draft: AccOpeningDraft): Promise<void> {
    if (!context.permissions.includes('/acc/opening/submit-new')) {
      error.value = '没有权限提交会计期初。'
      return
    }
    saving.value = true
    error.value = null
    try {
      draft.updatedAt = ports.now()
      await ports.drafts.save(draft)
      const result = await ports.submit(context.csrfToken, {
        bookId: draft.bookId,
        submissionId: draft.submissionId,
        idempotencyKey: draft.submissionId,
        lines: draft.lines,
        assets: draft.assets,
        bills: draft.bills,
        containers: draft.containers,
      })
      await ports.drafts.delete(draft)
      drafts.value = drafts.value.filter(
        (candidate) => candidate.draftId !== draft.draftId,
      )
      opening.value = result
      message.value = '期初已提交，本地草稿已删除。'
    } catch (cause) {
      error.value = errorMessage(cause, '期初提交失败；本地草稿已保留。')
    } finally {
      saving.value = false
    }
  }

  function canReview(action: ApprovalAction): boolean {
    return opening.value?.availableApprovalActions.includes(action) ?? false
  }

  async function review(action: ApprovalAction): Promise<void> {
    const current = opening.value
    if (!current || !canReview(action)) return
    const needsReason = action === 'reject' || action === 'unapprove'
    const submittedReason = reason.value.trim()
    if (needsReason && !submittedReason) {
      error.value = '请填写审批原因。'
      return
    }
    try {
      await ports.review(context.csrfToken, action, {
        bookId: current.bookId,
        submissionId: current.submissionId,
        expectedRevision: current.approval.revision,
        ...(needsReason ? { reason: submittedReason } : {}),
      })
      reason.value = ''
      await loadSelected()
    } catch (cause) {
      const failure = errorMessage(cause, '期初审批失败。')
      await loadSelected()
      error.value = failure
    }
  }

  async function deleteSubmission(): Promise<void> {
    const current = opening.value
    if (!current || !canDeleteSubmission.value) return
    try {
      await ports.deleteSubmission(context.csrfToken, {
        bookId: current.bookId,
        submissionId: current.submissionId,
        expectedRevision: current.approval.revision,
      })
      await loadSelected()
    } catch (cause) {
      const failure = errorMessage(cause, '开放期初提交件删除失败。')
      await loadSelected()
      error.value = failure
    }
  }

  function selectedBook(): AccBook | undefined {
    return books.value.find((book) => book.id === selectedBookId.value)
  }

  return {
    books,
    subjects,
    referenceOptions,
    selectedBookId,
    selectedContainerSubunit,
    drafts,
    opening,
    loading,
    saving,
    error,
    message,
    reason,
    canQuery,
    canCreateDraft,
    canDeleteSubmission,
    canQueryReferences,
    bookOptions,
    subjectOptions,
    customerSubunitOptions,
    initialize,
    loadSelected,
    selectBook,
    newDraft,
    saveDraft,
    addLine,
    selectLineSubject,
    referenceEntity,
    loadReference,
    selectDimension,
    selectAsset,
    selectBill,
    addAsset,
    addBill,
    addContainer,
    deleteDraft,
    submitDraft,
    canReview,
    review,
    deleteSubmission,
  }
}

export function useAccOpeningViewModel() {
  const session = useTargetSession()
  if (!session.user || !session.csrfToken)
    throw new Error(
      'Accounting opening page requires an authenticated session.',
    )
  const storage = new TargetDraftRepository()
  return createAccOpeningViewModel(
    {
      ownerUserId: session.user.id,
      csrfToken: session.csrfToken,
      permissions: session.permissions,
    },
    {
      books: queryTargetAccBooks,
      subjects: queryTargetAccSubjects,
      opening: async (csrfToken, bookId) => {
        try {
          return await queryTargetAccOpening(csrfToken, { bookId })
        } catch (cause) {
          if (
            cause instanceof TargetApiError &&
            cause.errorKey === 'approval_not_found'
          )
            return null
          throw cause
        }
      },
      references: queryTargetVouReference,
      submit: submitTargetAccOpening,
      review: (csrfToken, action, input) =>
        reviewTargetAccOpening(csrfToken, action, {
          bookId: input.bookId,
          submissionId: input.submissionId,
          expectedRevision: input.expectedRevision,
          ...(input.reason ? { reason: input.reason } : {}),
        }),
      deleteSubmission: deleteTargetAccOpening,
      drafts: {
        list: (ownerUserId, bookId) =>
          storage
            .list<AccOpeningDraft>(ownerUserId, 'acc-opening')
            .then((items) => items.filter((item) => item.bookId === bookId)),
        save: (draft) => storage.save(draft),
        delete: (draft) =>
          storage.delete(draft.ownerUserId, draft.entity, draft.draftId),
      },
      id: createTargetId,
      now: () => new Date().toISOString(),
    },
  )
}

export function openingActionLabel(action: ApprovalAction): string {
  return (
    {
      approve: '批准',
      reject: '驳回',
      unreject: '恢复审核',
      unapprove: '反批准',
    } as const
  )[action]
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function isAccSubjectDimension(value: string): value is AccSubjectDimension {
  return accSubjectDimensions.some((dimension) => dimension === value)
}
