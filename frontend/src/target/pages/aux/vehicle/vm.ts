import { computed, reactive, ref } from 'vue'
import {
  createTargetVehicle,
  deleteTargetVehicle,
  getTargetVehicle,
  queryTargetAuxReferences,
  queryTargetBobReferences,
  queryTargetOperatingEntities,
  queryTargetVehicles,
  saveTargetVehicle,
  setTargetVehicleEnabled,
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

export type VehicleListItem = Awaited<
  ReturnType<typeof queryTargetVehicles>
>['items'][number]
type Detail = Awaited<ReturnType<typeof getTargetVehicle>>
export const vehiclePaths = {
  query: '/aux/vehicle/query',
  get: '/aux/vehicle/get',
  create: '/aux/vehicle/create',
  save: '/aux/vehicle/save',
  enable: '/aux/vehicle/enable',
  disable: '/aux/vehicle/disable',
  delete: '/aux/vehicle/delete',
} as const
type Option = { id: string; title: string }
export function useVehicleManagementViewModel() {
  const session = useTargetSession()
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorLoading = ref(false)
  const referenceLoading = ref(false)
  const saving = ref(false)
  const editorWriteBlocked = ref(false)
  const editorError = ref<string | null>(null)
  const lastCreatedId = ref<string | null>(null)
  const vehicleTypes = ref<Option[]>([])
  const operatingEntities = ref<Option[]>([])
  const otherUnits = ref<Option[]>([])
  const detail = ref<Detail | null>(null)
  const editor = reactive({
    id: '',
    revision: '',
    name: '',
    plateNumber: '',
    vehicleTypeId: '',
    carrierKind: 'INTERNAL' as 'INTERNAL' | 'EXTERNAL',
    carrierOperatingEntityId: '',
    carrierOtherUnitId: '',
    vin: '',
    engineNumber: '',
    ratedLoadKg: '',
    bulkWaterCarrier: false,
    remark: '',
  })
  let resolve: ((value: 'changed' | void) => void) | null = null
  let reject: ((cause: unknown) => void) | null = null
  let editorRequest = 0
  let disposed = false
  const externalEntries = new Map<string, string>()
  const can = (p: string) => session.can(p)
  const current = (request: number, generation: number) =>
    !disposed && request === editorRequest && generation === session.generation
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const reset = () => {
    Object.assign(editor, {
      id: '',
      revision: '',
      name: '',
      plateNumber: '',
      vehicleTypeId: '',
      carrierKind: 'INTERNAL',
      carrierOperatingEntityId: '',
      carrierOtherUnitId: '',
      vin: '',
      engineNumber: '',
      ratedLoadKg: '',
      bulkWaterCarrier: false,
      remark: '',
    })
    detail.value = null
    vehicleTypes.value = []
    operatingEntities.value = []
    otherUnits.value = []
    externalEntries.clear()
    editorError.value = null
    editorLoading.value = false
    referenceLoading.value = false
    saving.value = false
    editorWriteBlocked.value = false
  }
  const finish = (value?: 'changed') => {
    editorOpen.value = false
    editorRequest += 1
    reset()
    resolve?.(value)
    resolve = null
    reject = null
  }
  const canRead = computed(
    () =>
      can('/aux/reference/query') &&
      can('/aux/operating-entity/query') &&
      can('/bob/reference/query'),
  )
  const canSave = computed(
    () =>
      !editorLoading.value &&
      !referenceLoading.value &&
      !editorWriteBlocked.value &&
      !saving.value &&
      canRead.value &&
      (editorMode.value === 'create'
        ? can(vehiclePaths.create)
        : Boolean(
            detail.value?.availableActions.includes('edit') &&
            can(vehiclePaths.get) &&
            can(vehiclePaths.save),
          )),
  )
  async function loadOperatingEntityOptions(
    request: number,
    generation: number,
  ): Promise<Option[] | null> {
    const options: Option[] = []
    let page = 1
    let fetched = 0
    let pageCount = Number.POSITIVE_INFINITY
    while (page <= pageCount) {
      if (!current(request, generation)) return null
      const result = await queryTargetOperatingEntities(csrf(), {
        keyword: '',
        page,
        pageSize: 20,
      })
      if (!current(request, generation)) return null
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
    return options
  }
  async function loadReferences(request: number, generation: number) {
    if (!canRead.value) {
      if (current(request, generation))
        editorError.value = '编辑车辆需要车型和承运归属引用读取权限。'
      return
    }
    referenceLoading.value = true
    try {
      const [types, operatingEntityOptions, units] = await Promise.all([
        queryTargetAuxReferences(csrf(), {
          entity: 'dictionary-item',
        }),
        loadOperatingEntityOptions(request, generation),
        queryTargetBobReferences(csrf(), { entity: 'other-unit' }),
      ])
      if (!current(request, generation) || !operatingEntityOptions) return
      vehicleTypes.value = types.map((x) => ({ id: x.objectId, title: x.code }))
      operatingEntities.value = operatingEntityOptions
      otherUnits.value = units.map((x) => {
        externalEntries.set(x.objectId, x.sourceApprovalEntryId)
        return { id: x.objectId, title: `${x.code} · ${x.name}` }
      })
    } catch (e) {
      if (current(request, generation))
        editorError.value =
          e instanceof Error ? e.message : '车辆引用选项加载失败。'
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
    void loadReferences(request, generation)
    return new Promise<'changed' | void>((next, failed) => {
      resolve = next
      reject = failed
    })
  }
  function openEdit(item: VehicleListItem) {
    editorRequest += 1
    const request = editorRequest
    const generation = session.generation
    reset()
    editorMode.value = 'edit'
    editorOpen.value = true
    const wait = new Promise<'changed' | void>((next, failed) => {
      resolve = next
      reject = failed
    })
    if (!can(vehiclePaths.get) || !can(vehiclePaths.save)) {
      editorError.value = '编辑车辆需要详情和保存权限。'
      return wait
    }
    editorLoading.value = true
    void getTargetVehicle(csrf(), item.id)
      .then((v) => {
        if (
          disposed ||
          request !== editorRequest ||
          generation !== session.generation
        )
          return
        detail.value = v
        Object.assign(editor, {
          id: v.id,
          revision: v.revision,
          name: v.name,
          plateNumber: v.plateNumber,
          vehicleTypeId: v.vehicleType.id,
          carrierKind: v.carrier.kind,
          carrierOperatingEntityId:
            v.carrier.kind === 'INTERNAL' ? v.carrier.operatingEntityId : '',
          carrierOtherUnitId:
            v.carrier.kind === 'EXTERNAL' ? v.carrier.otherUnitId : '',
          vin: v.vin,
          engineNumber: v.engineNumber,
          ratedLoadKg: String(v.ratedLoadKg),
          bulkWaterCarrier: v.bulkWaterCarrier,
          remark: v.remark,
        })
        if (v.carrier.kind === 'EXTERNAL')
          externalEntries.set(v.carrier.otherUnitId, v.carrier.approvalEntryId)
      })
      .catch((e) => {
        if (
          disposed ||
          request !== editorRequest ||
          generation !== session.generation
        )
          return
        editorError.value =
          e instanceof Error ? e.message : '车辆编辑信息加载失败。'
      })
      .finally(() => {
        if (
          !disposed &&
          request === editorRequest &&
          generation === session.generation
        )
          editorLoading.value = false
      })
    void loadReferences(request, generation)
    return wait
  }
  async function saveEditor() {
    if (!resolve || saving.value || !canSave.value) return
    const load = Number(editor.ratedLoadKg)
    const carrier =
      editor.carrierKind === 'INTERNAL'
        ? editor.carrierOperatingEntityId
          ? {
              kind: 'INTERNAL' as const,
              operatingEntityId: editor.carrierOperatingEntityId,
            }
          : null
        : editor.carrierOtherUnitId &&
            externalEntries.get(editor.carrierOtherUnitId)
          ? {
              kind: 'EXTERNAL' as const,
              otherUnitId: editor.carrierOtherUnitId,
              approvalEntryId: externalEntries.get(editor.carrierOtherUnitId)!,
            }
          : null
    if (
      !editor.name.trim() ||
      !editor.plateNumber.trim() ||
      !editor.vehicleTypeId ||
      !carrier ||
      !Number.isFinite(load) ||
      load < 0
    ) {
      editorError.value = '请填写车辆必填字段及有效承运归属。'
      return
    }
    const request = editorRequest
    const generation = session.generation
    const token = csrf()
    saving.value = true
    const input = {
      name: editor.name.trim(),
      plateNumber: editor.plateNumber.trim(),
      vehicleTypeId: editor.vehicleTypeId,
      carrier,
      vin: editor.vin.trim(),
      engineNumber: editor.engineNumber.trim(),
      ratedLoadKg: load,
      bulkWaterCarrier: editor.bulkWaterCarrier,
      remark: editor.remark.trim(),
    }
    try {
      if (editorMode.value === 'create') {
        const created = await createTargetVehicle(token, input)
        if (!current(request, generation)) return
        lastCreatedId.value = created.id
      } else
        await saveTargetVehicle(token, {
          id: editor.id,
          revision: editor.revision,
          ...input,
        })
      if (!current(request, generation)) return
      finish('changed')
    } catch (e) {
      if (!current(request, generation)) return
      if (e instanceof TargetApiError && e.errorKey === 'conflict') {
        editorWriteBlocked.value = true
        editorError.value = '数据已变化，请刷新列表后重试。'
      } else if (
        e instanceof TargetApiError &&
        e.errorKey !== 'invalid_response'
      )
        editorError.value = e.message || '车辆保存失败。'
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
  const toggle = async (
    i: VehicleListItem,
    enabled: boolean,
  ): Promise<'changed'> => {
    try {
      await setTargetVehicleEnabled(
        csrf(),
        { id: i.id, revision: i.revision },
        enabled,
      )
      return 'changed'
    } catch (e) {
      if (e instanceof TargetApiError && e.errorKey === 'conflict')
        throw new ListActionRefreshRequiredError(
          '数据已变化，请刷新列表后重试。',
        )
      if (e instanceof TargetApiError && e.errorKey !== 'invalid_response')
        throw new Error(
          e.message || (enabled ? '车辆启用失败。' : '车辆停用失败。'),
        )
      throw new ListActionUnresolvedError('请求结果未知；请刷新后核实。')
    }
  }
  const deleteItem = async (item: VehicleListItem): Promise<'changed'> => {
    try {
      await deleteTargetVehicle(csrf(), {
        id: item.id,
        revision: item.revision,
      })
      return 'changed'
    } catch (e) {
      if (e instanceof TargetApiError && e.errorKey === 'conflict')
        throw new ListActionRefreshRequiredError(
          '数据已变化，请刷新列表后重试。',
        )
      if (e instanceof TargetApiError && e.errorKey !== 'invalid_response')
        throw new Error(e.message || '车辆删除失败。')
      throw new ListActionUnresolvedError('请求结果未知；请刷新后核实。')
    }
  }
  const list = useListPageViewModel<VehicleListItem>({
    ...(can(vehiclePaths.query)
      ? { onSearch: (v: ListSearchInput) => queryTargetVehicles(csrf(), v) }
      : {}),
    ...(can(vehiclePaths.create) ? { onCreate: openCreate } : {}),
    ...(can(vehiclePaths.get) && can(vehiclePaths.save)
      ? { onEdit: openEdit }
      : {}),
    ...(can(vehiclePaths.enable) ? { onEnable: (i) => toggle(i, true) } : {}),
    ...(can(vehiclePaths.disable)
      ? { onDisable: (i) => toggle(i, false) }
      : {}),
    ...(can(vehiclePaths.delete) ? { onDelete: deleteItem } : {}),
    onCanAction: (item, action: ListAction) => {
      if (action === 'create') return can(vehiclePaths.create)
      if (!item) return false
      if (action === 'edit')
        return (
          item.availableActions.includes('edit') &&
          can(vehiclePaths.get) &&
          can(vehiclePaths.save)
        )
      if (action === 'delete')
        return (
          item.availableActions.includes('delete') && can(vehiclePaths.delete)
        )
      return item.availableActions.includes(action) && can(vehiclePaths[action])
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
    vehicleTypes,
    operatingEntities,
    otherUnits,
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
