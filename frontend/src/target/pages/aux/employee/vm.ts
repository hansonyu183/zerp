import { computed, reactive, ref } from 'vue'

import {
  createTargetEmployee,
  getTargetEmployee,
  queryTargetDepartments,
  queryTargetEmployeeCategories,
  queryTargetEmployees,
  queryTargetOperatingEntities,
  queryTargetPositions,
  saveTargetEmployee,
  setTargetEmployeeEnabled,
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

type Detail = Awaited<ReturnType<typeof getTargetEmployee>>
export type EmployeeListItem = Awaited<
  ReturnType<typeof queryTargetEmployees>
>['items'][number]
type ReferenceOption = { id: string; title: string; disabled?: boolean }
type ReferencePageItem = {
  id: string
  code: string
  name: string
  enabled: boolean
}
type ReferencePage = { items: readonly ReferencePageItem[]; total: number }
type ReferenceQuery = (
  csrfToken: string,
  input: { keyword: string; page: number; pageSize: 20 },
) => Promise<ReferencePage>
type Completion = {
  resolve: (result: 'changed' | void) => void
  reject: (cause: unknown) => void
}

export const employeePaths = {
  query: '/aux/employee/query',
  get: '/aux/employee/get',
  create: '/aux/employee/create',
  save: '/aux/employee/save',
  enable: '/aux/employee/enable',
  disable: '/aux/employee/disable',
} as const
const referencePaths = {
  operatingEntity: '/aux/operating-entity/query',
  employeeCategory: '/aux/employee-category/query',
  department: '/aux/department/query',
  position: '/aux/position/query',
} as const
const errors: Readonly<Record<string, string>> = {
  validation_failed: '输入内容不符合要求，请检查后重试。',
  forbidden: '当前账号没有执行此操作的权限。',
  unauthenticated: '会话已失效，请重新登录。',
  conflict: '当前员工状态已变化，请刷新列表后重试。',
  not_found: '员工不存在或已删除。',
  employee_duplicate_legal_identifier: '法定证件号码已被其他员工使用。',
  internal_error: '员工服务暂时不可用，请稍后重试。',
}
function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof TargetApiError)
    return errors[cause.errorKey] ?? cause.message ?? fallback
  return cause instanceof Error && cause.message ? cause.message : fallback
}
function isConflict(cause: unknown): boolean {
  return cause instanceof TargetApiError && cause.errorKey === 'conflict'
}
function option(item: {
  id: string
  code: string
  name: string
  enabled: boolean
}): ReferenceOption {
  return {
    id: item.id,
    title: `${item.code} · ${item.name}`,
    ...(item.enabled ? {} : { disabled: true }),
  }
}

export function useEmployeeManagementViewModel() {
  const session = useTargetSession()
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorLoading = ref(false)
  const referenceLoading = ref(false)
  const referencesReady = ref(false)
  const saving = ref(false)
  const editorWriteBlocked = ref(false)
  const editorError = ref<string | null>(null)
  const detail = ref<Detail | null>(null)
  const lastCreatedId = ref<string | null>(null)
  const operatingEntities = ref<ReferenceOption[]>([])
  const employeeCategories = ref<ReferenceOption[]>([])
  const departments = ref<ReferenceOption[]>([])
  const positions = ref<ReferenceOption[]>([])
  const editor = reactive({
    id: '',
    revision: '',
    identityKind: 'PERSON' as 'PERSON' | 'ORGANIZATION',
    legalName: '',
    displayName: '',
    legalIdentifier: '',
    contactName: '',
    phone: '',
    address: '',
    employmentDate: '',
    workPhone: '',
    workEmail: '',
    remark: '',
    operatingEntityId: '',
    employeeCategoryId: '',
    departmentId: '',
    positionId: '',
  })
  let editorRequest = 0
  let completion: Completion | null = null
  let disposed = false

  const can = (path: string): boolean => session.can(path)
  const canReadReferences = computed(() =>
    Object.values(referencePaths).every(can),
  )
  const csrf = (): string => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const tokenFor = (generation: number, path: string): string | null =>
    !disposed &&
    generation === session.generation &&
    can(path) &&
    session.csrfToken
      ? session.csrfToken
      : null
  const current = (opening: { request: number; generation: number }): boolean =>
    !disposed &&
    opening.request === editorRequest &&
    opening.generation === session.generation

  const canSave = computed(() => {
    if (
      editorLoading.value ||
      referenceLoading.value ||
      editorWriteBlocked.value ||
      !canReadReferences.value ||
      !referencesReady.value
    )
      return false
    return editorMode.value === 'create'
      ? can(employeePaths.create)
      : Boolean(
          detail.value?.availableActions.includes('edit') &&
          can(employeePaths.get) &&
          can(employeePaths.save),
        )
  })

  function reset(): void {
    Object.assign(editor, {
      id: '',
      revision: '',
      identityKind: 'PERSON',
      legalName: '',
      displayName: '',
      legalIdentifier: '',
      contactName: '',
      phone: '',
      address: '',
      employmentDate: '',
      workPhone: '',
      workEmail: '',
      remark: '',
      operatingEntityId: '',
      employeeCategoryId: '',
      departmentId: '',
      positionId: '',
    })
    detail.value = null
    operatingEntities.value = []
    employeeCategories.value = []
    departments.value = []
    positions.value = []
    editorError.value = null
    editorLoading.value = false
    referenceLoading.value = false
    referencesReady.value = false
    saving.value = false
    editorWriteBlocked.value = false
  }
  function begin(mode: 'create' | 'edit') {
    completion?.resolve()
    editorRequest += 1
    reset()
    if (mode === 'create') lastCreatedId.value = null
    editorMode.value = mode
    editorOpen.value = true
    const promise = new Promise<'changed' | void>((resolve, reject) => {
      completion = { resolve, reject }
    })
    return { request: editorRequest, generation: session.generation, promise }
  }
  function finish(result: 'changed' | void): void {
    const pending = completion
    completion = null
    editorRequest += 1
    editorOpen.value = false
    reset()
    pending?.resolve(result)
  }
  function unresolved(message: string): void {
    const pending = completion
    completion = null
    editorWriteBlocked.value = true
    editorError.value = message
    pending?.reject(new ListActionUnresolvedError(message))
  }

  async function loadAllReferenceOptions(
    opening: { request: number; generation: number },
    path: string,
    initialToken: string,
    query: ReferenceQuery,
  ): Promise<ReferenceOption[] | null> {
    const options: ReferenceOption[] = []
    let page = 1
    let total = Number.POSITIVE_INFINITY
    while (options.length < total) {
      const token =
        page === 1 ? initialToken : tokenFor(opening.generation, path)
      if (!token || !current(opening)) return null
      const result = await query(token, { keyword: '', page, pageSize: 20 })
      if (!current(opening) || !tokenFor(opening.generation, path)) return null
      options.push(...result.items.map(option))
      total = result.total
      if (result.items.length === 0) break
      page += 1
    }
    return options
  }

  async function loadReferences(opening: {
    request: number
    generation: number
  }): Promise<void> {
    if (!canReadReferences.value) {
      if (current(opening))
        editorError.value =
          '编辑员工需要经营主体、员工分类、部门和岗位的查询权限。'
      return
    }
    const tokens = {
      operatingEntity: tokenFor(
        opening.generation,
        referencePaths.operatingEntity,
      ),
      employeeCategory: tokenFor(
        opening.generation,
        referencePaths.employeeCategory,
      ),
      department: tokenFor(opening.generation, referencePaths.department),
      position: tokenFor(opening.generation, referencePaths.position),
    }
    if (
      !tokens.operatingEntity ||
      !tokens.employeeCategory ||
      !tokens.department ||
      !tokens.position ||
      !current(opening)
    )
      return
    referenceLoading.value = true
    try {
      const [entities, categories, nextDepartments, nextPositions] =
        await Promise.all([
          loadAllReferenceOptions(
            opening,
            referencePaths.operatingEntity,
            tokens.operatingEntity,
            queryTargetOperatingEntities,
          ),
          loadAllReferenceOptions(
            opening,
            referencePaths.employeeCategory,
            tokens.employeeCategory,
            queryTargetEmployeeCategories,
          ),
          loadAllReferenceOptions(
            opening,
            referencePaths.department,
            tokens.department,
            queryTargetDepartments,
          ),
          loadAllReferenceOptions(
            opening,
            referencePaths.position,
            tokens.position,
            queryTargetPositions,
          ),
        ])
      if (
        !current(opening) ||
        !canReadReferences.value ||
        !entities ||
        !categories ||
        !nextDepartments ||
        !nextPositions
      )
        return
      operatingEntities.value = entities
      employeeCategories.value = categories
      departments.value = nextDepartments
      positions.value = nextPositions
      referencesReady.value = true
    } catch (cause) {
      if (current(opening))
        editorError.value = messageOf(cause, '员工引用选项加载失败。')
    } finally {
      if (current(opening)) referenceLoading.value = false
    }
  }

  function openCreate(): Promise<'changed' | void> {
    const opening = begin('create')
    if (!can(employeePaths.create)) editorError.value = '缺少新增员工权限。'
    else void loadReferences(opening)
    return opening.promise
  }
  function openEdit(item: EmployeeListItem): Promise<'changed' | void> {
    const opening = begin('edit')
    if (!can(employeePaths.get) || !can(employeePaths.save)) {
      editorError.value = '编辑员工需要详情和保存权限。'
      return opening.promise
    }
    const token = tokenFor(opening.generation, employeePaths.get)
    if (!token) {
      editorError.value = '会话已失效，无法加载编辑信息。'
      return opening.promise
    }
    editorLoading.value = true
    void getTargetEmployee(token, item.id)
      .then((value) => {
        if (!current(opening)) return
        detail.value = value
        Object.assign(editor, {
          id: value.id,
          revision: value.revision,
          identityKind: value.identityKind,
          legalName: value.legalName,
          displayName: value.displayName,
          legalIdentifier: value.legalIdentifier,
          contactName: value.contactName,
          phone: value.phone,
          address: value.address,
          employmentDate: value.employmentDate,
          workPhone: value.workPhone,
          workEmail: value.workEmail,
          remark: value.remark,
          operatingEntityId: value.operatingEntity.id,
          employeeCategoryId: value.employeeCategory.id,
          departmentId: value.department.id,
          positionId: value.position.id,
        })
      })
      .catch((cause) => {
        if (current(opening))
          editorError.value = messageOf(cause, '员工编辑信息加载失败。')
      })
      .finally(() => {
        if (current(opening)) editorLoading.value = false
      })
    void loadReferences(opening)
    return opening.promise
  }

  function input() {
    return {
      identityKind: editor.identityKind,
      legalName: editor.legalName.trim(),
      displayName: editor.displayName.trim(),
      legalIdentifier: editor.legalIdentifier.trim(),
      contactName: editor.contactName.trim(),
      phone: editor.phone.trim(),
      address: editor.address.trim(),
      employmentDate: editor.employmentDate.trim(),
      workPhone: editor.workPhone.trim(),
      workEmail: editor.workEmail.trim(),
      remark: editor.remark.trim(),
      operatingEntityId: editor.operatingEntityId,
      employeeCategoryId: editor.employeeCategoryId,
      departmentId: editor.departmentId,
      positionId: editor.positionId,
    }
  }
  async function saveEditor(): Promise<void> {
    if (!completion || saving.value || !canSave.value) return
    if (
      !editor.legalName.trim() ||
      !editor.displayName.trim() ||
      !editor.legalIdentifier.trim() ||
      !editor.employmentDate ||
      !editor.operatingEntityId ||
      !editor.employeeCategoryId ||
      !editor.departmentId ||
      !editor.positionId
    ) {
      editorError.value = '请填写员工身份、入职日期及全部任职引用。'
      return
    }
    const request = editorRequest
    const generation = session.generation
    saving.value = true
    editorError.value = null
    try {
      if (editorMode.value === 'create') {
        const created = await createTargetEmployee(csrf(), input())
        if (!current({ request, generation })) return
        lastCreatedId.value = created.id
      } else
        await saveTargetEmployee(csrf(), {
          id: editor.id,
          revision: editor.revision,
          ...input(),
        })
      if (current({ request, generation })) finish('changed')
    } catch (cause) {
      if (!current({ request, generation })) return
      if (isConflict(cause)) {
        editorError.value = messageOf(cause, '数据已变化，请刷新后重试。')
        editorWriteBlocked.value = true
      } else if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        editorError.value = messageOf(cause, '员工保存失败。')
      else unresolved('请求结果未知；已停止再次提交，请刷新后核实。')
    } finally {
      if (current({ request, generation })) saving.value = false
    }
  }
  function closeEditor(): void {
    if (!saving.value) finish()
  }
  function canListAction(
    item: EmployeeListItem | null,
    action: ListAction,
  ): boolean {
    if (action === 'create') return can(employeePaths.create)
    if (!item) return false
    if (action === 'edit')
      return (
        item.availableActions.includes('edit') &&
        can(employeePaths.get) &&
        can(employeePaths.save)
      )
    return item.availableActions.includes(action) && can(employeePaths[action])
  }
  async function setEnabled(
    item: EmployeeListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    try {
      await setTargetEmployeeEnabled(
        csrf(),
        { id: item.id, revision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (disposed || generation !== session.generation) throw cause
      if (isConflict(cause))
        throw new ListActionRefreshRequiredError(
          messageOf(cause, '数据已变化，请刷新列表后重试。'),
        )
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new Error(
          messageOf(cause, enabled ? '员工启用失败。' : '员工停用失败。'),
        )
      try {
        const token = tokenFor(generation, employeePaths.get)
        if (token) await getTargetEmployee(token, item.id)
      } catch {
        /* cannot prove the write */
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }
  const list = useListPageViewModel<EmployeeListItem>({
    ...(can(employeePaths.query)
      ? {
          onSearch: (value: ListSearchInput) =>
            queryTargetEmployees(csrf(), value),
        }
      : {}),
    ...(can(employeePaths.create) ? { onCreate: openCreate } : {}),
    ...(can(employeePaths.get) && can(employeePaths.save)
      ? { onEdit: openEdit }
      : {}),
    ...(can(employeePaths.enable)
      ? { onEnable: (item) => setEnabled(item, true) }
      : {}),
    ...(can(employeePaths.disable)
      ? { onDisable: (item) => setEnabled(item, false) }
      : {}),
    onCanAction: canListAction,
  })
  const creationNotice = computed(() =>
    list.actionBlocked.value && lastCreatedId.value
      ? `新建成功（ID：${lastCreatedId.value}），但列表刷新失败，请先查询核实。`
      : '',
  )
  function dispose(): void {
    if (disposed) return
    disposed = true
    list.dispose()
    finish()
  }
  return {
    list,
    editorOpen,
    editorMode,
    editorLoading,
    referenceLoading,
    saving,
    editorError,
    detail,
    lastCreatedId,
    creationNotice,
    canSave,
    editor,
    operatingEntities,
    employeeCategories,
    departments,
    positions,
    openCreate,
    openEdit,
    saveEditor,
    closeEditor,
    dispose,
  }
}
