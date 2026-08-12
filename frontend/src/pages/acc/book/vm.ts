import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  createAccountingBook,
  deleteAccountingBook,
  getAccountingBook,
  queryAccessUsers,
  queryAccountingBooks,
  saveAccountingBook,
  type AccessUser,
  type AccountingBook,
} from './api'

export function createAccountingBookViewModel() {
  const session = useSessionStore()
  const rows = ref<AccountingBook[]>([])
  const users = ref<AccessUser[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorOpen = ref(false)
  const editing = ref<AccountingBook | null>(null)
  let querySequence = 0
  let editorSequence = 0
  let active = true
  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
      querySequence += 1
      editorSequence += 1
    })
  }
  const form = reactive({
    name: '',
    description: '',
    startMonth: '',
    baseCurrency: 'CNY',
    subjectTemplate: 'ENTERPRISE' as AccountingBook['subjectTemplate'],
    queryUserIds: [] as string[],
    operateUserIds: [] as string[],
  })

  const canQuery = computed(() => session.can('/acc/book/query'))
  const canReadUsers = computed(() => session.can('/app/user/query'))
  const canCreate = computed(
    () =>
      canQuery.value && session.can('/acc/book/create') && canReadUsers.value,
  )
  const canEdit = computed(
    () =>
      canQuery.value &&
      session.can('/acc/book/get') &&
      session.can('/acc/book/save') &&
      canReadUsers.value,
  )
  const userOptions = computed(() =>
    users.value
      .filter((user) => user.status === 'ENABLED')
      .map((user) => ({
        title: `${user.username} · ${user.displayName}`,
        value: user.id,
      })),
  )
  const validationError = computed(() => {
    if (!form.name.trim()) return '请输入账簿名称。'
    if (!editing.value && !/^\d{4}-(0[1-9]|1[0-2])$/.test(form.startMonth)) {
      return '请选择开始月份。'
    }
    if (!/^[A-Za-z]{3}$/.test(form.baseCurrency.trim())) {
      return '基础币种必须是三位字母。'
    }
    return ''
  })
  const canSubmit = computed(
    () =>
      !saving.value &&
      validationError.value === '' &&
      (editing.value ? canEdit.value : canCreate.value),
  )

  function canDelete(book: AccountingBook): boolean {
    return (
      !book.controlBook && canQuery.value && session.can('/acc/book/delete')
    )
  }

  async function query(): Promise<void> {
    if (!canQuery.value) return
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const search = keyword.value.trim()
      const result = await queryAccountingBooks({
        page: page.value,
        pageSize: pageSize.value,
        ...(search ? { keyword: search } : {}),
      })
      if (!active || sequence !== querySequence) return
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      if (!active || sequence !== querySequence) return
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && sequence === querySequence) loading.value = false
    }
  }

  async function loadUsers(sequence: number): Promise<void> {
    const collected: AccessUser[] = []
    let nextPage = 1
    let expected = 1
    while (collected.length < expected) {
      const result = await queryAccessUsers({
        page: nextPage,
        pageSize: 200,
        sort: [{ field: 'username', order: 'asc' }],
      })
      if (!active || sequence !== editorSequence) return
      collected.push(...result.data.items)
      expected = result.data.total
      nextPage += 1
      if (result.data.items.length === 0) break
    }
    if (active && sequence === editorSequence) users.value = collected
  }

  function resetForm(): void {
    form.name = ''
    form.description = ''
    form.startMonth = ''
    form.baseCurrency = 'CNY'
    form.subjectTemplate = 'ENTERPRISE'
    form.queryUserIds = []
    form.operateUserIds = []
  }

  async function openCreate(): Promise<void> {
    if (!canCreate.value) {
      errorMessage.value = '没有权限创建会计账簿。'
      return
    }
    const sequence = ++editorSequence
    editing.value = null
    resetForm()
    editorOpen.value = true
    try {
      await loadUsers(sequence)
    } catch (error) {
      if (active && sequence === editorSequence)
        errorMessage.value = getErrorMessage(error)
    }
  }

  async function openEdit(book: AccountingBook): Promise<void> {
    if (!canEdit.value) {
      errorMessage.value = '没有权限编辑会计账簿。'
      return
    }
    const sequence = ++editorSequence
    loading.value = true
    errorMessage.value = null
    try {
      const [detail] = await Promise.all([
        getAccountingBook(book.bookId),
        loadUsers(sequence),
      ])
      if (!active || sequence !== editorSequence) return
      editing.value = detail.data
      form.name = detail.data.name
      form.description = detail.data.description
      form.startMonth = detail.data.startMonth
      form.baseCurrency = detail.data.baseCurrency
      form.subjectTemplate = detail.data.subjectTemplate
      form.queryUserIds = [...detail.data.queryUserIds]
      form.operateUserIds = [...detail.data.operateUserIds]
      editorOpen.value = true
    } catch (error) {
      if (active && sequence === editorSequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && sequence === editorSequence) loading.value = false
    }
  }

  function closeEditor(): void {
    editorSequence += 1
    editorOpen.value = false
    editing.value = null
    resetForm()
  }

  async function save(): Promise<void> {
    if (!canSubmit.value) {
      errorMessage.value = validationError.value || '没有权限保存会计账簿。'
      return
    }
    saving.value = true
    errorMessage.value = null
    const common = {
      name: form.name.trim(),
      description: form.description.trim(),
      baseCurrency: form.baseCurrency.trim().toUpperCase(),
      queryUserIds: [...form.queryUserIds],
      operateUserIds: [...form.operateUserIds],
    }
    try {
      if (editing.value) {
        await saveAccountingBook({
          ...common,
          bookId: editing.value.bookId,
          revision: editing.value.revision,
        })
      } else {
        await createAccountingBook({
          ...common,
          startMonth: form.startMonth,
          subjectTemplate: form.subjectTemplate,
        })
      }
      if (!active) return
      successMessage.value = editing.value ? '账簿已保存。' : '账簿已创建。'
      closeEditor()
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function remove(book: AccountingBook): Promise<void> {
    if (!canDelete(book)) {
      errorMessage.value = book.controlBook
        ? '业务控制账簿不能删除。'
        : '没有权限删除会计账簿。'
      return
    }
    loading.value = true
    errorMessage.value = null
    try {
      await deleteAccountingBook(book.bookId, book.revision)
      if (!active) return
      successMessage.value = '账簿已删除。'
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

  async function changePage(next: number): Promise<void> {
    if (next < 1 || next === page.value || loading.value) return
    page.value = next
    await query()
  }

  return reactive({
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
    userOptions,
    validationError,
    canSubmit,
    canDelete,
    query,
    search,
    resetFilters,
    changePage,
    openCreate,
    openEdit,
    closeEditor,
    save,
    remove,
  })
}

export type AccountingBookViewModel = ReturnType<
  typeof createAccountingBookViewModel
>
