import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import type { ApprovalStatus } from '@/api/generated'
import { useSessionStore } from '@/stores/session'
import { visibleApprovalActions, type ApprovalAction } from '@/shared/approval'
import { queryAccountingBooks, type AccountingBook } from '../../acc/book/api'
import {
  createNextAccountingMapping,
  createAccountingMapping,
  getAccountingMapping,
  getAccountingMappingAuditHistory,
  getAccountingMappingCatalog,
  getAccountingMappingVersions,
  mappingApprovalAction,
  mappingReasonAction,
  queryAccountingMappings,
  saveAccountingMapping,
  type AccountingMapping,
  type AccountingMappingAuditEvent,
  type AccountingMappingCatalog,
  type AccountingMappingDefinition,
  type MappingContract,
} from './api'

const emptyDefinition: AccountingMappingDefinition = {
  defaultTemplateId: null,
  rules: [],
  templates: [],
}

export function createDclAccMappingViewModel() {
  const session = useSessionStore()
  const books = ref<AccountingBook[]>([])
  const rows = ref<AccountingMapping[]>([])
  const selectedBookId = ref('')
  const entityFilter = ref('')
  const statusFilter = ref<ApprovalStatus[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const loading = ref(false)
  const saving = ref(false)
  const editorOpen = ref(false)
  const editorReadOnly = ref(false)
  const editing = ref<AccountingMapping | null>(null)
  const catalog = ref<AccountingMappingCatalog | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const approvalReason = ref('')
  const versions = ref<AccountingMapping[]>([])
  const auditEvents = ref<AccountingMappingAuditEvent[]>([])
  const versionsOpen = ref(false)
  const auditOpen = ref(false)
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
    () =>
      session.can('/acc/book/query') && session.can('/dcl/acc-mapping/query'),
  )
  const canCreate = computed(
    () =>
      canQuery.value &&
      Boolean(selectedBookId.value) &&
      session.can('/dcl/acc-mapping/create') &&
      session.can('/acc/mapping/catalog'),
  )
  const canEdit = computed(
    () =>
      canQuery.value &&
      session.can('/dcl/acc-mapping/get') &&
      session.can('/dcl/acc-mapping/save') &&
      session.can('/acc/mapping/catalog'),
  )
  const canView = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/get'),
  )
  const canApprove = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/approve'),
  )
  const canUnapprove = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/unapprove'),
  )
  const canSubmitApproval = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/submit'),
  )
  const canUnsubmitApproval = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/unsubmit'),
  )
  const canRejectApproval = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/reject'),
  )
  const canCreateNext = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/create-next'),
  )
  const canVersions = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/versions'),
  )
  const canAudit = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/audit-history'),
  )
  const canDeleteVersion = computed(
    () => canQuery.value && session.can('/dcl/acc-mapping/delete-version'),
  )
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
      !editorReadOnly.value &&
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
        ...(statusFilter.value.length ? { status: statusFilter.value } : {}),
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
    return mapping
  }

  async function openCreate(source?: AccountingMapping): Promise<void> {
    if (!canCreate.value) return
    editing.value = null
    setForm(source)
    editorOpen.value = true
    await loadCatalog()
  }

  async function openEdit(
    mapping: AccountingMapping,
    readOnly = false,
  ): Promise<void> {
    if (!canView.value) {
      errorMessage.value = '没有权限查看会计映射。'
      return
    }
    editorReadOnly.value = readOnly || !canEdit.value
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
    editorReadOnly.value = false
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
          approvalRevision: editing.value.approval.revision,
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
    action:
      | 'submit'
      | 'unsubmit'
      | 'approve'
      | 'reject'
      | 'unapprove'
      | 'delete-version',
  ): Promise<void> {
    const permitted = {
      submit: canSubmitApproval.value,
      unsubmit: canUnsubmitApproval.value,
      approve: canApprove.value,
      reject: canRejectApproval.value,
      unapprove: canUnapprove.value,
      'delete-version': canDeleteVersion.value,
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
        await mappingReasonAction(action, mapping, reason)
      else await mappingApprovalAction(action, mapping)
      if (!active) return
      successMessage.value = '映射版本状态已更新。'
      if (
        editing.value?.approval.approvalEntryId ===
        mapping.approval.approvalEntryId
      )
        closeEditor()
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) loading.value = false
    }
  }

  function approvalActions(mapping: AccountingMapping): ApprovalAction[] {
    const permissions: Record<ApprovalAction, boolean> = {
      submit: canSubmitApproval.value,
      unsubmit: canUnsubmitApproval.value,
      reject: canRejectApproval.value,
      approve: canApprove.value,
      unapprove: canUnapprove.value,
    }
    return visibleApprovalActions(
      mapping.approval,
      session.user?.id ?? '',
      (action) => permissions[action],
    )
  }

  async function openByTarget(
    bookId: string,
    vouEntity: string,
    approvalEntryId: string,
    readOnly = true,
  ): Promise<void> {
    if (!bookId || !vouEntity || !approvalEntryId) return
    selectedBookId.value = bookId
    await query()
    await openEdit(
      {
        bookId,
        vouEntity,
        approval: { approvalEntryId },
      } as AccountingMapping,
      readOnly,
    )
  }
  async function createNext(mapping: AccountingMapping): Promise<void> {
    if (!canCreateNext.value) return
    await createNextAccountingMapping(mapping)
    await query()
  }
  async function loadVersions(mapping: AccountingMapping): Promise<void> {
    if (!canVersions.value) return
    errorMessage.value = null
    try {
      const result = await getAccountingMappingVersions(
        mapping.bookId,
        mapping.vouEntity,
      )
      versions.value = result.data.items.map(projectMapping)
      versionsOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  async function loadAudit(mapping: AccountingMapping): Promise<void> {
    if (!canAudit.value) return
    errorMessage.value = null
    try {
      const result = await getAccountingMappingAuditHistory(
        mapping.bookId,
        mapping.vouEntity,
      )
      auditEvents.value = result.data.items ?? []
      auditOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
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
    statusFilter.value = []
    page.value = 1
    await query()
  }

  return reactive({
    books,
    rows,
    selectedBookId,
    entityFilter,
    statusFilter,
    total,
    page,
    pageSize,
    loading,
    saving,
    editorOpen,
    editorReadOnly,
    editing,
    catalog,
    versions,
    auditEvents,
    versionsOpen,
    auditOpen,
    errorMessage,
    successMessage,
    form,
    canQuery,
    canCreate,
    canEdit,
    canView,
    canApprove,
    canUnapprove,
    canSubmitApproval,
    canUnsubmitApproval,
    canRejectApproval,
    canCreateNext,
    canVersions,
    canAudit,
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
    approvalActions,
    openByTarget,
    createNext,
    loadVersions,
    loadAudit,
    approvalReason,
    changeBook,
    changePage,
    resetFilters,
  })
}
