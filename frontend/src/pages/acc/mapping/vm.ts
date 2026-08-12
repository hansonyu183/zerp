import { computed, reactive, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { queryAccountingBooks, type AccountingBook } from '../book/api'
import {
  approveAccountingMapping,
  createAccountingMapping,
  getAccountingMapping,
  getAccountingMappingCatalog,
  queryAccountingMappings,
  saveAccountingMapping,
  unapproveAccountingMapping,
  type AccountingMapping,
  type AccountingMappingCatalog,
  type AccountingMappingDefinition,
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
  const form = reactive({
    vouEntity: 'sale-order',
    defaultResult: 'UN_POST' as AccountingMapping['defaultResult'],
    definitionText: JSON.stringify(emptyDefinition, null, 2),
  })

  const canQuery = computed(
    () => session.can('/acc/book/query') && session.can('/acc/mapping/query'),
  )
  const canCreate = computed(
    () => Boolean(selectedBookId.value) && session.can('/acc/mapping/create'),
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
      !validationError.value &&
      (editing.value
        ? editing.value.state === 'DRAFT' && session.can('/acc/mapping/save')
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
    loading.value = true
    try {
      const result = await queryAccountingBooks({ page: 1, pageSize: 200 })
      books.value = result.data.items
      if (!selectedBookId.value && books.value.length)
        selectedBookId.value = books.value[0].bookId
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function query(): Promise<void> {
    if (!canQuery.value || !selectedBookId.value) return
    loading.value = true
    try {
      const result = await queryAccountingMappings({
        bookId: selectedBookId.value,
        page: page.value,
        pageSize: pageSize.value,
        ...(entityFilter.value ? { vouEntity: entityFilter.value } : {}),
      })
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function loadCatalog(): Promise<void> {
    if (!session.can('/acc/mapping/catalog')) return
    try {
      catalog.value = (await getAccountingMappingCatalog(form.vouEntity)).data
    } catch (error) {
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

  async function openCreate(source?: AccountingMapping): Promise<void> {
    if (!canCreate.value) return
    editing.value = null
    setForm(source)
    editorOpen.value = true
    await loadCatalog()
  }

  async function openEdit(mapping: AccountingMapping): Promise<void> {
    if (!session.can('/acc/mapping/get') || !session.can('/acc/mapping/save'))
      return
    loading.value = true
    try {
      const result = await getAccountingMapping(
        mapping.bookId,
        mapping.mappingId,
      )
      editing.value = result.data
      setForm(result.data)
      editorOpen.value = true
      await loadCatalog()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function closeEditor(): void {
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
    try {
      if (editing.value) {
        await saveAccountingMapping({
          bookId: editing.value.bookId,
          mappingId: editing.value.mappingId,
          revision: editing.value.revision,
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
      successMessage.value = editing.value
        ? '映射草稿已保存。'
        : '映射版本已创建。'
      closeEditor()
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function changeState(
    mapping: AccountingMapping,
    approve: boolean,
  ): Promise<void> {
    const path = approve ? '/acc/mapping/approve' : '/acc/mapping/unapprove'
    if (!session.can(path)) return
    loading.value = true
    try {
      if (approve)
        await approveAccountingMapping(
          mapping.bookId,
          mapping.mappingId,
          mapping.revision,
        )
      else
        await unapproveAccountingMapping(
          mapping.bookId,
          mapping.mappingId,
          mapping.revision,
        )
      successMessage.value = approve ? '映射版本已批准。' : '映射版本已反批准。'
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
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
    errorMessage,
    successMessage,
    form,
    canQuery,
    canCreate,
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
    changeBook,
    changePage,
  })
}
