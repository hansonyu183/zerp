import { computed, reactive, ref } from 'vue'
import type { AccBookTemplate } from '@zerp/model'

import {
  createTargetAccBook,
  deleteTargetAccBook,
  queryTargetAccBooks,
  queryTargetUsers,
  saveTargetAccBook,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { createTargetId } from '../../../warehouse-drafts.ts'

export type AccBook = Awaited<ReturnType<typeof createTargetAccBook>>
export type AccBookCreateInput = Parameters<typeof createTargetAccBook>[1]
export type AccBookSaveInput = Parameters<typeof saveTargetAccBook>[1]

export interface AccBookQueryInput {
  page: number
  pageSize: 20
  keyword?: string
}

export interface AccBookAccessUser {
  id: string
  username: string
  displayName: string
  status: 'ENABLED' | 'DISABLED'
}

export interface AccBookViewModelContext {
  csrfToken: string
  permissions: readonly string[]
}

export interface AccBookViewModelPorts {
  query(
    csrfToken: string,
    input: AccBookQueryInput,
  ): Promise<{
    items: AccBook[]
    total: number
    page: number
    pageSize: number
  }>
  users(
    csrfToken: string,
    input: { page: number; pageSize: 20 },
  ): Promise<{
    items: AccBookAccessUser[]
    total: number
    page: number
    pageSize: number
  }>
  create(csrfToken: string, input: AccBookCreateInput): Promise<AccBook>
  save(csrfToken: string, input: AccBookSaveInput): Promise<AccBook>
  delete(
    csrfToken: string,
    input: Parameters<typeof deleteTargetAccBook>[1],
  ): Promise<{ id: string; deleted: true }>
  id(): string
}

export function createAccBookViewModel(
  context: AccBookViewModelContext,
  ports: AccBookViewModelPorts,
) {
  const items = ref<AccBook[]>([])
  const total = ref(0)
  const page = ref(1)
  const keyword = ref('')
  const users = ref<AccBookAccessUser[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)
  const editorOpen = ref(false)
  const editing = ref<AccBook | null>(null)
  const form = reactive({
    name: '',
    description: '',
    startMonth: '',
    baseCurrency: 'CNY',
    subjectTemplate: 'ENTERPRISE' as AccBookTemplate,
    queryUserIds: [] as string[],
    operateUserIds: [] as string[],
  })
  let queryVersion = 0

  const canQuery = computed(() =>
    context.permissions.includes('/acc/book/query'),
  )
  const canCreate = computed(
    () =>
      canQuery.value &&
      context.permissions.includes('/acc/book/create') &&
      context.permissions.includes('/app/user/query'),
  )
  const canEdit = computed(
    () =>
      canQuery.value &&
      context.permissions.includes('/acc/book/save') &&
      context.permissions.includes('/app/user/query'),
  )
  const accessUserOptions = computed(() =>
    users.value
      .filter((user) => user.status === 'ENABLED')
      .map((user) => ({
        title: `${user.username} · ${user.displayName}`,
        value: user.id,
      })),
  )
  const validationError = computed(() => {
    if (!form.name.trim()) return '请输入账簿名称。'
    if (!editing.value && !/^\d{4}-(0[1-9]|1[0-2])$/.test(form.startMonth))
      return '请选择开始月份。'
    if (!/^[A-Za-z]{3}$/.test(form.baseCurrency.trim()))
      return '基础币种必须是三位字母。'
    return ''
  })
  const canSubmit = computed(
    () =>
      !saving.value &&
      !validationError.value &&
      (editing.value ? canEdit.value : canCreate.value),
  )

  function queryInput(nextPage: number): AccBookQueryInput {
    const search = keyword.value.trim()
    return {
      page: nextPage,
      pageSize: 20,
      ...(search ? { keyword: search } : {}),
    }
  }

  async function query(nextPage = page.value): Promise<void> {
    if (!canQuery.value) return
    const version = ++queryVersion
    loading.value = true
    try {
      const result = await ports.query(context.csrfToken, queryInput(nextPage))
      if (version !== queryVersion) return
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '会计账簿查询失败。')
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function loadUsers(): Promise<void> {
    if (!context.permissions.includes('/app/user/query')) return
    const collected: AccBookAccessUser[] = []
    let nextPage = 1
    let expected = 1
    while (collected.length < expected) {
      const result = await ports.users(context.csrfToken, {
        page: nextPage,
        pageSize: 20,
      })
      collected.push(...result.items)
      expected = result.total
      if (result.items.length === 0) break
      nextPage += 1
    }
    users.value = collected
  }

  function resetForm(): void {
    Object.assign(form, {
      name: '',
      description: '',
      startMonth: '',
      baseCurrency: 'CNY',
      subjectTemplate: 'ENTERPRISE',
      queryUserIds: [],
      operateUserIds: [],
    })
  }

  async function openCreate(): Promise<void> {
    if (!canCreate.value) {
      error.value = '没有权限创建会计账簿。'
      return
    }
    editing.value = null
    resetForm()
    editorOpen.value = true
    try {
      await loadUsers()
    } catch (cause) {
      error.value = errorMessage(cause, '访问范围用户加载失败。')
    }
  }

  async function openEdit(book: AccBook): Promise<void> {
    if (!canEdit.value) {
      error.value = '没有权限编辑会计账簿。'
      return
    }
    editing.value = book
    Object.assign(form, {
      name: book.name,
      description: book.description,
      startMonth: book.startMonth,
      baseCurrency: book.baseCurrency,
      subjectTemplate: 'EMPTY',
      queryUserIds: [...book.queryUserIds],
      operateUserIds: [...book.operateUserIds],
    })
    editorOpen.value = true
    try {
      await loadUsers()
    } catch (cause) {
      error.value = errorMessage(cause, '访问范围用户加载失败。')
    }
  }

  function closeEditor(): void {
    editorOpen.value = false
    editing.value = null
    resetForm()
  }

  async function submit(): Promise<void> {
    if (!canSubmit.value) {
      error.value = validationError.value || '没有权限保存会计账簿。'
      return
    }
    saving.value = true
    error.value = null
    const common = {
      name: form.name.trim(),
      description: form.description.trim(),
      baseCurrency: form.baseCurrency.trim().toUpperCase(),
      queryUserIds: [...form.queryUserIds],
      operateUserIds: [...form.operateUserIds],
    }
    try {
      const wasEditing = editing.value !== null
      if (editing.value) {
        await ports.save(context.csrfToken, {
          id: editing.value.id,
          expectedRevision: editing.value.revision,
          ...common,
        })
      } else {
        await ports.create(context.csrfToken, {
          id: ports.id(),
          ...common,
          startMonth: form.startMonth,
          subjectTemplate: form.subjectTemplate,
        })
      }
      message.value = wasEditing ? '账簿已保存。' : '账簿已创建。'
      closeEditor()
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '会计账簿保存失败。')
    } finally {
      saving.value = false
    }
  }

  function canDelete(book: AccBook): boolean {
    return !book.controlBook && context.permissions.includes('/acc/book/delete')
  }

  async function remove(book: AccBook): Promise<void> {
    if (!canDelete(book)) {
      error.value = book.controlBook
        ? '业务控制账簿不能删除。'
        : '没有权限删除会计账簿。'
      return
    }
    try {
      await ports.delete(context.csrfToken, {
        id: book.id,
        expectedRevision: book.revision,
      })
      message.value = '账簿已删除。'
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '会计账簿删除失败。')
      await query(page.value)
    }
  }

  return {
    items,
    total,
    page,
    keyword,
    users,
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
    accessUserOptions,
    validationError,
    canSubmit,
    query,
    openCreate,
    openEdit,
    closeEditor,
    submit,
    canDelete,
    remove,
  }
}

export function useAccBookViewModel() {
  const session = useTargetSession()
  if (!session.csrfToken)
    throw new Error('Accounting book page requires an authenticated session.')
  return createAccBookViewModel(
    { csrfToken: session.csrfToken, permissions: session.permissions },
    {
      query: queryTargetAccBooks,
      users: async (csrfToken, input) => {
        const result = await queryTargetUsers(csrfToken, {
          ...input,
          sort: [{ field: 'username', order: 'asc' }],
        })
        return {
          items: result.items.map((user) => ({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            status: user.status,
          })),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
        }
      },
      create: createTargetAccBook,
      save: saveTargetAccBook,
      delete: deleteTargetAccBook,
      id: createTargetId,
    },
  )
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
