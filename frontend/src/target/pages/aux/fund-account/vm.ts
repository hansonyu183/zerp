import { computed, reactive, ref } from 'vue'
import {
  createTargetFundAccount,
  deleteTargetFundAccount,
  getTargetFundAccount,
  queryTargetFundAccounts,
  queryTargetOperatingEntities,
  saveTargetFundAccount,
  setTargetFundAccountEnabled,
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

export type FundAccountListItem = Awaited<
  ReturnType<typeof queryTargetFundAccounts>
>['items'][number]
type Detail = Awaited<ReturnType<typeof getTargetFundAccount>>
export const fundAccountPaths = {
  query: '/aux/fund-account/query',
  get: '/aux/fund-account/get',
  create: '/aux/fund-account/create',
  save: '/aux/fund-account/save',
  enable: '/aux/fund-account/enable',
  disable: '/aux/fund-account/disable',
  delete: '/aux/fund-account/delete',
} as const
type Option = { id: string; title: string }
export function useFundAccountManagementViewModel() {
  const session = useTargetSession()
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorLoading = ref(false)
  const referenceLoading = ref(false)
  const saving = ref(false)
  const editorWriteBlocked = ref(false)
  const editorError = ref<string | null>(null)
  const lastCreatedId = ref<string | null>(null)
  const operatingEntities = ref<Option[]>([])
  const detail = ref<Detail | null>(null)
  const editor = reactive({
    id: '',
    revision: '',
    name: '',
    currency: '',
    accountName: '',
    bank: '',
    branch: '',
    accountNumber: '',
    operatingEntityId: '',
    remark: '',
  })
  let resolve: ((value: 'changed' | void) => void) | null = null
  let reject: ((cause: unknown) => void) | null = null
  let editorRequest = 0
  let disposed = false
  const can = (path: string) => session.can(path)
  const canReadReferences = computed(() => can('/aux/operating-entity/query'))
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
      currency: '',
      accountName: '',
      bank: '',
      branch: '',
      accountNumber: '',
      operatingEntityId: '',
      remark: '',
    })
    detail.value = null
    operatingEntities.value = []
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
  const canSave = computed(
    () =>
      !editorLoading.value &&
      !referenceLoading.value &&
      canReadReferences.value &&
      !editorWriteBlocked.value &&
      !saving.value &&
      (editorMode.value === 'create'
        ? can(fundAccountPaths.create)
        : Boolean(
            detail.value?.availableActions.includes('edit') &&
            can(fundAccountPaths.get) &&
            can(fundAccountPaths.save),
          )),
  )
  async function loadReferences(request: number, generation: number) {
    if (!can('/aux/operating-entity/query')) {
      if (current(request, generation))
        editorError.value = '编辑资金账户需要经营主体引用读取权限。'
      return
    }
    referenceLoading.value = true
    try {
      const options: Option[] = []
      let page = 1
      let fetched = 0
      let pageCount = Number.POSITIVE_INFINITY
      while (page <= pageCount) {
        if (!current(request, generation)) return
        const r = await queryTargetOperatingEntities(csrf(), {
          keyword: '',
          page,
          pageSize: 20,
        })
        if (!current(request, generation)) return
        options.push(
          ...r.items
            .filter((item) => item.enabled)
            .map((item) => ({
              id: item.id,
              title: `${item.code} · ${item.name}`,
            })),
        )
        fetched += r.items.length
        pageCount = Math.ceil(r.total / r.pageSize)
        if (fetched >= r.total || r.items.length === 0) break
        page += 1
      }
      if (!current(request, generation)) return
      operatingEntities.value = options
    } catch (e) {
      if (current(request, generation))
        editorError.value =
          e instanceof Error ? e.message : '经营主体选项加载失败。'
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
  function openEdit(item: FundAccountListItem) {
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
    if (!can(fundAccountPaths.get) || !can(fundAccountPaths.save)) {
      editorError.value = '编辑资金账户需要详情和保存权限。'
      return wait
    }
    editorLoading.value = true
    void getTargetFundAccount(csrf(), item.id)
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
          currency: v.currency,
          accountName: v.accountName,
          bank: v.bank,
          branch: v.branch,
          accountNumber: v.accountNumber,
          operatingEntityId: v.operatingEntity.id,
          remark: v.remark,
        })
      })
      .catch((e) => {
        if (
          disposed ||
          request !== editorRequest ||
          generation !== session.generation
        )
          return
        editorError.value =
          e instanceof Error ? e.message : '资金账户编辑信息加载失败。'
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
    if (
      !editor.name.trim() ||
      !editor.currency.trim() ||
      !editor.accountName.trim() ||
      !editor.bank.trim() ||
      !editor.accountNumber.trim() ||
      !editor.operatingEntityId
    ) {
      editorError.value = '请填写资金账户必填字段和所属经营主体。'
      return
    }
    const request = editorRequest
    const generation = session.generation
    const token = csrf()
    saving.value = true
    const input = {
      name: editor.name.trim(),
      currency: editor.currency.trim(),
      accountName: editor.accountName.trim(),
      bank: editor.bank.trim(),
      branch: editor.branch.trim(),
      accountNumber: editor.accountNumber.trim(),
      operatingEntityId: editor.operatingEntityId,
      remark: editor.remark.trim(),
    }
    try {
      if (editorMode.value === 'create') {
        const created = await createTargetFundAccount(token, input)
        if (!current(request, generation)) return
        lastCreatedId.value = created.id
      } else
        await saveTargetFundAccount(token, {
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
        editorError.value = e.message || '资金账户保存失败。'
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
    item: FundAccountListItem,
    enabled: boolean,
  ): Promise<'changed'> => {
    try {
      await setTargetFundAccountEnabled(
        csrf(),
        { id: item.id, revision: item.revision },
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
          e.message || (enabled ? '资金账户启用失败。' : '资金账户停用失败。'),
        )
      throw new ListActionUnresolvedError('请求结果未知；请刷新后核实。')
    }
  }
  const deleteItem = async (item: FundAccountListItem): Promise<'changed'> => {
    try {
      await deleteTargetFundAccount(csrf(), {
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
        throw new Error(e.message || '资金账户删除失败。')
      throw new ListActionUnresolvedError('请求结果未知；请刷新后核实。')
    }
  }
  const list = useListPageViewModel<FundAccountListItem>({
    ...(can(fundAccountPaths.query)
      ? { onSearch: (v: ListSearchInput) => queryTargetFundAccounts(csrf(), v) }
      : {}),
    ...(can(fundAccountPaths.create) ? { onCreate: openCreate } : {}),
    ...(can(fundAccountPaths.get) && can(fundAccountPaths.save)
      ? { onEdit: openEdit }
      : {}),
    ...(can(fundAccountPaths.enable)
      ? { onEnable: (i) => toggle(i, true) }
      : {}),
    ...(can(fundAccountPaths.disable)
      ? { onDisable: (i) => toggle(i, false) }
      : {}),
    ...(can(fundAccountPaths.delete) ? { onDelete: deleteItem } : {}),
    onCanAction: (item, action: ListAction) => {
      if (action === 'create') return can(fundAccountPaths.create)
      if (!item) return false
      if (action === 'edit')
        return (
          item.availableActions.includes('edit') &&
          can(fundAccountPaths.get) &&
          can(fundAccountPaths.save)
        )
      if (action === 'delete')
        return (
          item.availableActions.includes('delete') &&
          can(fundAccountPaths.delete)
        )
      return (
        item.availableActions.includes(action) && can(fundAccountPaths[action])
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
    operatingEntities,
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
