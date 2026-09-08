import { computed, reactive, ref } from 'vue'

import {
  createTargetWarehouse,
  deleteTargetWarehouse,
  getTargetWarehouse,
  queryTargetEmployees,
  queryTargetWarehouses,
  saveTargetWarehouse,
  setTargetWarehouseEnabled,
  TargetApiError,
} from '../../../api.ts'
import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type ListAction,
  type ListSearchInput,
} from '../../../components/list-page/vm.ts'
import { useTargetSession } from '../../../session/vm.ts'

export type WarehouseListItem = Awaited<
  ReturnType<typeof queryTargetWarehouses>
>['items'][number]
type Detail = Awaited<ReturnType<typeof getTargetWarehouse>>
type Option = { id: string; title: string }
export const warehousePaths = {
  query: '/aux/warehouse/query',
  get: '/aux/warehouse/get',
  create: '/aux/warehouse/create',
  save: '/aux/warehouse/save',
  enable: '/aux/warehouse/enable',
  disable: '/aux/warehouse/disable',
  delete: '/aux/warehouse/delete',
} as const

export function useWarehouseManagementViewModel() {
  const session = useTargetSession()
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorLoading = ref(false)
  const referenceLoading = ref(false)
  const saving = ref(false)
  const editorWriteBlocked = ref(false)
  const editorError = ref<string | null>(null)
  const lastCreatedId = ref<string | null>(null)
  const employees = ref<Option[]>([])
  const detail = ref<Detail | null>(null)
  const editor = reactive({
    id: '',
    revision: '',
    name: '',
    address: '',
    contactName: '',
    contactPhone: '',
    managerEmployeeId: '',
    remark: '',
  })
  let resolve: ((value: 'changed' | void) => void) | null = null
  let reject: ((cause: unknown) => void) | null = null
  let editorRequest = 0
  let disposed = false
  const can = (path: string) => session.can(path)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const reset = () => {
    Object.assign(editor, {
      id: '',
      revision: '',
      name: '',
      address: '',
      contactName: '',
      contactPhone: '',
      managerEmployeeId: '',
      remark: '',
    })
    detail.value = null
    employees.value = []
    editorError.value = null
    editorLoading.value = false
    referenceLoading.value = false
    saving.value = false
    editorWriteBlocked.value = false
  }
  const finish = (result?: 'changed') => {
    editorOpen.value = false
    reset()
    editorRequest += 1
    resolve?.(result)
    resolve = null
    reject = null
  }
  const canSave = computed(
    () =>
      !editorLoading.value &&
      !editorWriteBlocked.value &&
      !saving.value &&
      (editorMode.value === 'create'
        ? can(warehousePaths.create)
        : Boolean(
            detail.value?.availableActions.includes('edit') &&
            can(warehousePaths.get) &&
            can(warehousePaths.save),
          )),
  )
  const current = (request: number, generation: number) =>
    !disposed && request === editorRequest && generation === session.generation
  async function loadEmployees(request: number, generation: number) {
    if (!can('/aux/employee/query')) {
      if (current(request, generation))
        editorError.value = '没有仓库负责人引用读取权限；可保存空负责人。'
      return
    }
    referenceLoading.value = true
    try {
      const options: Option[] = []
      let page = 1
      let fetched = 0
      let pageCount = Number.POSITIVE_INFINITY
      while (page <= pageCount) {
        const result = await queryTargetEmployees(csrf(), {
          keyword: '',
          page,
          pageSize: 20,
        })
        if (!current(request, generation)) return
        options.push(
          ...result.items
            .filter((item) => item.enabled)
            .map((item) => ({
              id: item.id,
              title: `${item.code} · ${item.name}`,
            })),
        )
        fetched += result.items.length
        pageCount = Math.ceil(result.total / result.pageSize)
        if (fetched >= result.total || result.items.length === 0) break
        page += 1
      }
      employees.value = options
    } catch (cause) {
      if (!current(request, generation)) return
      editorError.value =
        cause instanceof Error ? cause.message : '仓库负责人选项加载失败。'
    } finally {
      if (current(request, generation)) referenceLoading.value = false
    }
  }
  function openCreate() {
    editorRequest += 1
    const request = editorRequest
    const generation = session.generation
    reset()
    editorMode.value = 'create'
    editorOpen.value = true
    void loadEmployees(request, generation)
    return new Promise<'changed' | void>((next, failed) => {
      resolve = next
      reject = failed
    })
  }
  function openEdit(item: WarehouseListItem) {
    editorRequest += 1
    const request = editorRequest
    const generation = session.generation
    reset()
    editorMode.value = 'edit'
    editorOpen.value = true
    const result = new Promise<'changed' | void>((next, failed) => {
      resolve = next
      reject = failed
    })
    if (!can(warehousePaths.get) || !can(warehousePaths.save)) {
      editorError.value = '编辑仓库需要详情和保存权限。'
      return result
    }
    editorLoading.value = true
    void getTargetWarehouse(csrf(), item.id)
      .then((value) => {
        if (!current(request, generation)) return
        detail.value = value
        Object.assign(editor, {
          id: value.id,
          revision: value.revision,
          name: value.name,
          address: value.address,
          contactName: value.contactName,
          contactPhone: value.contactPhone,
          managerEmployeeId: value.manager?.id ?? '',
          remark: value.remark,
        })
      })
      .catch((cause) => {
        if (!current(request, generation)) return
        editorError.value =
          cause instanceof Error ? cause.message : '仓库编辑信息加载失败。'
      })
      .finally(() => {
        if (current(request, generation)) editorLoading.value = false
      })
    void loadEmployees(request, generation)
    return result
  }
  async function saveEditor() {
    if (!resolve || saving.value || !canSave.value) return
    if (!editor.name.trim()) {
      editorError.value = '请填写仓库名称。'
      return
    }
    const request = editorRequest
    const generation = session.generation
    const token = csrf()
    saving.value = true
    editorError.value = null
    const input = {
      name: editor.name.trim(),
      address: editor.address.trim(),
      contactName: editor.contactName.trim(),
      contactPhone: editor.contactPhone.trim(),
      managerEmployeeId: editor.managerEmployeeId || null,
      remark: editor.remark.trim(),
    }
    try {
      if (editorMode.value === 'create') {
        const created = await createTargetWarehouse(token, input)
        if (!current(request, generation)) return
        lastCreatedId.value = created.id
      } else
        await saveTargetWarehouse(token, {
          id: editor.id,
          revision: editor.revision,
          ...input,
        })
      if (!current(request, generation)) return
      finish('changed')
    } catch (cause) {
      if (!current(request, generation)) return
      if (cause instanceof TargetApiError && cause.errorKey === 'conflict') {
        editorWriteBlocked.value = true
        editorError.value = '数据已变化，请刷新列表后重试。'
      } else if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        editorError.value = cause.message || '仓库保存失败。'
      else {
        editorWriteBlocked.value = true
        editorError.value = '请求结果未知；已停止再次提交，请刷新后核实。'
        const failed = reject
        resolve = null
        reject = null
        failed?.(new ListActionUnresolvedError(editorError.value))
      }
    } finally {
      if (current(request, generation)) saving.value = false
    }
  }
  const setEnabled = async (
    item: WarehouseListItem,
    enabled: boolean,
  ): Promise<'changed'> => {
    try {
      await setTargetWarehouseEnabled(
        csrf(),
        { id: item.id, revision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (cause instanceof TargetApiError && cause.errorKey === 'conflict')
        throw new ListActionRefreshRequiredError(
          '数据已变化，请刷新列表后重试。',
        )
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new Error(
          cause.message || (enabled ? '仓库启用失败。' : '仓库停用失败。'),
        )
      try {
        await getTargetWarehouse(csrf(), item.id)
      } catch {
        /* cannot prove the write */
      }
      throw new ListActionUnresolvedError('请求结果未知；请刷新后核实。')
    }
  }
  const deleteItem = async (item: WarehouseListItem): Promise<'changed'> => {
    try {
      await deleteTargetWarehouse(csrf(), {
        id: item.id,
        revision: item.revision,
      })
      return 'changed'
    } catch (cause) {
      if (cause instanceof TargetApiError && cause.errorKey === 'conflict')
        throw new ListActionRefreshRequiredError(
          '数据已变化，请刷新列表后重试。',
        )
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new Error(cause.message || '仓库删除失败。')
      throw new ListActionUnresolvedError('请求结果未知；请刷新后核实。')
    }
  }
  const list = useListPageViewModel<WarehouseListItem>({
    ...(can(warehousePaths.query)
      ? {
          onSearch: (value: ListSearchInput) =>
            queryTargetWarehouses(csrf(), value),
        }
      : {}),
    ...(can(warehousePaths.create) ? { onCreate: openCreate } : {}),
    ...(can(warehousePaths.get) && can(warehousePaths.save)
      ? { onEdit: openEdit }
      : {}),
    ...(can(warehousePaths.enable)
      ? { onEnable: (item) => setEnabled(item, true) }
      : {}),
    ...(can(warehousePaths.disable)
      ? { onDisable: (item) => setEnabled(item, false) }
      : {}),
    ...(can(warehousePaths.delete) ? { onDelete: deleteItem } : {}),
    onCanAction: (item, action: ListAction) => {
      if (action === 'create') return can(warehousePaths.create)
      if (!item) return false
      if (action === 'edit')
        return (
          item.availableActions.includes('edit') &&
          can(warehousePaths.get) &&
          can(warehousePaths.save)
        )
      if (action === 'delete')
        return (
          item.availableActions.includes('delete') && can(warehousePaths.delete)
        )
      return (
        item.availableActions.includes(action) && can(warehousePaths[action])
      )
    },
  })
  return {
    list,
    editorOpen,
    editorMode,
    editorLoading,
    referenceLoading,
    saving,
    editorError,
    editor,
    employees,
    canSave,
    lastCreatedId,
    creationNotice: computed(() =>
      list.actionBlocked.value && lastCreatedId.value
        ? `新建成功（ID：${lastCreatedId.value}），但列表刷新失败，请先查询核实。`
        : '',
    ),
    openCreate,
    openEdit,
    saveEditor,
    closeEditor: () => !saving.value && finish(),
    dispose: () => {
      disposed = true
      list.dispose()
      finish()
    },
  }
}
