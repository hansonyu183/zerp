import { computed, ref, toRaw, watch } from 'vue'

import {
  TargetApiError,
  approveTargetOtherUnit,
  deleteTargetOtherUnit,
  getTargetOtherUnit,
  getTargetOtherUnitSubmission,
  queryTargetAuxReferences,
  queryTargetOperatingEntities,
  queryTargetOtherUnits,
  queryTargetOtherUnitAuditHistory,
  queryTargetOtherUnitSubmissions,
  queryTargetOtherUnitVersions,
  rejectTargetOtherUnit,
  setTargetOtherUnitEnabled,
  submitChangeTargetOtherUnit,
  submitNewTargetOtherUnit,
  unapproveTargetOtherUnit,
  unrejectTargetOtherUnit,
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

type OtherUnitCurrent = Awaited<ReturnType<typeof queryTargetOtherUnits>>
export type OtherUnitListItem = OtherUnitCurrent['items'][number] & {
  id: string
}
export type OtherUnitSnapshot = Awaited<
  ReturnType<typeof getTargetOtherUnitSubmission>
>['snapshot']

type StableOption = { id: string; code: string; name: string }
type SettlementOption = StableOption &
  NonNullable<OtherUnitSnapshot['settlementMethod']>

export const otherUnitPaths = {
  query: '/bob/other-unit/query',
  get: '/bob/other-unit/get',
  enable: '/bob/other-unit/enable',
  disable: '/bob/other-unit/disable',
  submitNew: '/bob/other-unit/submit-new',
  submitChange: '/bob/other-unit/submit-change',
  submissionQuery: '/bob/other-unit/submission-query',
  submissionGet: '/bob/other-unit/submission-get',
  versions: '/bob/other-unit/versions',
  audit: '/bob/other-unit/audit-history',
  approve: '/bob/other-unit/approve',
  reject: '/bob/other-unit/reject',
  unreject: '/bob/other-unit/unreject',
  unapprove: '/bob/other-unit/unapprove',
  delete: '/bob/other-unit/delete',
} as const

export const otherUnitListPage = defineListPage<OtherUnitListItem>({
  title: '其他单位',
  createLabel: '新增其他单位',
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

function mapPage(page: OtherUnitCurrent) {
  return {
    ...page,
    items: page.items.map((item) => ({ ...item, id: item.objectId })),
  }
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function useOtherUnitManagementViewModel() {
  const session = useTargetSession()
  const can = (path: string) => session.can(path)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const operatingEntityOptions = ref<StableOption[]>([])
  const settlementOptions = ref<SettlementOption[]>([])
  type OtherUnitDetail = Awaited<ReturnType<typeof getTargetOtherUnit>>
  const currentDetail = ref<OtherUnitDetail | null>(null)
  const detailOpen = ref(false)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  const referenceLoads = ref(0)
  const referenceLoading = computed(() => referenceLoads.value > 0)
  const editorOpeningId = ref<string | null>(null)
  let referenceRequest = 0
  let detailRequest = 0
  let disposed = false

  const editor = useArchiveSubmissionEditor<OtherUnitSnapshot>({
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
    canSubmitNew: () => can(otherUnitPaths.submitNew),
    canSubmitChange: () => can(otherUnitPaths.submitChange),
    canGet: () => can(otherUnitPaths.submissionGet),
    get: (input) => getTargetOtherUnitSubmission(csrf(), input),
    versions: (subjectId) => queryTargetOtherUnitVersions(csrf(), subjectId),
    submitNew: (input) => submitNewTargetOtherUnit(csrf(), input),
    submitChange: (input) => submitChangeTargetOtherUnit(csrf(), input),
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
    settlementOptions.value = []
  }
  function canCreate(): boolean {
    return can(otherUnitPaths.submitNew)
  }
  function canClone(): boolean {
    return can(otherUnitPaths.submitNew)
  }
  function canChange(): boolean {
    return can(otherUnitPaths.submitChange) && can(otherUnitPaths.versions)
  }
  async function openDetail(item: OtherUnitListItem): Promise<void> {
    if (!can(otherUnitPaths.get)) return
    const request = ++detailRequest
    const generation = session.generation
    detailOpen.value = true
    detailLoading.value = true
    detailError.value = null
    currentDetail.value = null
    try {
      const result = await getTargetOtherUnit(csrf(), item.objectId)
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
  function openHistoricalClone(snapshot: OtherUnitSnapshot): void {
    if (!canCreate()) return
    invalidateEditor()
    editor.openClone(structuredClone(toRaw(snapshot)))
    loadReferences()
  }
  function openClone(item: OtherUnitListItem): void {
    if (!canClone()) return
    openHistoricalClone(item.data)
  }
  async function openChange(item: OtherUnitListItem): Promise<void> {
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
    item: OtherUnitListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    try {
      await setTargetOtherUnitEnabled(
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
            enabled ? '其他单位启用失败。' : '其他单位停用失败。',
          ),
        )
      if (can(otherUnitPaths.get)) {
        try {
          await getTargetOtherUnit(csrf(), item.objectId)
        } catch {
          /* result remains unknown */
        }
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }
  const list = useListPageViewModel<OtherUnitListItem>({
    ...(can(otherUnitPaths.query)
      ? {
          onSearch: async (input: ListSearchInput) =>
            mapPage(
              await queryTargetOtherUnits(csrf(), {
                page: input.page,
                pageSize: input.pageSize,
                filters: input.keyword ? { keyword: input.keyword } : {},
              }),
            ),
        }
      : {}),
    ...(can(otherUnitPaths.enable)
      ? { onEnable: (item: OtherUnitListItem) => toggle(item, true) }
      : {}),
    ...(can(otherUnitPaths.disable)
      ? { onDisable: (item: OtherUnitListItem) => toggle(item, false) }
      : {}),
    onCanAction: (item, action: ListAction) =>
      Boolean(item) &&
      (action === 'enable'
        ? !item!.enabled && can(otherUnitPaths.enable)
        : action === 'disable'
          ? item!.enabled && can(otherUnitPaths.disable)
          : false),
  })
  function rowActions(item: OtherUnitListItem): readonly RowAction[] {
    const pending =
      list.isRowPending(item.id) || editorOpeningId.value === item.id
    const disabled = pending || list.isRowBlocked(item.id)
    return [
      ...(can(otherUnitPaths.get)
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
  function runRowAction(action: string, item: OtherUnitListItem): void {
    if (action === 'detail') void openDetail(item)
    else if (action === 'clone') openClone(item)
    else if (action === 'change') void openChange(item)
    else if (action === 'enable') void list.enable(item)
    else if (action === 'disable') void list.disable(item)
  }

  type OtherUnitSubmission = Awaited<
    ReturnType<typeof getTargetOtherUnitSubmission>
  >
  const submissions = useArchiveSubmissionLifecycle<OtherUnitSubmission>({
    canQuery: () => can(otherUnitPaths.submissionQuery),
    canGet: () => can(otherUnitPaths.submissionGet),
    canVersions: () => can(otherUnitPaths.versions),
    canAudit: () => can(otherUnitPaths.audit),
    canAction: (action) => can(otherUnitPaths[action]),
    query: ({ page, keyword }) =>
      queryTargetOtherUnitSubmissions(csrf(), {
        page,
        pageSize: 20,
        filters: keyword ? { keyword } : {},
      }),
    get: (input) => getTargetOtherUnitSubmission(csrf(), input),
    versions: (id) => queryTargetOtherUnitVersions(csrf(), id),
    auditHistory: (id) => queryTargetOtherUnitAuditHistory(csrf(), id),
    approve: (input) => approveTargetOtherUnit(csrf(), input),
    reject: (input) => rejectTargetOtherUnit(csrf(), input),
    unreject: (input) => unrejectTargetOtherUnit(csrf(), input),
    unapprove: (input) => unapproveTargetOtherUnit(csrf(), input),
    delete: (input) => deleteTargetOtherUnit(csrf(), input),
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
    canViewSubmissions: () => can(otherUnitPaths.submissionQuery),
    openCreate,
    openClone,
    openHistoricalClone,
    openChange,
    closeEditor,
    submit,
    verifyEditorOutcome,
    setOperatingEntities,
    setSettlementMethod,
    rowActions,
    runRowAction,
    dispose,
  }
}
