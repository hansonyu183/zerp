import { ref, shallowRef, toRaw, type Ref, type ShallowRef } from 'vue'

export type ListIdentity = {
  id: string
  code: string
  py: string
  name: string
}

export type EnabledListItem = ListIdentity & {
  enabled: boolean
}

export type ListFilters = {
  keyword: string
}

export type ListSearchInput<Filters extends ListFilters = ListFilters> =
  Filters & {
    page: number
    pageSize: 20
  }

export type ListAppliedQuery<Filters extends ListFilters = ListFilters> =
  Filters & {
    page: number
  }

export type ListPageResult<Item extends ListIdentity> = {
  items: readonly Item[]
  total: number
  page: number
  pageSize: number
}

export type ListAction = 'create' | 'edit' | 'enable' | 'disable' | 'delete'
export type ListActionResult = 'changed' | void

export class ListActionUnresolvedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ListActionUnresolvedError'
  }
}

export class ListActionRefreshRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ListActionRefreshRequiredError'
  }
}

export type ListPageCallbacks<
  Item extends ListIdentity,
  Filters extends ListFilters = ListFilters,
> = {
  onSearch?: (input: ListSearchInput<Filters>) => Promise<ListPageResult<Item>>
  onCreate?: () => Promise<ListActionResult>
  onEdit?: (item: Item) => Promise<ListActionResult>
  onEnable?: (item: Item) => Promise<ListActionResult>
  onDisable?: (item: Item) => Promise<ListActionResult>
  onDelete?: (item: Item) => Promise<ListActionResult>
  onCanAction?: (item: Item | null, action: ListAction) => boolean
}

export type ListPageOptions<Filters extends ListFilters> = {
  initialFilters?: () => Filters
  validateFilters?: (input: Filters) => Filters
}

export type ListPageViewModel<
  Item extends ListIdentity,
  Filters extends ListFilters = ListFilters,
> = {
  items: ShallowRef<Item[]>
  total: Ref<number>
  page: Ref<number>
  pageSize: 20
  filterInput: ShallowRef<Filters>
  appliedQuery: ShallowRef<ListAppliedQuery<Filters>>
  loading: Ref<boolean>
  queryError: Ref<string | null>
  feedback: Ref<string | null>
  actionPending: Ref<boolean>
  actionBlocked: Ref<boolean>
  searchable: boolean
  initialize: () => Promise<void>
  submitSearch: () => Promise<void>
  goToPage: (nextPage: number) => Promise<void>
  refresh: () => Promise<boolean>
  canAction: (action: ListAction, item?: Item | null) => boolean
  create: () => Promise<void>
  edit: (item: Item) => Promise<void>
  enable: (item: Item) => Promise<void>
  disable: (item: Item) => Promise<void>
  delete: (item: Item) => Promise<void>
  isRowPending: (id: string) => boolean
  isRowBlocked: (id: string) => boolean
  dismissFeedback: () => void
  dispose: () => void
}

const pageSize = 20 as const

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function clone<T>(value: T): T {
  return structuredClone(toRaw(value))
}

export function useListPageViewModel<
  Item extends ListIdentity,
  Filters extends ListFilters = ListFilters,
>(
  callbacks: ListPageCallbacks<Item, Filters>,
  options: ListPageOptions<Filters> = {},
): ListPageViewModel<Item, Filters> {
  const createInitialFilters =
    options.initialFilters ?? (() => ({ keyword: '' }) as unknown as Filters)
  const normalizeFilters = (input: Filters): Filters => {
    const snapshot = clone(input)
    return clone(
      options.validateFilters?.(snapshot) ?? {
        ...snapshot,
        keyword: snapshot.keyword.trim(),
      },
    )
  }
  const initialFilters = clone(createInitialFilters())
  const items = shallowRef<Item[]>([])
  const total = ref(0)
  const page = ref(1)
  const filterInput = shallowRef<Filters>(
    clone(initialFilters),
  ) as ShallowRef<Filters>
  const appliedQuery = shallowRef<ListAppliedQuery<Filters>>({
    ...normalizeFilters(initialFilters),
    page: 1,
  }) as ShallowRef<ListAppliedQuery<Filters>>
  const loading = ref(false)
  const queryError = ref<string | null>(null)
  const feedback = ref<string | null>(null)
  const actionPending = ref(false)
  const rowPending = ref(new Set<string>())
  const actionBlocked = ref(false)
  const rowBlocked = ref(new Set<string>())
  let queryVersion = 0
  let active = true
  let initialized = false
  let globalWriteOutcomeUnknown = false
  const rowWriteOutcomeUnknown = new Set<string>()

  function canAction(action: ListAction, item: Item | null = null): boolean {
    const callback =
      action === 'create'
        ? callbacks.onCreate
        : action === 'edit'
          ? callbacks.onEdit
          : action === 'enable'
            ? callbacks.onEnable
            : action === 'disable'
              ? callbacks.onDisable
              : callbacks.onDelete
    if (action === 'create' && actionBlocked.value) return false
    if (item && rowBlocked.value.has(item.id)) return false
    return Boolean(callback && (callbacks.onCanAction?.(item, action) ?? true))
  }

  async function executeQuery(
    next: ListAppliedQuery<Filters>,
  ): Promise<boolean> {
    if (!callbacks.onSearch || !active) return false
    const version = ++queryVersion
    const snapshot = clone(next)
    appliedQuery.value = clone(snapshot)
    loading.value = true
    queryError.value = null
    try {
      const result = await callbacks.onSearch({ ...clone(snapshot), pageSize })
      if (!active || version !== queryVersion) return false
      items.value = [...result.items]
      total.value = result.total
      page.value = result.page
      if (!globalWriteOutcomeUnknown) actionBlocked.value = false
      for (const id of rowBlocked.value) {
        if (!rowWriteOutcomeUnknown.has(id)) rowBlocked.value.delete(id)
      }
      return true
    } catch (cause) {
      if (!active || version !== queryVersion) return false
      queryError.value = messageOf(cause, '查询失败。')
      return false
    } finally {
      if (active && version === queryVersion) loading.value = false
    }
  }

  async function initialize(): Promise<void> {
    if (initialized || !active) return
    initialized = true
    if (callbacks.onSearch)
      await executeQuery({
        ...normalizeFilters(initialFilters),
        page: 1,
      })
  }

  async function submitSearch(): Promise<void> {
    if (!callbacks.onSearch) return
    await executeQuery({ ...normalizeFilters(filterInput.value), page: 1 })
  }

  async function goToPage(nextPage: number): Promise<void> {
    if (!callbacks.onSearch || nextPage < 1) return
    await executeQuery({
      ...clone(appliedQuery.value),
      page: nextPage,
    })
  }

  async function refresh(): Promise<boolean> {
    if (!callbacks.onSearch) return true
    return executeQuery(clone(appliedQuery.value))
  }

  async function afterAction(
    result: ListActionResult,
    itemId?: string,
  ): Promise<void> {
    if (result !== 'changed' || !active) return
    // Invalidate every earlier query before refreshing the committed fact.
    queryVersion += 1
    const refreshed = await refresh()
    if (!active) return
    feedback.value = refreshed ? '操作成功。' : '操作已成功，但列表刷新失败。'
    if (!refreshed) {
      if (itemId) rowBlocked.value.add(itemId)
      else actionBlocked.value = true
    }
  }

  async function runGlobalAction(
    action: 'create',
    callback: (() => Promise<ListActionResult>) | undefined,
  ): Promise<void> {
    if (!callback || actionPending.value || !canAction(action) || !active)
      return
    actionPending.value = true
    feedback.value = null
    try {
      await afterAction(await callback())
    } catch (cause) {
      if (active) {
        if (
          cause instanceof ListActionUnresolvedError ||
          cause instanceof ListActionRefreshRequiredError
        )
          actionBlocked.value = true
        if (cause instanceof ListActionUnresolvedError)
          globalWriteOutcomeUnknown = true
        feedback.value = messageOf(cause, '操作失败。')
      }
    } finally {
      if (active) actionPending.value = false
    }
  }

  async function runRowAction(
    action: Exclude<ListAction, 'create'>,
    item: Item,
    callback: ((item: Item) => Promise<ListActionResult>) | undefined,
  ): Promise<void> {
    if (
      !callback ||
      rowPending.value.has(item.id) ||
      !canAction(action, item) ||
      !active
    )
      return
    rowPending.value.add(item.id)
    feedback.value = null
    try {
      await afterAction(await callback(item), item.id)
    } catch (cause) {
      if (active) {
        if (
          cause instanceof ListActionUnresolvedError ||
          cause instanceof ListActionRefreshRequiredError
        )
          rowBlocked.value.add(item.id)
        if (cause instanceof ListActionUnresolvedError)
          rowWriteOutcomeUnknown.add(item.id)
        feedback.value = messageOf(cause, '操作失败。')
      }
    } finally {
      if (active) rowPending.value.delete(item.id)
    }
  }

  function create(): Promise<void> {
    return runGlobalAction('create', callbacks.onCreate)
  }

  function edit(item: Item): Promise<void> {
    return runRowAction('edit', item, callbacks.onEdit)
  }

  function enable(item: Item): Promise<void> {
    return runRowAction('enable', item, callbacks.onEnable)
  }

  function disable(item: Item): Promise<void> {
    return runRowAction('disable', item, callbacks.onDisable)
  }

  function deleteItem(item: Item): Promise<void> {
    return runRowAction('delete', item, callbacks.onDelete)
  }

  function isRowPending(id: string): boolean {
    return rowPending.value.has(id)
  }

  function isRowBlocked(id: string): boolean {
    return rowBlocked.value.has(id)
  }

  function dismissFeedback(): void {
    feedback.value = null
  }

  function dispose(): void {
    active = false
    queryVersion += 1
    loading.value = false
    actionPending.value = false
    rowPending.value.clear()
    rowBlocked.value.clear()
  }

  return {
    items,
    total,
    page,
    pageSize,
    filterInput,
    appliedQuery,
    loading,
    queryError,
    feedback,
    actionPending,
    actionBlocked,
    searchable: Boolean(callbacks.onSearch),
    initialize,
    submitSearch,
    goToPage,
    refresh,
    canAction,
    create,
    edit,
    enable,
    disable,
    delete: deleteItem,
    isRowPending,
    isRowBlocked,
    dismissFeedback,
    dispose,
  }
}
