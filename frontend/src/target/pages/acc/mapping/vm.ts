import { computed, ref } from 'vue'

import {
  getTargetAccMappingCurrent,
  queryTargetAccBooks,
  queryTargetAccMappingCatalog,
  queryTargetAccMappingCurrent,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import type { AccBook } from '../book/vm.ts'

export type AccMappingPage = Awaited<
  ReturnType<typeof queryTargetAccMappingCurrent>
>
export type AccMappingItem = AccMappingPage['items'][number]
export type AccMappingDetail = Awaited<
  ReturnType<typeof getTargetAccMappingCurrent>
>
export type AccMappingCatalog = Awaited<
  ReturnType<typeof queryTargetAccMappingCatalog>
>

export interface AccMappingViewModelPorts {
  books(
    csrfToken: string,
    input: { page: 1; pageSize: 200 },
  ): Promise<{
    items: AccBook[]
    total: number
    page: number
    pageSize: number
  }>
  catalog(csrfToken: string): Promise<AccMappingCatalog>
  query(
    csrfToken: string,
    input: {
      bookId: string
      vouEntity?: string
      page: number
      pageSize: number
    },
  ): Promise<AccMappingPage>
  get(
    csrfToken: string,
    input: { bookId: string; vouEntity: string },
  ): Promise<AccMappingDetail>
}

export function createAccMappingViewModel(
  context: { csrfToken: string; permissions: readonly string[] },
  ports: AccMappingViewModelPorts,
) {
  const books = ref<AccBook[]>([])
  const catalog = ref<AccMappingCatalog | null>(null)
  const items = ref<AccMappingItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const selectedBookId = ref('')
  const vouEntity = ref('')
  const detail = ref<AccMappingDetail | null>(null)
  const detailOpen = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let queryVersion = 0

  const canQuery = computed(
    () =>
      context.permissions.includes('/acc/book/query') &&
      context.permissions.includes('/acc/mapping/query'),
  )
  const canView = computed(() =>
    context.permissions.includes('/acc/mapping/get'),
  )
  const canMaintain = computed(() =>
    context.permissions.includes('/dcl/acc-mapping/query'),
  )
  const maintenanceRoute = '/dcl/acc-mapping' as const
  const bookOptions = computed(() =>
    books.value.map((book) => ({
      title: `${book.code} · ${book.name}`,
      value: book.id,
    })),
  )
  const entityOptions = computed(
    () =>
      catalog.value?.vouEntities.map((entity) => ({
        title: `${entity.code} · ${entity.name}`,
        value: entity.id,
      })) ?? [],
  )

  async function initialize(): Promise<void> {
    if (!canQuery.value) return
    loading.value = true
    try {
      const [bookPage, fieldCatalog] = await Promise.all([
        ports.books(context.csrfToken, { page: 1, pageSize: 200 }),
        context.permissions.includes('/acc/mapping/catalog')
          ? ports.catalog(context.csrfToken)
          : Promise.resolve(null),
      ])
      books.value = bookPage.items
      catalog.value = fieldCatalog
      selectedBookId.value ||= books.value[0]?.id ?? ''
      await query(1)
    } catch (cause) {
      error.value = errorMessage(cause, '当前会计映射初始化失败。')
    } finally {
      loading.value = false
    }
  }

  async function query(nextPage = page.value): Promise<void> {
    if (!canQuery.value || !selectedBookId.value) return
    const version = ++queryVersion
    loading.value = true
    try {
      const result = await ports.query(context.csrfToken, {
        bookId: selectedBookId.value,
        ...(vouEntity.value ? { vouEntity: vouEntity.value } : {}),
        page: nextPage,
        pageSize: 20,
      })
      if (version !== queryVersion) return
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '当前会计映射查询失败。')
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function selectBook(bookId: string): Promise<void> {
    selectedBookId.value = bookId
    detail.value = null
    await query(1)
  }

  async function open(item: AccMappingItem): Promise<void> {
    if (!canView.value) return
    try {
      detail.value = await ports.get(context.csrfToken, {
        bookId: item.book.id,
        vouEntity: item.vouEntity.id,
      })
      detailOpen.value = true
    } catch (cause) {
      error.value = errorMessage(cause, '当前会计映射读取失败。')
    }
  }

  function close(): void {
    detailOpen.value = false
    detail.value = null
  }

  return {
    books,
    catalog,
    items,
    total,
    page,
    selectedBookId,
    vouEntity,
    detail,
    detailOpen,
    loading,
    error,
    canQuery,
    canView,
    canMaintain,
    maintenanceRoute,
    bookOptions,
    entityOptions,
    initialize,
    query,
    selectBook,
    open,
    close,
  }
}

export function useAccMappingViewModel() {
  const session = useTargetSession()
  if (!session.csrfToken)
    throw new Error(
      'Accounting mapping page requires an authenticated session.',
    )
  return createAccMappingViewModel(
    { csrfToken: session.csrfToken, permissions: session.permissions },
    {
      books: queryTargetAccBooks,
      catalog: queryTargetAccMappingCatalog,
      query: queryTargetAccMappingCurrent,
      get: getTargetAccMappingCurrent,
    },
  )
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
