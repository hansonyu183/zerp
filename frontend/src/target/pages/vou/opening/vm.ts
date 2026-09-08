import { openingErrorCaptions as errors } from '../opening-errors.ts'
import { computed, ref, toRaw, watch } from 'vue'
import { ulid } from 'ulid'
import {
  approvalStatusPresentation,
  type ApprovalStatus,
  type AccSubjectDimension,
} from '@zerp/model'
import * as api from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import {
  defineVouPage,
  naturalMonth,
  type VouFilters,
} from '../../../components/vou-list-page/definition.ts'
import type {
  VouPageRegistration,
  VouRow,
} from '../../../components/vou-list-page/vm.ts'

export type OpeningFilters = VouFilters & { status: ApprovalStatus | null }
export const openingPage: VouPageRegistration<OpeningFilters> = {
  ...defineVouPage<VouRow, OpeningFilters>({
    vouType: 'opening',
    title: '会计期初',
    columns: [
      { key: 'documentNo', type: 'text', caption: '期初单号' },
      { key: 'handlerName', type: 'text', caption: '经办人' },
      { key: 'businessDate', type: 'date', caption: '账簿起始日期' },
      {
        key: 'status',
        type: 'enum',
        caption: '审批状态',
        options: Object.entries(approvalStatusPresentation).map(
          ([value, p]) => ({ value, caption: p.label }),
        ),
      },
      { key: '$actions', type: 'actions', caption: '操作' },
    ],
    filters: [
      { key: 'businessDate', type: 'date', range: true, caption: '期间' },
      { key: 'documentNo', type: 'text', caption: '期初单号' },
      {
        key: 'status',
        type: 'enum',
        caption: '审批状态',
        options: Object.entries(approvalStatusPresentation).map(
          ([value, p]) => ({ value, caption: p.label }),
        ),
      },
    ],
  }),
  initialFilters: () => ({
    businessDate: naturalMonth(),
    documentNo: '',
    status: null,
  }),
  search: (csrf, input) =>
    api.queryTargetOpenings(csrf, {
      page: input.page,
      pageSize: 20,
      documentNo: input.documentNo || undefined,
      dateFrom: input.businessDate.from ?? undefined,
      dateTo: input.businessDate.to ?? undefined,
      status: input.status || undefined,
    }),
}
export const directions = { DEBIT: '借方', CREDIT: '贷方' } as const
export const dimensions: Record<AccSubjectDimension, string> = {
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
}
export const billPositions = {
  ASSET: '资产票据',
  LIABILITY: '负债票据',
} as const
export const billMedia = { PAPER: '纸质', ELECTRONIC: '电子' } as const
export const containerTypes = { SOLVENT: '溶剂桶', RESIN: '树脂桶' } as const
export const counterpartyTypes = {
  customer: '客户',
  supplier: '供应商',
  'other-unit': '其他单位',
  'sales-partner': '销售合作方',
  employee: '员工',
  'operating-entity': '经营主体',
} as const
export const options = (captions: Readonly<Record<string, string>>) =>
  Object.entries(captions).map(([value, title]) => ({ value, title }))
type ReferenceEntity = api.TargetVouReferenceQueryInput['entity']
type Candidate = Awaited<
  ReturnType<typeof api.queryTargetVouReferences>
>['items'][number]
export const dimensionSources: Record<AccSubjectDimension, ReferenceEntity> = {
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

function empty(): api.TargetOpeningInput {
  return {
    bookId: '',
    submissionId: ulid(),
    idempotencyKey: ulid(),
    lines: [],
    assets: [],
    bills: [],
    containers: [],
  }
}
const clone = <T>(value: T): T => structuredClone(toRaw(value))
export function useOpeningEditorViewModel(
  onChanged: () => Promise<boolean | void>,
) {
  const session = useTargetSession(),
    generation = session.generation
  let disposed = false,
    request = 0,
    subjectsRequest = 0
  const referenceRequests = new Map<ReferenceEntity, number>()
  const open = ref(false),
    saving = ref(false),
    unknown = ref(false),
    loading = ref(false),
    error = ref(''),
    feedback = ref('')
  const source = ref<Awaited<ReturnType<typeof api.getTargetOpening>> | null>(
    null,
  )
  const unknownAction = ref<'submit' | 'delete'>('submit')
  const billCounterparties = ref<
    Record<string, keyof typeof counterpartyTypes>
  >({})
  const draft = ref<api.TargetOpeningInput>(empty())
  const books = ref<
    Awaited<ReturnType<typeof api.queryTargetAccountingBooks>>['items']
  >([])
  const subjects = ref<
    Awaited<ReturnType<typeof api.queryTargetAccountingSubjects>>['items']
  >([])
  const references = ref<Partial<Record<ReferenceEntity, Candidate[]>>>({})
  const referencePending = ref(new Set<ReferenceEntity>())
  const current = (version = request) =>
    !disposed &&
    session.generation === generation &&
    version === request &&
    open.value
  const can = (path: string) =>
    !disposed && session.generation === generation && session.can(path)
  const canEdit = computed(
    () =>
      open.value &&
      !saving.value &&
      !unknown.value &&
      can('/vou/opening/submit-new'),
  )
  const zero = computed(
    () =>
      !draft.value.lines.length &&
      !draft.value.assets.length &&
      !draft.value.bills.length &&
      !draft.value.containers.length,
  )
  const leafSubjects = computed(() => {
    const parents = new Set(
      subjects.value.map((row) => row.parentId).filter(Boolean),
    )
    return subjects.value
      .filter((row) => row.enabled && !parents.has(row.id))
      .map((row) => ({ ...row, title: `${row.code} ${row.name}` }))
  })
  const report = (cause: unknown) =>
    cause instanceof api.TargetApiError
      ? (errors[cause.errorKey] ?? '操作未完成，请检查期初内容与账簿限制。')
      : '读取失败，请重试。'
  async function loadBooks(version: number) {
    if (!can('/acc/book/query') || !session.csrfToken) return
    const all: typeof books.value = []
    for (let page = 1; ; page++) {
      if (!current(version) || !can('/acc/book/query') || !session.csrfToken)
        return
      const result = await api.queryTargetAccountingBooks(session.csrfToken, {
        page,
        pageSize: 200,
      })
      if (!current(version) || !can('/acc/book/query')) return
      all.push(...result.items)
      if (all.length >= result.total || !result.items.length) break
    }
    books.value = all
  }
  async function openCreate() {
    if (!can('/vou/opening/submit-new') || saving.value) return
    request++
    source.value = null
    billCounterparties.value = {}
    open.value = true
    draft.value = empty()
    subjects.value = []
    books.value = []
    references.value = {}
    unknown.value = false
    error.value = ''
    feedback.value = ''
    const version = request
    loading.value = true
    try {
      await loadBooks(version)
    } catch (cause) {
      if (current(version)) error.value = report(cause)
    } finally {
      if (current(version)) loading.value = false
    }
  }
  async function loadSubjects(bookId: string, version: number) {
    const own = ++subjectsRequest
    subjects.value = []
    if (!can('/acc/subject/query') || !session.csrfToken) return
    const all: typeof subjects.value = []
    for (let page = 1; ; page++) {
      if (
        !current(version) ||
        own !== subjectsRequest ||
        !can('/acc/subject/query') ||
        !session.csrfToken
      )
        return
      const result = await api.queryTargetAccountingSubjects(
        session.csrfToken,
        bookId,
        page,
      )
      if (
        !current(version) ||
        own !== subjectsRequest ||
        !can('/acc/subject/query')
      )
        return
      all.push(...result.items)
      if (all.length >= result.total || !result.items.length) break
    }
    subjects.value = all
  }
  async function selectBook(bookId: string) {
    if (!canEdit.value) return
    draft.value = { ...empty(), bookId }
    const version = request
    try {
      await loadSubjects(bookId, version)
    } catch (cause) {
      if (current(version)) error.value = report(cause)
    }
  }
  async function cloneSubmission(
    document: Awaited<ReturnType<typeof api.getTargetOpening>>,
  ) {
    const version = request + 1
    await openCreate()
    if (!current(version) || !canEdit.value) return
    source.value = clone(document)
    const payload = clone(document.payload)
    draft.value = {
      ...payload,
      submissionId: ulid(),
      idempotencyKey: ulid(),
      bills: payload.bills.map((bill) => ({
        ...bill,
        ...(bill.originatingCounterparty &&
        ['employee', 'operating-entity'].includes(
          bill.originatingCounterparty.entity,
        )
          ? {
              originatingCounterparty: {
                entity: bill.originatingCounterparty.entity as
                  'employee' | 'operating-entity',
                objectId: bill.originatingCounterparty.objectId,
              },
            }
          : {}),
      })),
    }
    try {
      await loadSubjects(payload.bookId, version)
    } catch (cause) {
      if (current(version)) error.value = report(cause)
    }
  }
  async function loadReference(entity: ReferenceEntity, keyword = '') {
    if (!current() || !can('/vou/reference/query') || !session.csrfToken) return
    const version = request,
      own = (referenceRequests.get(entity) ?? 0) + 1
    referenceRequests.set(entity, own)
    referencePending.value.add(entity)
    try {
      const result = await api.queryTargetVouReferences(session.csrfToken, {
        entity,
        keyword: keyword.trim() || undefined,
      })
      if (
        current(version) &&
        referenceRequests.get(entity) === own &&
        can('/vou/reference/query')
      )
        references.value = { ...references.value, [entity]: result.items }
    } catch (cause) {
      if (current(version) && referenceRequests.get(entity) === own)
        error.value = report(cause)
    } finally {
      if (current(version) && referenceRequests.get(entity) === own)
        referencePending.value.delete(entity)
    }
  }
  function referenceOptions(entity: ReferenceEntity) {
    const values = (references.value[entity] ?? []).map((row) => ({
      value: row.objectId,
      title: `${row.code} ${row.name}`,
    }))
    const local =
      entity === 'asset'
        ? draft.value.assets.map((row) => ({
            value: row.assetId!,
            title: row.name || row.assetNo || '所选资产',
          }))
        : entity === 'bill'
          ? draft.value.bills.map((row) => ({
              value: row.billId!,
              title: row.billNo || '所选票据',
            }))
          : []
    return [
      ...local,
      ...values.filter(
        (row) => !local.some((item) => item.value === row.value),
      ),
    ]
  }
  function addLine() {
    if (canEdit.value)
      draft.value.lines.push({
        subjectId: '',
        currency:
          books.value.find((book) => book.id === draft.value.bookId)
            ?.baseCurrency ?? 'CNY',
        direction: 'DEBIT',
        amount: '0.00',
        dimensions: {},
      })
  }
  function setSubject(index: number, id: string) {
    if (!canEdit.value) return
    const line = draft.value.lines[index],
      subject = subjects.value.find((row) => row.id === id)
    if (!line) return
    line.subjectId = id
    line.dimensions = {}
    delete line.quantity
    if (subject?.inventoryQuantity) line.quantity = '0'
    for (const dimension of subject?.requiredDimensions ?? []) {
      line.dimensions[dimension] = ''
      void loadReference(dimensionSources[dimension])
    }
  }
  function addAsset(existing = false) {
    if (!canEdit.value) return
    draft.value.assets.push(
      existing
        ? {
            assetId: '',
            currency: 'CNY',
            originalValue: '0.00',
            accumulatedDepreciation: '0.00',
          }
        : {
            assetId: ulid(),
            assetNo: '',
            name: '',
            categoryId: '',
            departmentId: '',
            usefulLifeMonths: 12,
            residualRate: '0.00',
            acquiredOn: '',
            currency: 'CNY',
            originalValue: '0.00',
            accumulatedDepreciation: '0.00',
          },
    )
  }
  function addBill(existing = false) {
    if (!canEdit.value) return
    draft.value.bills.push(
      existing
        ? { billId: '', currency: 'CNY', valueAmount: '0.00' }
        : {
            billId: ulid(),
            billNo: '',
            billType: '',
            positionType: 'ASSET',
            medium: 'ELECTRONIC',
            currency: 'CNY',
            faceAmount: '0.00',
            issueDate: '',
            maturityDate: '',
            drawer: '',
            acceptor: '',
            payee: '',
            annualRateBps: 0,
            interestDays: 0,
            interestAmount: '0.00',
            customerCostAmount: '0.00',
            valueAmount: '0.00',
          },
    )
  }
  function selectCounterpartyType(
    index: number,
    entity: keyof typeof counterpartyTypes,
  ) {
    const bill = draft.value.bills[index]
    if (!bill || !canEdit.value) return
    billCounterparties.value[bill.billId!] = entity
    delete bill.originatingCounterparty
    void loadReference(entity)
  }
  function setCounterparty(
    index: number,
    entity: keyof typeof counterpartyTypes,
    objectId: string,
  ) {
    if (!canEdit.value) return
    const bill = draft.value.bills[index],
      row = references.value[entity]?.find((row) => row.objectId === objectId)
    if (!bill || !row) return
    if (entity === 'employee' || entity === 'operating-entity')
      bill.originatingCounterparty = { entity, objectId }
    else if ('approvalEntryId' in row && row.approvalEntryId)
      bill.originatingCounterparty = {
        entity,
        objectId,
        approvalEntryId: row.approvalEntryId,
        code: row.code,
        name: row.name,
        ...(entity === 'customer' ? { customerId: objectId } : {}),
      }
  }
  function addContainer() {
    if (canEdit.value)
      draft.value.containers.push({
        subunit: {
          entity: 'customer-subunit',
          objectId: '',
          customerId: '',
          approvalEntryId: '',
          code: '',
          name: '',
        },
        containerType: 'SOLVENT',
        quantity: 1,
      })
  }
  function setContainer(index: number, objectId: string) {
    if (!canEdit.value) return
    const row = references.value['customer-subunit']?.find(
        (row) => row.objectId === objectId,
      ),
      container = draft.value.containers[index]
    if (row?.entity === 'customer-subunit' && container)
      container.subunit = {
        entity: 'customer-subunit',
        objectId,
        customerId: row.customerId,
        approvalEntryId: row.approvalEntryId,
        code: row.code,
        name: row.name,
      }
  }
  function reset() {
    source.value = null
    billCounterparties.value = {}
    unknownAction.value = 'submit'
    request++
    subjectsRequest++
    open.value = false
    draft.value = empty()
    books.value = []
    subjects.value = []
    references.value = {}
    referencePending.value.clear()
    referenceRequests.clear()
    loading.value = false
    saving.value = false
    unknown.value = false
    error.value = ''
  }
  function close() {
    if (!saving.value) reset()
  }
  async function complete(version: number) {
    if (!current(version)) return
    reset()
    const refreshed = await onChanged().catch(() => false)
    if (!disposed && session.generation === generation)
      feedback.value =
        refreshed === false
          ? '提交成功，但列表刷新失败。'
          : '提交成功，等待其他操作人审批。'
  }
  async function submit() {
    if (
      !canEdit.value ||
      source.value ||
      !session.csrfToken ||
      !draft.value.bookId
    )
      return
    const version = request
    saving.value = true
    error.value = ''
    try {
      await api.submitTargetOpening(session.csrfToken, clone(draft.value))
      await complete(version)
    } catch (cause) {
      if (current(version)) {
        if (
          !(cause instanceof api.TargetApiError) ||
          ['internal_error', 'invalid_response'].includes(cause.errorKey)
        ) {
          unknownAction.value = 'submit'
          unknown.value = true
          error.value = '提交结果未知，请核实原提交；不会自动重试。'
        } else error.value = report(cause)
      }
    } finally {
      if (current(version)) saving.value = false
    }
  }
  const canDeleteSource = computed(() =>
    Boolean(
      source.value &&
      source.value.status !== 'APPROVED' &&
      source.value.submittedBy === session.user?.id &&
      can('/vou/opening/delete') &&
      !saving.value &&
      !unknown.value,
    ),
  )
  async function deleteSource() {
    const original = source.value
    if (!original || !canDeleteSource.value || !session.csrfToken) return
    const version = request
    saving.value = true
    error.value = ''
    try {
      await api.deleteTargetVoucher(session.csrfToken, 'opening', {
        documentId: original.bookId,
        submissionId: original.submissionId,
        expectedRevision: original.revision,
      })
      if (current(version)) {
        source.value = null
        feedback.value = '原提交已删除，可以修改后重新提交。'
        await onChanged().catch(() => false)
      }
    } catch (cause) {
      if (current(version)) {
        if (
          !(cause instanceof api.TargetApiError) ||
          ['internal_error', 'invalid_response'].includes(cause.errorKey)
        ) {
          unknownAction.value = 'delete'
          unknown.value = true
          error.value = '删除结果未知，请核实原提交；不会自动重试。'
        } else error.value = report(cause)
      }
    } finally {
      if (current(version)) saving.value = false
    }
  }
  const canVerify = computed(
    () =>
      unknown.value &&
      can(
        unknownAction.value === 'delete'
          ? '/vou/opening/audit-history'
          : '/vou/opening/get',
      ),
  )
  async function verify() {
    if (
      !current() ||
      !unknown.value ||
      saving.value ||
      !canVerify.value ||
      !session.csrfToken
    )
      return
    const version = request
    saving.value = true
    try {
      if (unknownAction.value === 'delete' && source.value) {
        const original = source.value
        const audit = await api.queryTargetVoucherAudit(
          session.csrfToken,
          'opening',
          original.bookId,
        )
        if (!current(version)) return
        if (
          audit.some(
            (row) =>
              row.action === 'DELETED' &&
              row.submissionId === original.submissionId &&
              row.fromRevision === original.revision &&
              row.actorId === session.user?.id,
          )
        ) {
          source.value = null
          unknown.value = false
          error.value = ''
          feedback.value = '已核实原提交删除成功，可以继续编辑。'
          await onChanged().catch(() => false)
        } else error.value = '尚无法确定删除结果，继续保持锁定。'
        return
      }
      const result = await api.getTargetOpening(
        session.csrfToken,
        draft.value.bookId,
      )
      if (current(version)) {
        if (result.submissionId === draft.value.submissionId)
          await complete(version)
        else
          error.value = '账簿存在另一份提交，请核对现有期初；原提交仍保持锁定。'
      }
    } catch {
      if (current(version)) error.value = '尚无法确定原提交结果，继续保持锁定。'
    } finally {
      if (current(version)) saving.value = false
    }
  }
  const stop = watch(
    () => session.generation,
    () => reset(),
    { flush: 'sync' },
  )
  return {
    source,
    canDeleteSource,
    deleteSource,
    canVerify,
    billCounterparties,
    selectCounterpartyType,
    open,
    saving,
    unknown,
    loading,
    error,
    feedback,
    draft,
    books,
    subjects,
    leafSubjects,
    references,
    referencePending,
    referenceOptions,
    can,
    canEdit,
    zero,
    openCreate,
    selectBook,
    cloneSubmission,
    loadReference,
    addLine,
    setSubject,
    addAsset,
    addBill,
    setCounterparty,
    addContainer,
    setContainer,
    close,
    submit,
    verify,
    dispose() {
      disposed = true
      stop()
      reset()
    },
  }
}
