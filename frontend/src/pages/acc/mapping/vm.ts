import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { queryAccountingBooks, type AccountingBook } from '../book/api'
import {
  createNextAccountingMapping,
  createAccountingMapping,
  getAccountingMapping,
  getAccountingMappingCatalog,
  getAccountingMappingVersions,
  mappingApprovalAction,
  mappingReasonAction,
  queryAccountingMappings,
  saveAccountingMapping,
  type AccountingMapping,
  type AccountingMappingCatalog,
  type AccountingMappingDefinition,
  type MappingContract,
} from './api'

export const mappingEntities: readonly string[] = [
  'asset-acquisition',
  'asset-liquidation',
  'asset-sale',
  'bill-discount',
  'bill-issue',
  'bill-maturity',
  'bill-payment',
  'bill-receipt',
  'employee-loan',
  'employee-loan-writeoff',
  'employee-repayment',
  'expense-payment',
  'expense-reimbursement',
  'intermediary-calculation',
  'inventory-count',
  'order-production',
  'other-income',
  'other-payment',
  'other-receipt',
  'purchase-inbound',
  'purchase-inquiry',
  'purchase-order',
  'purchase-payment',
  'purchase-refund',
  'purchase-return',
  'sale-delivery',
  'sale-order',
  'sale-outbound',
  'sale-pricing',
  'sale-return',
  'sale-signoff',
  'sales-receipt',
  'sales-refund',
  'service-acceptance',
  'service-contract',
  'self-production',
]

const emptyDefinition: AccountingMappingDefinition = {
  defaultTemplateId: null,
  rules: [],
  templates: [],
}

export function createAccountingMappingViewModel() {
  const session = useSessionStore()
  const books = ref<AccountingBook[]>([])
  const rows = ref<AccountingMapping[]>([])
  const selectedBookId = ref('')
  const entityFilter = ref('')
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const loading = ref(false)
  const saving = ref(false)
  const editorOpen = ref(false)
  const editing = ref<AccountingMapping | null>(null)
  const catalog = ref<AccountingMappingCatalog | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const approvalReason = ref('')
  const versions = ref<AccountingMapping[]>([])
  let listSequence = 0
  let detailSequence = 0
  let catalogSequence = 0
  let active = true
  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
      listSequence += 1
      detailSequence += 1
      catalogSequence += 1
    })
  }
  const form = reactive({
    vouEntity: 'sale-order',
    defaultResult: 'UN_POST' as AccountingMapping['defaultResult'],
    definitionText: JSON.stringify(emptyDefinition, null, 2),
  })

  const canQuery = computed(
    () => session.can('/acc/book/query') && session.can('/acc/mapping/query'),
  )
  const canCreate = computed(
    () =>
      canQuery.value &&
      Boolean(selectedBookId.value) &&
      session.can('/acc/mapping/create') &&
      session.can('/acc/mapping/catalog'),
  )
  const canEdit = computed(
    () =>
      canQuery.value &&
      session.can('/acc/mapping/get') &&
      session.can('/acc/mapping/save') &&
      session.can('/acc/mapping/catalog'),
  )
  const canApprove = computed(
    () => canQuery.value && session.can('/acc/mapping/approve'),
  )
  const canUnapprove = computed(
    () => canQuery.value && session.can('/acc/mapping/unapprove'),
  )
  const canSubmitApproval = computed(() => canQuery.value && session.can('/acc/mapping/submit'))
  const canUnsubmitApproval = computed(() => canQuery.value && session.can('/acc/mapping/unsubmit'))
  const canRejectApproval = computed(() => canQuery.value && session.can('/acc/mapping/reject'))
  const canCreateNext = computed(() => canQuery.value && session.can('/acc/mapping/create-next'))
  const canVersions = computed(() => canQuery.value && session.can('/acc/mapping/versions'))
  const canDeleteVersion = computed(() => canQuery.value && session.can('/acc/mapping/delete-version'))
  const parsedDefinition = computed<AccountingMappingDefinition | null>(() => {
    try {
      const value = JSON.parse(
        form.definitionText,
      ) as AccountingMappingDefinition
      return value &&
        Array.isArray(value.rules) &&
        Array.isArray(value.templates)
        ? value
        : null
    } catch {
      return null
    }
  })
  const validationError = computed(() => {
    if (!form.vouEntity) return '请选择 VOU 单据类型。'
    if (!parsedDefinition.value) return '映射定义必须是有效的声明式 JSON。'
    return ''
  })
  const canSubmit = computed(
    () =>
      !saving.value &&
      !validationError.value &&
      (editing.value
        ? editing.value.state === 'DRAFT' && canEdit.value
        : canCreate.value),
  )
  const bookOptions = computed(() =>
    books.value.map((book) => ({
      title: `${book.code} · ${book.name}`,
      value: book.bookId,
    })),
  )

  async function initialize(): Promise<void> {
    if (!canQuery.value) return
    const current = ++listSequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryAccountingBooks({ page: 1, pageSize: 200 })
      if (!active || current !== listSequence) return
      books.value = result.data.items
      if (!selectedBookId.value && books.value.length)
        selectedBookId.value = books.value[0].bookId
      await query(current)
    } catch (error) {
      if (active && current === listSequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === listSequence) loading.value = false
    }
  }

  async function query(existingSequence?: number): Promise<void> {
    if (!canQuery.value || !selectedBookId.value) {
      rows.value = []
      total.value = 0
      return
    }
    const current = existingSequence ?? ++listSequence
    loading.value = true
    errorMessage.value = null
    rows.value = []
    total.value = 0
    try {
      const result = await queryAccountingMappings({
        bookId: selectedBookId.value,
        page: page.value,
        pageSize: pageSize.value,
        ...(entityFilter.value ? { vouEntity: entityFilter.value } : {}),
      })
      if (!active || current !== listSequence) return
      rows.value = result.data.items.map(projectMapping)
      total.value = result.data.total
    } catch (error) {
      if (active && current === listSequence) {
        rows.value = []
        total.value = 0
        errorMessage.value = getErrorMessage(error)
      }
    } finally {
      if (active && current === listSequence) loading.value = false
    }
  }

  async function loadCatalog(): Promise<void> {
    if (!session.can('/acc/mapping/catalog')) return
    const current = ++catalogSequence
    const entity = form.vouEntity
    try {
      const result = await getAccountingMappingCatalog(entity)
      if (!active || current !== catalogSequence || entity !== form.vouEntity)
        return
      catalog.value = result.data
    } catch (error) {
      if (active && current === catalogSequence)
        errorMessage.value = getErrorMessage(error)
    }
  }

  function setForm(mapping?: AccountingMapping): void {
    form.vouEntity = mapping?.vouEntity ?? 'sale-order'
    form.defaultResult = mapping?.defaultResult ?? 'UN_POST'
    form.definitionText = JSON.stringify(
      mapping?.definition ?? emptyDefinition,
      null,
      2,
    )
  }
  function projectMapping(mapping: MappingContract): AccountingMapping {
    return { ...mapping, state: mapping.approval.status, version: mapping.approval.versionNo }
  }

  async function openCreate(source?: AccountingMapping): Promise<void> {
    if (!canCreate.value) return
    editing.value = null
    setForm(source)
    editorOpen.value = true
    await loadCatalog()
  }

  async function openEdit(mapping: AccountingMapping): Promise<void> {
    if (!canEdit.value) {
      errorMessage.value = '没有权限编辑会计映射。'
      return
    }
    const current = ++detailSequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await getAccountingMapping(
        mapping.bookId,
        mapping.vouEntity,
        mapping.approval.approvalEntryId,
      )
      if (!active || current !== detailSequence) return
      editing.value = projectMapping(result.data)
      setForm(editing.value)
      editorOpen.value = true
      await loadCatalog()
    } catch (error) {
      if (active && current === detailSequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === detailSequence) loading.value = false
    }
  }

  function closeEditor(): void {
    detailSequence += 1
    catalogSequence += 1
    editorOpen.value = false
    editing.value = null
    catalog.value = null
  }

  async function save(): Promise<void> {
    if (!canSubmit.value || !parsedDefinition.value) {
      errorMessage.value = validationError.value || '没有权限保存映射。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      if (editing.value) {
        await saveAccountingMapping({
          bookId: editing.value.bookId,
          vouEntity: editing.value.vouEntity,
          approvalEntryId: editing.value.approval.approvalEntryId,
          revision: editing.value.approval.revision,
          defaultResult: form.defaultResult,
          definition: parsedDefinition.value,
        })
      } else {
        await createAccountingMapping({
          bookId: selectedBookId.value,
          vouEntity: form.vouEntity,
          defaultResult: form.defaultResult,
          definition: parsedDefinition.value,
        })
      }
      if (!active) return
      successMessage.value = editing.value
        ? '映射草稿已保存。'
        : '映射版本已创建。'
      closeEditor()
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function changeState(
    mapping: AccountingMapping,
    action: 'submit' | 'unsubmit' | 'approve' | 'reject' | 'unapprove' | 'delete-version',
  ): Promise<void> {
    const permitted = {
      submit: canSubmitApproval.value, unsubmit: canUnsubmitApproval.value,
      approve: canApprove.value, reject: canRejectApproval.value,
      unapprove: canUnapprove.value, 'delete-version': canDeleteVersion.value,
    }[action]
    if (!permitted) {
      errorMessage.value = '没有权限变更会计映射状态。'
      return
    }
    const reason = approvalReason.value.trim()
    if ((action === 'reject' || action === 'unapprove') && !reason) {
      errorMessage.value = '请填写审批原因。'
      return
    }
    loading.value = true
    errorMessage.value = null
    try {
      if (action === 'reject' || action === 'unapprove')
        await mappingReasonAction(
          action,
          mapping.bookId,
          mapping.vouEntity,
          mapping.approval.approvalEntryId,
          mapping.approval.revision,
          reason,
        )
      else
        await mappingApprovalAction(
          action,
          mapping.bookId,
          mapping.vouEntity,
          mapping.approval.approvalEntryId,
          mapping.approval.revision,
        )
      if (!active) return
      successMessage.value = '映射版本状态已更新。'
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) loading.value = false
    }
  }
  async function createNext(mapping: AccountingMapping): Promise<void> {
    if (!canCreateNext.value) return
    await createNextAccountingMapping(mapping.bookId, mapping.vouEntity)
    await query()
  }
  async function loadVersions(mapping: AccountingMapping): Promise<void> {
    if (!canVersions.value) return
    const result = await getAccountingMappingVersions(mapping.bookId, mapping.vouEntity)
    versions.value = result.data.items.map(projectMapping)
  }

  async function changeBook(bookId: string): Promise<void> {
    selectedBookId.value = bookId
    page.value = 1
    await query()
  }

  async function changePage(next: number): Promise<void> {
    page.value = next
    await query()
  }

  async function resetFilters(): Promise<void> {
    entityFilter.value = ''
    page.value = 1
    await query()
  }

  return reactive({
    books,
    rows,
    selectedBookId,
    entityFilter,
    total,
    page,
    pageSize,
    loading,
    saving,
    editorOpen,
    editing,
    catalog,
    versions,
    errorMessage,
    successMessage,
    form,
    canQuery,
    canCreate,
    canEdit,
    canApprove,
    canUnapprove,
    canSubmitApproval,
    canUnsubmitApproval,
    canRejectApproval,
    canCreateNext,
    canVersions,
    canDeleteVersion,
    canSubmit,
    validationError,
    bookOptions,
    initialize,
    query,
    loadCatalog,
    openCreate,
    openEdit,
    closeEditor,
    save,
    changeState,
    createNext,
    loadVersions,
    approvalReason,
    changeBook,
    changePage,
    resetFilters,
  })
}
