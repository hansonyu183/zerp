import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { ulid } from 'ulid'
import type * as api from '../../api.ts'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import { useTargetSession } from '../../session/vm.ts'
import {
  emptyOpening,
  type OpeningDraft,
  counterpartyTypes,
} from './opening-data.ts'
type ReferenceEntity = api.TargetReferenceEntity
type Candidate = Awaited<
  ReturnType<typeof api.queryTargetVouOptions>
>['items'][number]
export function useOpeningFields(
  value: () => OpeningDraft,
  update: (value: OpeningDraft) => void,
  disabled: () => boolean,
) {
  const session = useTargetSession(),
    generation = session.generation
  let disposed = false
  const draft = ref<OpeningDraft>(
    JSON.parse(JSON.stringify(value())) as OpeningDraft,
  )
  const billCounterparties = ref<
    Record<string, keyof typeof counterpartyTypes>
  >({})
  const books = ref<
    Awaited<ReturnType<typeof api.queryTargetBookOptions>>['items']
  >([])
  const subjects = ref<
    Awaited<ReturnType<typeof api.queryTargetSubjectOptions>>['items']
  >([])
  const references = ref<Partial<Record<ReferenceEntity, Candidate[]>>>({})
  const current = () => !disposed && session.generation === generation
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
  function adoptBookOptions(items: readonly EditOption[]) {
    books.value = items.flatMap((item) =>
      item.snapshot ? [item.snapshot as (typeof books.value)[number]] : [],
    )
  }
  function adoptSubjectOptions(items: readonly EditOption[]) {
    subjects.value = items.flatMap((item) =>
      item.snapshot ? [item.snapshot as (typeof subjects.value)[number]] : [],
    )
  }
  function adoptReferenceOptions(
    entity: ReferenceEntity,
    items: readonly EditOption[],
  ) {
    references.value[entity] = items.flatMap((item) =>
      item.snapshot ? [item.snapshot as Candidate] : [],
    )
  }
  function selectBook(bookId: string) {
    if (canEdit.value && bookId !== draft.value.bookId) {
      draft.value = { ...emptyOpening(), bookId }
      subjects.value = []
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
  onBeforeUnmount(() => {
    disposed = true
  })
  return {
    draft,
    books,
    subjects,
    adoptBookOptions,
    adoptSubjectOptions,
    adoptReferenceOptions,
    references,
    referenceOptions,
    billCounterparties,
    can,
    canEdit,
    selectBook,
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
