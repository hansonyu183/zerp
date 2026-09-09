import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ulid } from 'ulid'
import * as api from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import { openingErrorCaptions as errors } from './opening-errors.ts'
import {
  emptyOpening,
  dimensionSources,
  type OpeningDraft,
  counterpartyTypes,
} from './opening-data.ts'
type ReferenceEntity = api.TargetVouReferenceQueryInput['entity']
type Candidate = Awaited<
  ReturnType<typeof api.queryTargetVouReferences>
>['items'][number]
export function useOpeningFields(
  value: () => OpeningDraft,
  update: (value: OpeningDraft) => void,
  disabled: () => boolean,
) {
  const session = useTargetSession(),
    generation = session.generation
  let disposed = false,
    request = 0,
    subjectsRequest = 0
  const draft = ref<OpeningDraft>(
    JSON.parse(JSON.stringify(value())) as OpeningDraft,
  )
  const error = ref(''),
    loading = ref(false)
  const billCounterparties = ref<
    Record<string, keyof typeof counterpartyTypes>
  >({})
  const books = ref<
    Awaited<ReturnType<typeof api.queryTargetAccountingBooks>>['items']
  >([])
  const subjects = ref<
    Awaited<ReturnType<typeof api.queryTargetAccountingSubjects>>['items']
  >([])
  const references = ref<Partial<Record<ReferenceEntity, Candidate[]>>>({})
  const referencePending = ref(new Set<ReferenceEntity>())
  const referenceRequests = new Map<ReferenceEntity, number>()
  const current = (version = request) =>
    !disposed && session.generation === generation && version === request
  const can = (path: string) => current() && session.can(path)
  const canEdit = computed(() => current() && !disabled())
  watch(
    draft,
    () => {
      if (current())
        update(JSON.parse(JSON.stringify(draft.value)) as OpeningDraft)
    },
    { deep: true, flush: 'sync' },
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
    draft.value = { ...emptyOpening(), bookId }
    const version = request
    try {
      await loadSubjects(bookId, version)
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
  onMounted(async () => {
    loading.value = true
    try {
      await loadBooks(request)
      if (draft.value.bookId) await loadSubjects(draft.value.bookId, request)
    } catch (cause) {
      if (current()) error.value = report(cause)
    } finally {
      if (current()) loading.value = false
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    request++
    referenceRequests.clear()
  })
  return {
    draft,
    books,
    leafSubjects,
    references,
    referencePending,
    referenceOptions,
    error,
    loading,
    billCounterparties,
    can,
    canEdit,
    selectBook,
    loadReference,
    addLine,
    setSubject,
    addAsset,
    addBill,
    selectCounterpartyType,
    setCounterparty,
    addContainer,
    setContainer,
  }
}
