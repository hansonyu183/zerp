import { computed, ref, toRaw, watch } from 'vue'

import {
  TargetApiError,
  approveTargetSupplier,
  deleteTargetSupplier,
  getTargetSupplier,
  getTargetSupplierSubmission,
  queryTargetAuxReferences,
  queryTargetEmployees,
  queryTargetOperatingEntities,
  queryTargetSuppliers,
  queryTargetSupplierAuditHistory,
  queryTargetSupplierSubmissions,
  queryTargetSupplierVersions,
  rejectTargetSupplier,
  setTargetSupplierEnabled,
  submitChangeTargetSupplier,
  submitNewTargetSupplier,
  unapproveTargetSupplier,
  unrejectTargetSupplier,
} from '../../../api.ts'
import { defineListPage } from '../../../components/list-page/definition.ts'
import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type ListAction,
  type ListSearchInput,
} from '../../../components/list-page/vm.ts'
import type { RowAction } from '../../../components/dynamic-fields/types.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { describeBobEnablementFailure } from '../archive/blockers.ts'
import { useArchiveSubmissionEditor } from '../archive/submission.ts'
import { useArchiveSubmissionLifecycle } from '../archive/lifecycle.ts'

type SupplierCurrent = Awaited<ReturnType<typeof queryTargetSuppliers>>
export type SupplierListItem = SupplierCurrent['items'][number] & { id: string }
export type SupplierSnapshot = Awaited<
  ReturnType<typeof getTargetSupplierSubmission>
>['snapshot']

type StableOption = { id: string; code: string; name: string }
type SettlementOption = StableOption &
  NonNullable<SupplierSnapshot['settlementMethod']>

export const supplierPaths = {
  query: '/bob/supplier/query',
  get: '/bob/supplier/get',
  enable: '/bob/supplier/enable',
  disable: '/bob/supplier/disable',
  submitNew: '/bob/supplier/submit-new',
  submitChange: '/bob/supplier/submit-change',
  submissionQuery: '/bob/supplier/submission-query',
  submissionGet: '/bob/supplier/submission-get',
  versions: '/bob/supplier/versions',
  audit: '/bob/supplier/audit-history',
  approve: '/bob/supplier/approve',
  reject: '/bob/supplier/reject',
  unreject: '/bob/supplier/unreject',
  unapprove: '/bob/supplier/unapprove',
  delete: '/bob/supplier/delete',
} as const

export const supplierListPage = defineListPage<SupplierListItem>({
  title: '供应商',
  createLabel: '新增供应商',
  columns: [
    { key: 'code', type: 'text', caption: '编码' },
    { key: 'name', type: 'text', caption: '名称' },
    {
      key: 'enabled',
      type: 'boolean',
      caption: '状态',
      trueCaption: '启用',
      falseCaption: '停用',
    },
    { key: '$actions', type: 'actions', caption: '操作' },
  ],
  filters: [{ key: 'keyword', type: 'text', caption: '编码、拼音或名称' }],
})

function mapPage(page: SupplierCurrent) {
  return {
    ...page,
    items: page.items.map((item) => ({ ...item, id: item.objectId })),
  }
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function useSupplierManagementViewModel() {
  const session = useTargetSession()
  const can = (path: string) => session.can(path)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const operatingEntityOptions = ref<StableOption[]>([])
  const purchaserOptions = ref<StableOption[]>([])
  const settlementOptions = ref<SettlementOption[]>([])
  type SupplierDetail = Awaited<ReturnType<typeof getTargetSupplier>>
  const currentDetail = ref<SupplierDetail | null>(null)
  const detailOpen = ref(false)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  const referenceLoads = ref(0)
  const referenceLoading = computed(() => referenceLoads.value > 0)
  const editorOpeningId = ref<string | null>(null)
  let referenceRequest = 0
  let detailRequest = 0
  let disposed = false

  const editor = useArchiveSubmissionEditor<SupplierSnapshot>({
    createSnapshot: () => ({
      identityKind: 'ORGANIZATION',
      legalName: '',
      displayName: '',
      legalIdentifier: '',
      contactName: '',
      phone: '',
      address: '',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '',
      settlementMethod: null,
      defaultPurchaser: null,
    }),
    validate: (snapshot) => {
      if (!snapshot.legalName.trim() || !snapshot.displayName.trim())
        return '请填写法定名称和显示名称。'
      if (
        snapshot.defaultOperatingEntityId &&
        !snapshot.operatingEntities.some(
          (entity) => entity.objectId === snapshot.defaultOperatingEntityId,
        )
      )
        return '默认经营主体必须在适用经营主体内。'
      return null
    },
    canSubmitNew: () => can(supplierPaths.submitNew),
    canSubmitChange: () => can(supplierPaths.submitChange),
    canGet: () => can(supplierPaths.submissionGet),
    get: (input) => getTargetSupplierSubmission(csrf(), input),
    versions: (subjectId) => queryTargetSupplierVersions(csrf(), subjectId),
    submitNew: (input) => submitNewTargetSupplier(csrf(), input),
    submitChange: (input) => submitChangeTargetSupplier(csrf(), input),
  })

  const isCurrentEditorOpening = (request: number, generation: number) =>
    !disposed &&
    request === referenceRequest &&
    generation === session.generation &&
    editor.open.value

  function loadOptions<T>(
    read: () => Promise<T[]>,
    apply: (values: T[]) => void,
    request: number,
    generation: number,
  ): void {
    referenceLoads.value += 1
    void read()
      .then((values) => {
        if (isCurrentEditorOpening(request, generation)) apply(values)
      })
      .catch((cause) => {
        if (isCurrentEditorOpening(request, generation))
          editor.error.value = messageOf(cause, '引用选项加载失败。')
      })
      .finally(() => {
        if (!disposed && request === referenceRequest)
          referenceLoads.value = Math.max(0, referenceLoads.value - 1)
      })
  }
  function loadAllCurrent(
    query: typeof queryTargetOperatingEntities | typeof queryTargetEmployees,
  ): Promise<StableOption[]> {
    return (async () => {
      const items: StableOption[] = []
      let page = 1
      let read = 0
      let total = Number.POSITIVE_INFINITY
      while (read < total) {
        const result = await query(csrf(), { keyword: '', page, pageSize: 20 })
        read += result.items.length
        items.push(
          ...result.items
            .filter((item) => item.enabled)
            .map((item) => ({
              id: item.id,
              code: item.code,
              name: item.name,
            })),
        )
        total = result.total
        if (result.items.length === 0) break
        page += 1
      }
      return items
    })()
  }
  function loadReferences(): void {
    const request = ++referenceRequest
    const generation = session.generation
    if (can('/aux/operating-entity/query'))
      loadOptions(
        () => loadAllCurrent(queryTargetOperatingEntities),
        (items) => {
          operatingEntityOptions.value = items
        },
        request,
        generation,
      )
    if (can('/aux/employee/query'))
      loadOptions(
        () => loadAllCurrent(queryTargetEmployees),
        (items) => {
          purchaserOptions.value = items
        },
        request,
        generation,
      )
    if (can('/aux/reference/query'))
      loadOptions(
        async () =>
          (
            await queryTargetAuxReferences(csrf(), {
              entity: 'settlement-method',
            })
          ).map((item) => ({
            id: item.objectId,
            code: item.code,
            name: item.name,
            termCode: item.termCode,
            ruleType: item.ruleType,
            monthOffset: item.monthOffset,
            dayOfMonth: item.dayOfMonth,
            dayOffset: item.dayOffset,
          })),
        (items) => {
          settlementOptions.value = items
        },
        request,
        generation,
      )
  }
  function invalidateEditor(): void {
    referenceRequest += 1
    referenceLoads.value = 0
    operatingEntityOptions.value = []
    purchaserOptions.value = []
    settlementOptions.value = []
  }
  function canCreate(): boolean {
    return can(supplierPaths.submitNew)
  }
  function canClone(): boolean {
    return can(supplierPaths.submitNew)
  }
  function canChange(): boolean {
    return can(supplierPaths.submitChange) && can(supplierPaths.versions)
  }
  async function openDetail(item: SupplierListItem): Promise<void> {
    if (!can(supplierPaths.get)) return
    const request = ++detailRequest
    const generation = session.generation
    detailOpen.value = true
    detailLoading.value = true
    detailError.value = null
    currentDetail.value = null
    try {
      const result = await getTargetSupplier(csrf(), item.objectId)
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        currentDetail.value = result
    } catch (cause) {
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        detailError.value = messageOf(cause, '正式资料读取失败。')
    } finally {
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        detailLoading.value = false
    }
  }
  function closeDetail(): void {
    detailRequest += 1
    detailOpen.value = false
    detailLoading.value = false
    detailError.value = null
    currentDetail.value = null
  }
  function openCreate(): void {
    if (!canCreate()) return
    invalidateEditor()
    editor.openCreate()
    loadReferences()
  }
  function openHistoricalClone(snapshot: SupplierSnapshot): void {
    if (!canCreate()) return
    invalidateEditor()
    editor.openClone(structuredClone(toRaw(snapshot)))
    loadReferences()
  }
  function openClone(item: SupplierListItem): void {
    if (!canClone()) return
    openHistoricalClone(item.data)
  }
  async function openChange(item: SupplierListItem): Promise<void> {
    if (!canChange() || editorOpeningId.value) return
    editorOpeningId.value = item.id
    invalidateEditor()
    try {
      await editor.openChange(item.objectId)
      if (!editor.open.value) return
      loadReferences()
    } finally {
      if (!disposed) editorOpeningId.value = null
    }
  }
  function closeEditor(): void {
    if (editor.saving.value) return
    invalidateEditor()
    editor.close()
  }
  function setOperatingEntities(ids: readonly string[]): void {
    editor.draft.value.operatingEntities = ids.flatMap((id) => {
      const option = operatingEntityOptions.value.find((item) => item.id === id)
      return option
        ? [{ objectId: option.id, code: option.code, name: option.name }]
        : []
    })
    if (
      editor.draft.value.defaultOperatingEntityId &&
      !ids.includes(editor.draft.value.defaultOperatingEntityId)
    )
      editor.draft.value.defaultOperatingEntityId = null
  }
  function setDefaultPurchaser(id: string | null): void {
    const option = purchaserOptions.value.find((item) => item.id === id)
    editor.draft.value.defaultPurchaser = option
      ? { objectId: option.id, code: option.code, name: option.name }
      : null
  }
  function setSettlementMethod(id: string | null): void {
    const option = settlementOptions.value.find((item) => item.id === id)
    editor.draft.value.settlementMethod = option
      ? {
          id: option.id,
          code: option.code,
          name: option.name,
          termCode: option.termCode,
          ruleType: option.ruleType,
          monthOffset: option.monthOffset,
          dayOfMonth: option.dayOfMonth,
          dayOffset: option.dayOffset,
        }
      : null
  }

  async function toggle(
    item: SupplierListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    try {
      await setTargetSupplierEnabled(
        csrf(),
        { objectId: item.objectId, expectedRevision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (disposed || generation !== session.generation) throw cause
      const message = describeBobEnablementFailure(cause)
      if (message) throw new Error(message, { cause })
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new ListActionRefreshRequiredError(
          messageOf(cause, enabled ? '供应商启用失败。' : '供应商停用失败。'),
        )
      if (can(supplierPaths.get)) {
        try {
          await getTargetSupplier(csrf(), item.objectId)
        } catch {
          /* result remains unknown */
        }
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }
  const list = useListPageViewModel<SupplierListItem>({
    ...(can(supplierPaths.query)
      ? {
          onSearch: async (input: ListSearchInput) =>
            mapPage(
              await queryTargetSuppliers(csrf(), {
                page: input.page,
                pageSize: input.pageSize,
                filters: input.keyword ? { keyword: input.keyword } : {},
              }),
            ),
        }
      : {}),
    ...(can(supplierPaths.enable)
      ? { onEnable: (item: SupplierListItem) => toggle(item, true) }
      : {}),
    ...(can(supplierPaths.disable)
      ? { onDisable: (item: SupplierListItem) => toggle(item, false) }
      : {}),
    onCanAction: (item, action: ListAction) =>
      Boolean(item) &&
      (action === 'enable'
        ? !item!.enabled && can(supplierPaths.enable)
        : action === 'disable'
          ? item!.enabled && can(supplierPaths.disable)
          : false),
  })
  function rowActions(item: SupplierListItem): readonly RowAction[] {
    const pending =
      list.isRowPending(item.id) || editorOpeningId.value === item.id
    const disabled = pending || list.isRowBlocked(item.id)
    return [
      ...(can(supplierPaths.get)
        ? [
            {
              key: 'detail',
              caption: '查看',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(canClone()
        ? [
            {
              key: 'clone',
              caption: '克隆',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(canChange()
        ? [
            {
              key: 'change',
              caption: '提交变更',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(list.canAction('enable', item)
        ? [
            {
              key: 'enable',
              caption: '启用',
              color: 'success' as const,
              disabled,
              loading: pending,
            },
          ]
        : []),
      ...(list.canAction('disable', item)
        ? [
            {
              key: 'disable',
              caption: '停用',
              color: 'warning' as const,
              disabled,
              loading: pending,
            },
          ]
        : []),
    ]
  }
  function runRowAction(action: string, item: SupplierListItem): void {
    if (action === 'detail') void openDetail(item)
    else if (action === 'clone') openClone(item)
    else if (action === 'change') void openChange(item)
    else if (action === 'enable') void list.enable(item)
    else if (action === 'disable') void list.disable(item)
  }

  type SupplierSubmission = Awaited<
    ReturnType<typeof getTargetSupplierSubmission>
  >
  const submissions = useArchiveSubmissionLifecycle<SupplierSubmission>({
    canQuery: () => can(supplierPaths.submissionQuery),
    canGet: () => can(supplierPaths.submissionGet),
    canVersions: () => can(supplierPaths.versions),
    canAudit: () => can(supplierPaths.audit),
    canAction: (action) => can(supplierPaths[action]),
    query: ({ page, keyword }) =>
      queryTargetSupplierSubmissions(csrf(), {
        page,
        pageSize: 20,
        filters: keyword ? { keyword } : {},
      }),
    get: (input) => getTargetSupplierSubmission(csrf(), input),
    versions: (id) => queryTargetSupplierVersions(csrf(), id),
    auditHistory: (id) => queryTargetSupplierAuditHistory(csrf(), id),
    approve: (input) => approveTargetSupplier(csrf(), input),
    reject: (input) => rejectTargetSupplier(csrf(), input),
    unreject: (input) => unrejectTargetSupplier(csrf(), input),
    unapprove: (input) => unapproveTargetSupplier(csrf(), input),
    delete: (input) => deleteTargetSupplier(csrf(), input),
    onChanged: async () => {
      await list.refresh()
    },
  })
  async function submit(): Promise<void> {
    if ((await editor.submit()) === 'changed') await list.refresh()
  }
  async function verifyEditorOutcome(): Promise<void> {
    if ((await editor.verifyOutcome()) === 'changed') await list.refresh()
  }
  const stopSessionWatch = watch(
    () => session.generation,
    () => {
      if (disposed) return
      editor.dispose()
      submissions.dispose()
      invalidateEditor()
      closeDetail()
      list.dispose()
    },
    { flush: 'sync' },
  )
  function dispose(): void {
    if (disposed) return
    disposed = true
    stopSessionWatch()
    closeDetail()
    invalidateEditor()
    list.dispose()
    editor.dispose()
    submissions.dispose()
  }
  return {
    list,
    editor,
    submissions,
    operatingEntityOptions,
    purchaserOptions,
    settlementOptions,
    referenceLoading,
    currentDetail,
    detailOpen,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
    canCreate,
    canClone,
    canChange,
    canViewSubmissions: () => can(supplierPaths.submissionQuery),
    openCreate,
    openClone,
    openHistoricalClone,
    openChange,
    closeEditor,
    submit,
    verifyEditorOutcome,
    setOperatingEntities,
    setDefaultPurchaser,
    setSettlementMethod,
    rowActions,
    runRowAction,
    dispose,
  }
}
