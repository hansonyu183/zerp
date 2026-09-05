import { computed, reactive, ref } from 'vue'
import {
  approvalActionPresentation,
  archiveEntityPresentation,
  vouEntityPresentation,
  type ApprovalAction,
  type ApprovalStatus,
  type VouEntity,
} from '@zerp/model'

import {
  deleteTargetArchive,
  deleteTargetVou,
  deleteTargetWarehouseSubmission,
  deleteTargetWflDefinition,
  queryTargetWorkbench,
  reviewTargetArchive,
  reviewTargetVou,
  reviewTargetWarehouse,
  reviewTargetWflDefinition,
  type TargetArchiveDeleteRequest,
  type TargetArchiveEntity,
  type TargetArchiveReviewRequest,
  type TargetWarehouseAction,
  type TargetWorkbenchQueryInput,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

export type WorkbenchTab = 'DOCUMENT' | 'ARCHIVE'
const workbenchArchivePresentation = {
  ...archiveEntityPresentation,
  warehouse: { label: '仓库' },
  'wfl-process-definition': { label: '流程定义' },
}

export function workbenchEntityOptions(tab: WorkbenchTab) {
  const presentation =
    tab === 'DOCUMENT' ? vouEntityPresentation : workbenchArchivePresentation
  return Object.entries(presentation).map(([value, { label }]) => ({
    value,
    title: label,
  }))
}

export function workbenchEntityLabel(
  domain: 'dcl' | 'vou',
  entity: string,
): string {
  return (
    workbenchEntityOptions(domain === 'vou' ? 'DOCUMENT' : 'ARCHIVE').find(
      (option) => option.value === entity,
    )?.title ?? '未知业务类型'
  )
}
export type WorkbenchReviewAction = Extract<
  ApprovalAction,
  'reject' | 'approve' | 'unreject'
>
export type WorkbenchAction = 'view' | 'edit' | 'delete' | WorkbenchReviewAction
export interface WorkbenchItem {
  domain: 'dcl' | 'vou'
  entity: string
  subjectOrDocumentId: string
  submissionId: string
  code: string
  name: string
  status: Extract<ApprovalStatus, 'PENDING' | 'REJECTED'>
  revision: string
  availableActions: WorkbenchAction[]
  updatedAt: string
}

function state() {
  return reactive({
    keyword: '',
    entity: '',
    status: '' as '' | 'PENDING' | 'REJECTED',
    page: 1,
    items: [] as WorkbenchItem[],
    total: 0,
    loading: false,
    queryError: null as string | null,
    actionError: null as string | null,
  })
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function useDashboardViewModel() {
  const session = useTargetSession()
  const activeTab = ref<WorkbenchTab>('DOCUMENT')
  const documents = state()
  const archives = state()
  const reasons = ref<Record<string, string>>({})
  const requestVersions: Record<WorkbenchTab, number> = {
    DOCUMENT: 0,
    ARCHIVE: 0,
  }
  const activeState = computed(() =>
    activeTab.value === 'DOCUMENT' ? documents : archives,
  )
  const csrf = () => session.csrfToken ?? ''
  const tabState = (tab: WorkbenchTab) =>
    tab === 'DOCUMENT' ? documents : archives

  function input(tab: WorkbenchTab, page: number): TargetWorkbenchQueryInput {
    const current = tabState(tab)
    const filters = {
      kind: tab,
      ...(current.entity.trim() ? { entity: current.entity.trim() } : {}),
      ...(current.status ? { status: current.status } : {}),
      ...(current.keyword.trim() ? { keyword: current.keyword.trim() } : {}),
    }
    return { page, pageSize: 20, filters }
  }

  async function query(
    tab: WorkbenchTab = activeTab.value,
    page = tabState(tab).page,
    correcting = false,
  ): Promise<void> {
    const current = tabState(tab)
    const version = ++requestVersions[tab]
    current.loading = true
    try {
      const result = await queryTargetWorkbench(csrf(), input(tab, page))
      if (version !== requestVersions[tab]) return
      const lastPage = Math.max(1, Math.ceil(result.total / 20))
      if (!correcting && result.page > lastPage)
        return query(tab, lastPage, true)
      current.items = result.items as WorkbenchItem[]
      current.total = result.total
      current.page = result.page
      current.queryError = null
    } catch (cause) {
      if (version === requestVersions[tab])
        current.queryError = message(cause, '工作台查询失败。')
    } finally {
      if (version === requestVersions[tab]) current.loading = false
    }
  }

  async function switchTab(tab: WorkbenchTab): Promise<void> {
    activeTab.value = tab
    await query(tab)
  }
  async function applyFilters(): Promise<void> {
    activeState.value.page = 1
    await query(activeTab.value, 1)
  }
  async function resetFilters(): Promise<void> {
    Object.assign(activeState.value, {
      keyword: '',
      entity: '',
      status: '',
      page: 1,
    })
    await query(activeTab.value, 1)
  }
  async function retry(): Promise<void> {
    await query(activeTab.value, activeState.value.page)
  }

  function itemHref(item: WorkbenchItem, mode: 'view' | 'edit'): string {
    const parameters = new URLSearchParams({ mode })
    if (item.domain === 'vou')
      parameters.set('documentId', item.subjectOrDocumentId)
    else {
      parameters.set('objectId', item.subjectOrDocumentId)
      parameters.set('code', item.code)
    }
    parameters.set('submissionId', item.submissionId)
    parameters.set('revision', item.revision)
    return `/${item.domain}/${item.entity}?${parameters.toString()}`
  }
  function visibleActions(item: WorkbenchItem): WorkbenchAction[] {
    return item.availableActions.filter(
      (action) => action !== 'view' || !item.availableActions.includes('edit'),
    )
  }
  function actionLabel(action: WorkbenchAction): string {
    if (action === 'view') return '查看'
    if (action === 'edit') return '编辑'
    if (action === 'delete') return '撤回'
    return approvalActionPresentation[action].label
  }

  async function review(
    item: WorkbenchItem,
    action: WorkbenchReviewAction,
  ): Promise<void> {
    const current = activeState.value
    const reason = reasons.value[item.submissionId]?.trim()
    current.actionError = null
    if (action === 'reject' && !reason) {
      current.actionError = '请填写驳回原因。'
      return
    }
    try {
      const identity = {
        subjectId: item.subjectOrDocumentId,
        submissionId: item.submissionId,
        expectedRevision: item.revision,
        ...(action === 'reject' ? { reason: reason ?? '' } : {}),
      }
      if (item.domain === 'vou') {
        const input = {
          documentId: item.subjectOrDocumentId,
          submissionId: item.submissionId,
          expectedRevision: item.revision,
        }
        await reviewTargetVou(
          csrf(),
          item.entity as VouEntity,
          action === 'reject'
            ? { action, input: { ...input, reason: reason ?? '' } }
            : { action, input },
        )
      } else if (item.entity === 'warehouse')
        await reviewTargetWarehouse(
          csrf(),
          action as TargetWarehouseAction,
          identity,
        )
      else if (item.entity === 'wfl-process-definition')
        await reviewTargetWflDefinition(csrf(), action, identity)
      else
        await reviewTargetArchive(csrf(), {
          entity: item.entity as TargetArchiveEntity,
          action,
          input: identity,
        } as TargetArchiveReviewRequest)
    } catch (cause) {
      current.actionError = message(cause, '待办处理失败。')
    } finally {
      await query(activeTab.value, current.page)
    }
  }

  async function remove(item: WorkbenchItem): Promise<void> {
    const current = activeState.value
    current.actionError = null
    try {
      const identity = {
        subjectId: item.subjectOrDocumentId,
        submissionId: item.submissionId,
        expectedRevision: item.revision,
      }
      if (item.domain === 'vou')
        await deleteTargetVou(csrf(), item.entity as VouEntity, {
          documentId: item.subjectOrDocumentId,
          submissionId: item.submissionId,
          expectedRevision: item.revision,
        })
      else if (item.entity === 'warehouse')
        await deleteTargetWarehouseSubmission(csrf(), identity)
      else if (item.entity === 'wfl-process-definition')
        await deleteTargetWflDefinition(csrf(), identity)
      else
        await deleteTargetArchive(csrf(), {
          entity: item.entity as TargetArchiveEntity,
          input: identity,
        } as TargetArchiveDeleteRequest)
    } catch (cause) {
      current.actionError = message(cause, '撤回失败。')
    } finally {
      await query(activeTab.value, current.page)
    }
  }

  return {
    activeTab,
    documents,
    archives,
    activeState,
    reasons,
    query,
    switchTab,
    applyFilters,
    resetFilters,
    retry,
    itemHref,
    visibleActions,
    actionLabel,
    review,
    remove,
  }
}
