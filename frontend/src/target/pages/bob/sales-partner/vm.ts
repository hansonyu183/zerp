import { computed, ref, toRaw, watch } from 'vue'

import {
  TargetApiError,
  approveTargetSalesPartner,
  deleteTargetSalesPartner,
  getTargetSalesPartner,
  getTargetSalesPartnerSubmission,
  queryTargetOperatingEntities,
  queryTargetSalesPartners,
  queryTargetSalesPartnerAuditHistory,
  queryTargetSalesPartnerSubmissions,
  queryTargetSalesPartnerVersions,
  rejectTargetSalesPartner,
  setTargetSalesPartnerEnabled,
  submitChangeTargetSalesPartner,
  submitNewTargetSalesPartner,
  unapproveTargetSalesPartner,
  unrejectTargetSalesPartner,
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

type SalesPartnerCurrent = Awaited<ReturnType<typeof queryTargetSalesPartners>>
export type SalesPartnerListItem = SalesPartnerCurrent['items'][number] & {
  id: string
}
export type SalesPartnerSnapshot = Awaited<
  ReturnType<typeof getTargetSalesPartnerSubmission>
>['snapshot']

type StableOption = { id: string; code: string; name: string }

export const salesPartnerPaths = {
  query: '/bob/sales-partner/query',
  get: '/bob/sales-partner/get',
  enable: '/bob/sales-partner/enable',
  disable: '/bob/sales-partner/disable',
  submitNew: '/bob/sales-partner/submit-new',
  submitChange: '/bob/sales-partner/submit-change',
  submissionQuery: '/bob/sales-partner/submission-query',
  submissionGet: '/bob/sales-partner/submission-get',
  versions: '/bob/sales-partner/versions',
  audit: '/bob/sales-partner/audit-history',
  approve: '/bob/sales-partner/approve',
  reject: '/bob/sales-partner/reject',
  unreject: '/bob/sales-partner/unreject',
  unapprove: '/bob/sales-partner/unapprove',
  delete: '/bob/sales-partner/delete',
} as const

export const salesPartnerListPage = defineListPage<SalesPartnerListItem>({
  title: '销售合作方',
  createLabel: '新增销售合作方',
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

function mapPage(page: SalesPartnerCurrent) {
  return {
    ...page,
    items: page.items.map((item) => ({ ...item, id: item.objectId })),
  }
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function useSalesPartnerManagementViewModel() {
  const session = useTargetSession()
  const can = (path: string) => session.can(path)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const operatingEntityOptions = ref<StableOption[]>([])
  type SalesPartnerDetail = Awaited<ReturnType<typeof getTargetSalesPartner>>
  const currentDetail = ref<SalesPartnerDetail | null>(null)
  const detailOpen = ref(false)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  const referenceLoads = ref(0)
  const referenceLoading = computed(() => referenceLoads.value > 0)
  const editorOpeningId = ref<string | null>(null)
  let referenceRequest = 0
  let detailRequest = 0
  let disposed = false

  const editor = useArchiveSubmissionEditor<SalesPartnerSnapshot>({
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
      capabilities: [],
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
      if (snapshot.capabilities.length === 0) return '请至少选择一种合作能力。'
      return null
    },
    canSubmitNew: () => can(salesPartnerPaths.submitNew),
    canSubmitChange: () => can(salesPartnerPaths.submitChange),
    canGet: () => can(salesPartnerPaths.submissionGet),
    get: (input) => getTargetSalesPartnerSubmission(csrf(), input),
    versions: (subjectId) => queryTargetSalesPartnerVersions(csrf(), subjectId),
    submitNew: (input) => submitNewTargetSalesPartner(csrf(), input),
    submitChange: (input) => submitChangeTargetSalesPartner(csrf(), input),
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
    query: typeof queryTargetOperatingEntities,
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
  }
  function invalidateEditor(): void {
    referenceRequest += 1
    referenceLoads.value = 0
    operatingEntityOptions.value = []
  }
  function canCreate(): boolean {
    return can(salesPartnerPaths.submitNew)
  }
  function canClone(): boolean {
    return can(salesPartnerPaths.submitNew)
  }
  function canChange(): boolean {
    return (
      can(salesPartnerPaths.submitChange) && can(salesPartnerPaths.versions)
    )
  }
  async function openDetail(item: SalesPartnerListItem): Promise<void> {
    if (!can(salesPartnerPaths.get)) return
    const request = ++detailRequest
    const generation = session.generation
    detailOpen.value = true
    detailLoading.value = true
    detailError.value = null
    currentDetail.value = null
    try {
      const result = await getTargetSalesPartner(csrf(), item.objectId)
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
  function openHistoricalClone(snapshot: SalesPartnerSnapshot): void {
    if (!canCreate()) return
    invalidateEditor()
    editor.openClone(structuredClone(toRaw(snapshot)))
    loadReferences()
  }
  function openClone(item: SalesPartnerListItem): void {
    if (!canClone()) return
    openHistoricalClone(item.data)
  }
  async function openChange(item: SalesPartnerListItem): Promise<void> {
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

  async function toggle(
    item: SalesPartnerListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    try {
      await setTargetSalesPartnerEnabled(
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
          messageOf(
            cause,
            enabled ? '销售合作方启用失败。' : '销售合作方停用失败。',
          ),
        )
      if (can(salesPartnerPaths.get)) {
        try {
          await getTargetSalesPartner(csrf(), item.objectId)
        } catch {
          /* result remains unknown */
        }
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }
  const list = useListPageViewModel<SalesPartnerListItem>({
    ...(can(salesPartnerPaths.query)
      ? {
          onSearch: async (input: ListSearchInput) =>
            mapPage(
              await queryTargetSalesPartners(csrf(), {
                page: input.page,
                pageSize: input.pageSize,
                filters: input.keyword ? { keyword: input.keyword } : {},
              }),
            ),
        }
      : {}),
    ...(can(salesPartnerPaths.enable)
      ? { onEnable: (item: SalesPartnerListItem) => toggle(item, true) }
      : {}),
    ...(can(salesPartnerPaths.disable)
      ? { onDisable: (item: SalesPartnerListItem) => toggle(item, false) }
      : {}),
    onCanAction: (item, action: ListAction) =>
      Boolean(item) &&
      (action === 'enable'
        ? !item!.enabled && can(salesPartnerPaths.enable)
        : action === 'disable'
          ? item!.enabled && can(salesPartnerPaths.disable)
          : false),
  })
  function rowActions(item: SalesPartnerListItem): readonly RowAction[] {
    const pending =
      list.isRowPending(item.id) || editorOpeningId.value === item.id
    const disabled = pending || list.isRowBlocked(item.id)
    return [
      ...(can(salesPartnerPaths.get)
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
  function runRowAction(action: string, item: SalesPartnerListItem): void {
    if (action === 'detail') void openDetail(item)
    else if (action === 'clone') openClone(item)
    else if (action === 'change') void openChange(item)
    else if (action === 'enable') void list.enable(item)
    else if (action === 'disable') void list.disable(item)
  }

  type SalesPartnerSubmission = Awaited<
    ReturnType<typeof getTargetSalesPartnerSubmission>
  >
  const submissions = useArchiveSubmissionLifecycle<SalesPartnerSubmission>({
    canQuery: () => can(salesPartnerPaths.submissionQuery),
    canGet: () => can(salesPartnerPaths.submissionGet),
    canVersions: () => can(salesPartnerPaths.versions),
    canAudit: () => can(salesPartnerPaths.audit),
    canAction: (action) => can(salesPartnerPaths[action]),
    query: ({ page, keyword }) =>
      queryTargetSalesPartnerSubmissions(csrf(), {
        page,
        pageSize: 20,
        filters: keyword ? { keyword } : {},
      }),
    get: (input) => getTargetSalesPartnerSubmission(csrf(), input),
    versions: (id) => queryTargetSalesPartnerVersions(csrf(), id),
    auditHistory: (id) => queryTargetSalesPartnerAuditHistory(csrf(), id),
    approve: (input) => approveTargetSalesPartner(csrf(), input),
    reject: (input) => rejectTargetSalesPartner(csrf(), input),
    unreject: (input) => unrejectTargetSalesPartner(csrf(), input),
    unapprove: (input) => unapproveTargetSalesPartner(csrf(), input),
    delete: (input) => deleteTargetSalesPartner(csrf(), input),
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
    canViewSubmissions: () => can(salesPartnerPaths.submissionQuery),
    openCreate,
    openClone,
    openHistoricalClone,
    openChange,
    closeEditor,
    submit,
    verifyEditorOutcome,
    setOperatingEntities,
    rowActions,
    runRowAction,
    dispose,
  }
}
