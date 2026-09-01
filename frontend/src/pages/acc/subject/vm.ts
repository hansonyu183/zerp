import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { getDiagnosticErrorMessage, getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { queryAccountingBooks, type AccountingBook } from '../book/api'
import {
  createAccountingSubject,
  deleteAccountingSubject,
  getAccountingSubject,
  queryAccountingSubjects,
  saveAccountingSubject,
  type AccountingSubject,
} from './api'

type BalanceDirection = AccountingSubject['balanceDirection']
type SettlementPurpose = AccountingSubject['settlementPurpose']
type SubjectDimension = AccountingSubject['requiredDimensions'][number]

export const dimensionOptions: readonly {
  title: string
  value: SubjectDimension
}[] = [
  { title: '客户结算账户', value: 'CUSTOMER_ACCOUNT' },
  { title: '供应商', value: 'SUPPLIER' },
  { title: '其他单位', value: 'OTHER_UNIT' },
  { title: '员工', value: 'EMPLOYEE' },
  { title: '销售合作方', value: 'SALES_PARTNER' },
  { title: '部门', value: 'DEPARTMENT' },
  { title: '商品', value: 'PRODUCT' },
  { title: '仓库', value: 'WAREHOUSE' },
  { title: '资金账户', value: 'FUND_ACCOUNT' },
  { title: '资产', value: 'ASSET' },
  { title: '票据', value: 'BILL' },
]

export const settlementOptions: readonly {
  title: string
  value: SettlementPurpose
}[] = [
  { title: '无', value: 'NONE' },
  { title: '应收', value: 'RECEIVABLE' },
  { title: '预付', value: 'PREPAID' },
  { title: '应付', value: 'PAYABLE' },
  { title: '预收', value: 'ADVANCE_RECEIPT' },
  { title: '其他往来', value: 'OTHER' },
]

export function createAccountingSubjectViewModel() {
  const session = useSessionStore()
  const books = ref<AccountingBook[]>([])
  const selectedBookId = ref('')
  const rows = ref<AccountingSubject[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(200)
  const keyword = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorOpen = ref(false)
  const editing = ref<AccountingSubject | null>(null)
  let sequence = 0
  let active = true
  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
      sequence += 1
    })
  }

  const form = reactive({
    code: '',
    name: '',
    parentSubjectId: null as string | null,
    balanceDirection: 'DEBIT' as BalanceDirection,
    enabled: true,
    requiredDimensions: [] as SubjectDimension[],
    inventoryQuantity: false,
    settlementPurpose: 'NONE' as SettlementPurpose,
  })

  const canQuery = computed(
    () => session.can('/acc/book/query') && session.can('/acc/subject/query'),
  )
  const canCreate = computed(
    () =>
      canQuery.value &&
      Boolean(selectedBookId.value) &&
      session.can('/acc/subject/create'),
  )
  const canEdit = computed(
    () =>
      canQuery.value &&
      session.can('/acc/subject/get') &&
      session.can('/acc/subject/save'),
  )
  const bookOptions = computed(() =>
    books.value.map((book) => ({
      title: `${book.code} · ${book.name}`,
      value: book.bookId,
    })),
  )
  const parentOptions = computed(() =>
    rows.value
      .filter((subject) => subject.subjectId !== editing.value?.subjectId)
      .map((subject) => ({
        title: `${subject.code} · ${subject.name}`,
        value: subject.subjectId,
      })),
  )
  const validationError = computed(() => {
    if (!form.code.trim()) return '请输入科目编码。'
    if (!form.name.trim()) return '请输入科目名称。'
    const dimensions = new Set(form.requiredDimensions)
    if (
      form.inventoryQuantity &&
      (!dimensions.has('PRODUCT') || !dimensions.has('WAREHOUSE'))
    ) {
      return '数量核算必须同时选择商品和仓库辅助核算。'
    }
    if (
      ['RECEIVABLE', 'ADVANCE_RECEIPT'].includes(form.settlementPurpose) &&
      !dimensions.has('CUSTOMER_ACCOUNT')
    ) {
      return '该往来用途必须选择客户辅助核算。'
    }
    if (
      ['PREPAID', 'PAYABLE'].includes(form.settlementPurpose) &&
      !dimensions.has('SUPPLIER')
    ) {
      return '该往来用途必须选择供应商辅助核算。'
    }
    return ''
  })
  const canSubmit = computed(
    () =>
      !saving.value &&
      validationError.value === '' &&
      (editing.value ? canEdit.value : canCreate.value),
  )

  function canDelete(subject: AccountingSubject): boolean {
    return (
      canQuery.value &&
      !subject.referenced &&
      subject.leaf &&
      session.can('/acc/subject/delete')
    )
  }

  async function initialize(): Promise<void> {
    if (!canQuery.value) return
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryAccountingBooks({ page: 1, pageSize: 200 })
      if (!active || current !== sequence) return
      books.value = result.data.items
      if (!selectedBookId.value && books.value.length > 0) {
        selectedBookId.value = books.value[0]!.bookId
      }
      await query(current)
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function query(existingSequence?: number): Promise<boolean> {
    if (!canQuery.value || !selectedBookId.value) {
      rows.value = []
      total.value = 0
      return false
    }
    const current = existingSequence ?? ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const search = keyword.value.trim()
      const result = await queryAccountingSubjects({
        bookId: selectedBookId.value,
        page: page.value,
        pageSize: pageSize.value,
        ...(search ? { keyword: search } : {}),
      })
      if (!active || current !== sequence) return false
      rows.value = result.data.items
      total.value = result.data.total
      return true
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function selectBook(bookId: string): Promise<void> {
    selectedBookId.value = bookId
    page.value = 1
    closeEditor()
    await query()
  }

  function resetForm(): void {
    form.code = ''
    form.name = ''
    form.parentSubjectId = null
    form.balanceDirection = 'DEBIT'
    form.enabled = true
    form.requiredDimensions = []
    form.inventoryQuantity = false
    form.settlementPurpose = 'NONE'
  }

  function openCreate(): void {
    if (!canCreate.value) {
      errorMessage.value = '没有权限创建会计科目。'
      return
    }
    editing.value = null
    resetForm()
    editorOpen.value = true
  }

  async function openEdit(subject: AccountingSubject): Promise<void> {
    if (!canEdit.value) {
      errorMessage.value = '没有权限编辑会计科目。'
      return
    }
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await getAccountingSubject(
        selectedBookId.value,
        subject.subjectId,
      )
      if (!active || current !== sequence) return
      editing.value = result.data
      form.code = result.data.code
      form.name = result.data.name
      form.parentSubjectId = result.data.parentSubjectId
      form.balanceDirection = result.data.balanceDirection
      form.enabled = result.data.enabled
      form.requiredDimensions = [...result.data.requiredDimensions]
      form.inventoryQuantity = result.data.inventoryQuantity
      form.settlementPurpose = result.data.settlementPurpose
      editorOpen.value = true
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  function closeEditor(): void {
    editorOpen.value = false
    editing.value = null
    resetForm()
  }

  async function save(): Promise<void> {
    if (!canSubmit.value || !selectedBookId.value) {
      errorMessage.value = validationError.value || '没有权限保存会计科目。'
      return
    }
    saving.value = true
    errorMessage.value = null
    const common = {
      bookId: selectedBookId.value,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      ...(form.parentSubjectId
        ? { parentSubjectId: form.parentSubjectId }
        : {}),
      balanceDirection: form.balanceDirection,
      enabled: form.enabled,
      requiredDimensions: [...form.requiredDimensions],
      inventoryQuantity: form.inventoryQuantity,
      settlementPurpose: form.settlementPurpose,
    }
    try {
      const wasEditing = Boolean(editing.value)
      const result = editing.value
        ? await saveAccountingSubject({
          ...common,
          subjectId: editing.value.subjectId,
          revision: editing.value.revision,
        })
        : await createAccountingSubject(common)
      if (!active) return
      await getAccountingSubject(
        selectedBookId.value,
        result.data.subjectId,
      )
      if (!active) return
      if (!(await query())) return
      successMessage.value = wasEditing ? '科目已保存。' : '科目已创建。'
      closeEditor()
    } catch (error) {
      if (active) errorMessage.value = getDiagnosticErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function remove(subject: AccountingSubject): Promise<void> {
    if (!canDelete(subject)) {
      errorMessage.value = '已引用或有下级的科目不能删除。'
      return
    }
    loading.value = true
    errorMessage.value = null
    try {
      await deleteAccountingSubject(
        selectedBookId.value,
        subject.subjectId,
        subject.revision,
      )
      if (!active) return
      successMessage.value = '科目已删除。'
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) loading.value = false
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    keyword.value = ''
    await search()
  }

  return reactive({
    books,
    selectedBookId,
    rows,
    total,
    page,
    pageSize,
    keyword,
    loading,
    saving,
    errorMessage,
    successMessage,
    editorOpen,
    editing,
    form,
    canQuery,
    canCreate,
    canEdit,
    canSubmit,
    bookOptions,
    parentOptions,
    validationError,
    canDelete,
    initialize,
    query,
    selectBook,
    openCreate,
    openEdit,
    closeEditor,
    save,
    remove,
    search,
    resetFilters,
  })
}
