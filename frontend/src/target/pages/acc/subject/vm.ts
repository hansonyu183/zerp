import { computed, reactive, ref } from 'vue'
import {
  accSettlementPurposes,
  accSubjectDimensions,
  type AccSettlementPurpose,
  type AccSubjectDimension,
} from '@zerp/model'

import {
  createTargetAccSubject,
  deleteTargetAccSubject,
  queryTargetAccBooks,
  queryTargetAccSubjects,
  saveTargetAccSubject,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { createTargetId } from '../../../warehouse-drafts.ts'
import type { AccBook } from '../book/vm.ts'

export type AccSubject = Awaited<ReturnType<typeof createTargetAccSubject>>
export type AccSubjectCreateInput = Parameters<typeof createTargetAccSubject>[1]
export type AccSubjectSaveInput = Parameters<typeof saveTargetAccSubject>[1]

export const accDimensionOptions: ReadonlyArray<{
  title: string
  value: AccSubjectDimension
}> = [
  ['客户子单位', 'CUSTOMER_SUBUNIT'],
  ['供应商', 'SUPPLIER'],
  ['其他单位', 'OTHER_UNIT'],
  ['员工', 'EMPLOYEE'],
  ['销售合作方', 'SALES_PARTNER'],
  ['部门', 'DEPARTMENT'],
  ['商品', 'PRODUCT'],
  ['仓库', 'WAREHOUSE'],
  ['资金账户', 'FUND_ACCOUNT'],
  ['资产', 'ASSET'],
  ['票据', 'BILL'],
].map(([title, value]) => ({
  title: title!,
  value: value as AccSubjectDimension,
}))

export const accSettlementOptions: ReadonlyArray<{
  title: string
  value: AccSettlementPurpose
}> = [
  ['无', 'NONE'],
  ['应收', 'RECEIVABLE'],
  ['预付', 'PREPAID'],
  ['应付', 'PAYABLE'],
  ['预收', 'ADVANCE_RECEIPT'],
  ['其他往来', 'OTHER'],
].map(([title, value]) => ({
  title: title!,
  value: value as AccSettlementPurpose,
}))

if (
  accDimensionOptions.length !== accSubjectDimensions.length ||
  accSettlementOptions.length !== accSettlementPurposes.length
)
  throw new Error('ACC subject presentation is incomplete.')

export interface AccSubjectViewModelContext {
  csrfToken: string
  permissions: readonly string[]
}

export interface AccSubjectViewModelPorts {
  books(
    csrfToken: string,
    input: { page: 1; pageSize: 200 },
  ): Promise<{
    items: AccBook[]
    total: number
    page: number
    pageSize: number
  }>
  query(
    csrfToken: string,
    input: { bookId: string; page: number; pageSize: 20; keyword?: string },
  ): Promise<{
    items: AccSubject[]
    total: number
    page: number
    pageSize: number
  }>
  create(csrfToken: string, input: AccSubjectCreateInput): Promise<AccSubject>
  save(csrfToken: string, input: AccSubjectSaveInput): Promise<AccSubject>
  delete(
    csrfToken: string,
    input: Parameters<typeof deleteTargetAccSubject>[1],
  ): Promise<{ id: string; deleted: true }>
  id(): string
}

export function createAccSubjectViewModel(
  context: AccSubjectViewModelContext,
  ports: AccSubjectViewModelPorts,
) {
  const books = ref<AccBook[]>([])
  const selectedBookId = ref('')
  const items = ref<AccSubject[]>([])
  const total = ref(0)
  const page = ref(1)
  const keyword = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)
  const editorOpen = ref(false)
  const editing = ref<AccSubject | null>(null)
  const form = reactive({
    code: '',
    name: '',
    parentId: null as string | null,
    balanceDirection: 'DEBIT' as 'DEBIT' | 'CREDIT',
    enabled: true,
    requiredDimensions: [] as AccSubjectDimension[],
    inventoryQuantity: false,
    settlementPurpose: 'NONE' as AccSettlementPurpose,
  })
  let queryVersion = 0

  const canQuery = computed(
    () =>
      context.permissions.includes('/acc/book/query') &&
      context.permissions.includes('/acc/subject/query'),
  )
  const canCreate = computed(
    () =>
      canQuery.value &&
      !!selectedBookId.value &&
      context.permissions.includes('/acc/subject/create'),
  )
  const canEdit = computed(
    () => canQuery.value && context.permissions.includes('/acc/subject/save'),
  )
  const canDelete = computed(
    () => canQuery.value && context.permissions.includes('/acc/subject/delete'),
  )
  const bookOptions = computed(() =>
    books.value.map((book) => ({
      title: `${book.code} · ${book.name}`,
      value: book.id,
    })),
  )
  const parentOptions = computed(() =>
    items.value
      .filter((item) => item.id !== editing.value?.id)
      .map((item) => ({
        title: `${item.code} · ${item.name}`,
        value: item.id,
      })),
  )
  const validationError = computed(() => validateSubjectForm(form))
  const canSubmit = computed(
    () =>
      !saving.value &&
      !validationError.value &&
      (editing.value ? canEdit.value : canCreate.value),
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
      await query(1)
    } catch (cause) {
      error.value = errorMessage(cause, '会计科目初始化失败。')
    } finally {
      loading.value = false
    }
  }

  async function query(nextPage = page.value): Promise<void> {
    if (!canQuery.value || !selectedBookId.value) {
      items.value = []
      total.value = 0
      return
    }
    const version = ++queryVersion
    loading.value = true
    const search = keyword.value.trim()
    try {
      const result = await ports.query(context.csrfToken, {
        bookId: selectedBookId.value,
        page: nextPage,
        pageSize: 20,
        ...(search ? { keyword: search } : {}),
      })
      if (version !== queryVersion) return
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '会计科目查询失败。')
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function selectBook(bookId: string): Promise<void> {
    selectedBookId.value = bookId
    closeEditor()
    await query(1)
  }

  function resetForm(): void {
    Object.assign(form, {
      code: '',
      name: '',
      parentId: null,
      balanceDirection: 'DEBIT',
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    })
  }

  function openCreate(): void {
    if (!canCreate.value) {
      error.value = '没有权限创建会计科目。'
      return
    }
    editing.value = null
    resetForm()
    editorOpen.value = true
  }

  function openEdit(subject: AccSubject): void {
    if (!canEdit.value) {
      error.value = '没有权限编辑会计科目。'
      return
    }
    editing.value = subject
    Object.assign(form, {
      code: subject.code,
      name: subject.name,
      parentId: subject.parentId,
      balanceDirection: subject.balanceDirection,
      enabled: subject.enabled,
      requiredDimensions: [...subject.requiredDimensions],
      inventoryQuantity: subject.inventoryQuantity,
      settlementPurpose: subject.settlementPurpose,
    })
    editorOpen.value = true
  }

  function closeEditor(): void {
    editorOpen.value = false
    editing.value = null
    resetForm()
  }

  async function submit(): Promise<void> {
    if (!canSubmit.value || !selectedBookId.value) {
      error.value = validationError.value || '没有权限保存会计科目。'
      return
    }
    saving.value = true
    error.value = null
    const common = {
      bookId: selectedBookId.value,
      code: form.code.trim(),
      name: form.name.trim(),
      parentId: form.parentId,
      balanceDirection: form.balanceDirection,
      enabled: form.enabled,
      requiredDimensions: [...form.requiredDimensions],
      inventoryQuantity: form.inventoryQuantity,
      settlementPurpose: form.settlementPurpose,
    }
    try {
      const wasEditing = editing.value !== null
      if (editing.value)
        await ports.save(context.csrfToken, {
          id: editing.value.id,
          expectedRevision: editing.value.revision,
          ...common,
        })
      else await ports.create(context.csrfToken, { id: ports.id(), ...common })
      message.value = wasEditing ? '科目已保存。' : '科目已创建。'
      closeEditor()
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '会计科目保存失败。')
    } finally {
      saving.value = false
    }
  }

  async function remove(subject: AccSubject): Promise<void> {
    if (!canDelete.value) {
      error.value = '没有权限删除会计科目。'
      return
    }
    try {
      await ports.delete(context.csrfToken, {
        id: subject.id,
        expectedRevision: subject.revision,
      })
      message.value = '科目已删除。'
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(
        cause,
        '科目删除失败；请按服务端 blocker 处理。',
      )
      await query(page.value)
    }
  }

  return {
    books,
    selectedBookId,
    items,
    total,
    page,
    keyword,
    loading,
    saving,
    error,
    message,
    editorOpen,
    editing,
    form,
    canQuery,
    canCreate,
    canEdit,
    canDelete,
    canSubmit,
    bookOptions,
    parentOptions,
    validationError,
    initialize,
    query,
    selectBook,
    openCreate,
    openEdit,
    closeEditor,
    submit,
    remove,
  }
}

export function useAccSubjectViewModel() {
  const session = useTargetSession()
  if (!session.csrfToken)
    throw new Error(
      'Accounting subject page requires an authenticated session.',
    )
  return createAccSubjectViewModel(
    { csrfToken: session.csrfToken, permissions: session.permissions },
    {
      books: queryTargetAccBooks,
      query: queryTargetAccSubjects,
      create: createTargetAccSubject,
      save: saveTargetAccSubject,
      delete: deleteTargetAccSubject,
      id: createTargetId,
    },
  )
}

function validateSubjectForm(form: {
  code: string
  name: string
  requiredDimensions: AccSubjectDimension[]
  inventoryQuantity: boolean
  settlementPurpose: AccSettlementPurpose
}): string {
  if (!form.code.trim()) return '请输入科目编码。'
  if (!form.name.trim()) return '请输入科目名称。'
  const dimensions = new Set(form.requiredDimensions)
  if (
    form.inventoryQuantity &&
    (!dimensions.has('PRODUCT') || !dimensions.has('WAREHOUSE'))
  )
    return '数量核算必须同时选择商品和仓库辅助核算。'
  if (
    (form.settlementPurpose === 'RECEIVABLE' ||
      form.settlementPurpose === 'ADVANCE_RECEIPT') &&
    !dimensions.has('CUSTOMER_SUBUNIT')
  )
    return '应收或预收必须选择客户子单位辅助核算。'
  if (
    (form.settlementPurpose === 'PREPAID' ||
      form.settlementPurpose === 'PAYABLE') &&
    !dimensions.has('SUPPLIER')
  )
    return '预付或应付必须选择供应商辅助核算。'
  if (
    form.settlementPurpose === 'OTHER' &&
    ![
      'CUSTOMER_SUBUNIT',
      'SUPPLIER',
      'OTHER_UNIT',
      'EMPLOYEE',
      'SALES_PARTNER',
    ].some((dimension) => dimensions.has(dimension as AccSubjectDimension))
  )
    return '其他往来必须选择一种明确业务档案辅助核算。'
  return ''
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
