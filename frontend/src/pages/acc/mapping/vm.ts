import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
} from 'vue'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { queryAccountingBooks, type AccountingBook } from '../book/api'
import {
  getAccountingMappingCatalog,
  getCurrentAccountingMapping,
  queryCurrentAccountingMappings,
  type AccountingMappingCatalog,
  type CurrentAccountingMapping,
} from './api'

export function createCurrentAccountingMappingViewModel() {
  const session = useSessionStore()
  const books = ref<AccountingBook[]>([])
  const rows = ref<CurrentAccountingMapping[]>([])
  const selectedBookId = ref('')
  const entityFilter = ref('')
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const loading = ref(false)
  const detailOpen = ref(false)
  const selected = ref<CurrentAccountingMapping | null>(null)
  const catalog = ref<AccountingMappingCatalog | null>(null)
  const errorMessage = ref<string | null>(null)
  let listSequence = 0
  let detailSequence = 0
  let active = true
  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
      listSequence += 1
      detailSequence += 1
    })
  }

  const canQuery = computed(
    () => session.can('/acc/book/query') && session.can('/acc/mapping/query'),
  )
  const canView = computed(
    () =>
      session.can('/acc/mapping/get') &&
      session.can('/acc/mapping/catalog'),
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
      selectedBookId.value ||= books.value[0]?.bookId ?? ''
      await query(current)
    } catch (error) {
      if (active && current === listSequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === listSequence) loading.value = false
    }
  }

  async function query(existingSequence?: number): Promise<void> {
    if (!canQuery.value || !selectedBookId.value) return
    const current = existingSequence ?? ++listSequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryCurrentAccountingMappings({
        bookId: selectedBookId.value,
        page: page.value,
        pageSize: pageSize.value,
        ...(entityFilter.value ? { vouEntity: entityFilter.value } : {}),
      })
      if (!active || current !== listSequence) return
      rows.value = result.data.items ?? []
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

  async function open(mapping: CurrentAccountingMapping): Promise<void> {
    if (!canView.value) return
    const current = ++detailSequence
    loading.value = true
    errorMessage.value = null
    try {
      const [detail, fieldCatalog] = await Promise.all([
        getCurrentAccountingMapping(mapping.bookId, mapping.vouEntity),
        getAccountingMappingCatalog(mapping.vouEntity),
      ])
      if (!active || current !== detailSequence) return
      selected.value = detail.data
      catalog.value = fieldCatalog.data
      detailOpen.value = true
    } catch (error) {
      if (active && current === detailSequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === detailSequence) loading.value = false
    }
  }

  function close(): void {
    detailSequence += 1
    detailOpen.value = false
    selected.value = null
    catalog.value = null
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
    rows,
    selectedBookId,
    entityFilter,
    page,
    pageSize,
    total,
    loading,
    detailOpen,
    selected,
    catalog,
    errorMessage,
    canQuery,
    canView,
    bookOptions,
    initialize,
    query,
    open,
    close,
    changeBook,
    changePage,
    resetFilters,
  })
}
