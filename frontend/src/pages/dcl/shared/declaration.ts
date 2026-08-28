import { ref, type Ref } from 'vue'
import { getErrorMessage } from '@/api/types'

export type DclDeclarationEntity =
  | 'party'
  | 'operating-entity'
  | 'warehouse'
  | 'vehicle'
  | 'fund-account'
  | 'product'
  | 'employee'
export type DclDeclarationLifecycleAction =
  'approve' | 'reject' | 'unsubmit' | 'unapprove' | 'enable' | 'disable'
export type DclDeclarationWireAction =
  Exclude<DclDeclarationLifecycleAction, 'enable' | 'disable'> | 'submit'

export type DclDeclarationActionState = {
  status: 'DRAFT' | 'PENDING' | 'APPROVED'
  versionNo: number
  submittedBy: string | null | undefined
  enabled: boolean
  hasOpenVersion: boolean
  hasLatestApproved: boolean
}

export interface DclDeclarationActionAvailability {
  view: boolean
  edit: boolean
  delete: boolean
  submit: boolean
  unsubmit: boolean
  approve: boolean
  unapprove: boolean
  reject: boolean
  enable: boolean
  disable: boolean
  versions: boolean
  audit: boolean
}

export type DclDeclarationLifecyclePort<TItem> = {
  run: (
    item: TItem,
    action: DclDeclarationWireAction,
    reason: string,
  ) => Promise<void>
  changeEnabled: (item: TItem) => Promise<void>
}

export type DclDeclarationHistoryPort<TItem, TVersion, TAudit> = {
  loadVersions: (
    item: TItem,
    page: number,
    pageSize: number,
    update: (
      items: TVersion[],
      total: number,
      page: number,
      pageSize: number,
    ) => void,
  ) => Promise<void>
  loadAudit: (
    item: TItem,
    page: number,
    pageSize: number,
    update: (
      items: TAudit[],
      total: number,
      page: number,
      pageSize: number,
    ) => void,
  ) => Promise<void>
}

export function isDclDeclarationEntity(
  entity: string,
): entity is DclDeclarationEntity {
  return (
    entity === 'party' ||
    entity === 'operating-entity' ||
    entity === 'warehouse' ||
    entity === 'vehicle' ||
    entity === 'fund-account' ||
    entity === 'product' ||
    entity === 'employee'
  )
}

export function dclDeclarationPath(entity: DclDeclarationEntity): string {
  return `/dcl/${entity}`
}

export function dclDeclarationLifecycleSuccessLabel(
  action: DclDeclarationLifecycleAction,
): string {
  return {
    approve: '已审核通过',
    reject: '已审核驳回',
    unsubmit: '已撤回提交',
    unapprove: '已撤销批准',
    enable: '已生成启用草稿',
    disable: '已生成禁用草稿',
  }[action]
}

export function useDclDeclarationActionAvailability<TItem>(
  entity: DclDeclarationEntity,
  actionState: (item: Readonly<TItem>) => DclDeclarationActionState,
  userId: () => string | undefined,
  can: (path: string) => boolean,
) {
  const permission = (action: string): string =>
    `${dclDeclarationPath(entity)}/${action}`

  function actionAvailability(
    item: Readonly<TItem>,
  ): DclDeclarationActionAvailability {
    const state = actionState(item)
    const selfReview =
      state.status === 'PENDING' && state.submittedBy === userId()
    return {
      view: can(permission('get')),
      edit:
        (state.status === 'DRAFT' || state.status === 'APPROVED') &&
        can(permission('get')) &&
        can(permission('save')),
      delete:
        can(permission('delete')) &&
        state.status === 'DRAFT' &&
        state.versionNo === 1 &&
        !state.hasLatestApproved,
      submit: can(permission('submit')) && state.status === 'DRAFT',
      unsubmit: can(permission('unsubmit')) && state.status === 'PENDING',
      approve:
        can(permission('approve')) && state.status === 'PENDING' && !selfReview,
      unapprove: can(permission('unapprove')) && state.status === 'APPROVED',
      reject:
        can(permission('reject')) && state.status === 'PENDING' && !selfReview,
      enable:
        can(permission('get')) &&
        can(permission('save')) &&
        !state.hasOpenVersion &&
        state.hasLatestApproved &&
        !state.enabled,
      disable:
        can(permission('get')) &&
        can(permission('save')) &&
        !state.hasOpenVersion &&
        state.hasLatestApproved &&
        state.enabled,
      versions: can(permission('versions')),
      audit: can(permission('audit-history')),
    }
  }

  function actionBlockedReason(
    item: Readonly<TItem>,
    action: 'approve' | 'reject',
  ): string | null {
    const state = actionState(item)
    return state.status === 'PENDING' &&
      state.submittedBy === userId() &&
      can(permission(action))
      ? '提交人不能审核自己提交的版本，请由其他审核人处理。'
      : null
  }

  function hasAnyAction(item: Readonly<TItem>): boolean {
    return Object.values(actionAvailability(item)).some(Boolean)
  }

  return { permission, actionAvailability, actionBlockedReason, hasAnyAction }
}

export function useDclDeclarationLifecycle<TItem>(
  actionLoading: Ref<string | null>,
  errorMessage: Ref<string | null>,
  objectId: (item: Readonly<TItem>) => string,
  enabled: (item: Readonly<TItem>) => boolean,
  actionAvailability: (
    item: Readonly<TItem>,
  ) => DclDeclarationActionAvailability,
  port: DclDeclarationLifecyclePort<TItem>,
  query: () => Promise<void>,
  onSuccess: (item: TItem, action: DclDeclarationLifecycleAction) => void,
) {
  async function review(
    item: TItem,
    action: 'approve' | 'reject',
    comment: string,
    handleError?: (error: unknown) => boolean,
  ): Promise<boolean> {
    if (!actionAvailability(item)[action] || actionLoading.value) return false
    const reason = action === 'reject' ? comment.trim() : ''
    if (action === 'reject' && !reason) {
      errorMessage.value = '驳回意见不能为空。'
      return false
    }
    if (Array.from(reason).length > 1000) {
      errorMessage.value = '审核意见不能超过 1000 个字符。'
      return false
    }
    actionLoading.value = `${action}:${objectId(item)}`
    errorMessage.value = null
    try {
      await port.run(item, action, reason)
      await query()
      onSuccess(item, action)
      return true
    } catch (error) {
      if (!handleError?.(error)) errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function reverse(
    item: TItem,
    action: 'unsubmit' | 'unapprove',
    reason: string,
  ): Promise<boolean> {
    if (!actionAvailability(item)[action] || actionLoading.value) return false
    const normalizedReason = reason.trim()
    if (!normalizedReason) {
      errorMessage.value = '反向操作原因不能为空。'
      return false
    }
    if (Array.from(normalizedReason).length > 1000) {
      errorMessage.value = '反向操作原因不能超过 1000 个字符。'
      return false
    }
    actionLoading.value = `${action}:${objectId(item)}`
    errorMessage.value = null
    try {
      await port.run(item, action, normalizedReason)
      await query()
      onSuccess(item, action)
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function changeEnabled(
    item: TItem,
    handleError?: (error: unknown) => boolean,
  ): Promise<boolean> {
    const action = enabled(item) ? 'disable' : 'enable'
    if (!actionAvailability(item)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${objectId(item)}`
    errorMessage.value = null
    try {
      await port.changeEnabled(item)
      await query()
      onSuccess(item, action)
      return true
    } catch (error) {
      if (!handleError?.(error)) errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  return { review, reverse, changeEnabled }
}

export function useDclDeclarationHistory<TItem, TVersion, TAudit>(
  errorMessage: Ref<string | null>,
  canOpenVersions: (item: Readonly<TItem>) => boolean,
  canOpenAudit: (item: Readonly<TItem>) => boolean,
  port: DclDeclarationHistoryPort<TItem, TVersion, TAudit>,
) {
  const versionsOpen = ref(false)
  const versionsLoading = ref(false)
  const versions = ref<TVersion[]>([])
  const versionsPage = ref(1)
  const versionsPageSize = ref(20)
  const versionsTotal = ref(0)
  const historyObject = ref<TItem | null>(null)
  const auditOpen = ref(false)
  const auditLoading = ref(false)
  const auditEvents = ref<TAudit[]>([])
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)

  async function loadVersions(): Promise<void> {
    const item = historyObject.value
    if (!item) return
    versionsLoading.value = true
    try {
      await port.loadVersions(
        item,
        versionsPage.value,
        versionsPageSize.value,
        (items, total, page, pageSize) => {
          versions.value = items
          versionsTotal.value = total
          versionsPage.value = page
          versionsPageSize.value = pageSize
        },
      )
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      versionsLoading.value = false
    }
  }

  async function openVersions(item: TItem): Promise<void> {
    if (!canOpenVersions(item)) return
    historyObject.value = item
    versions.value = []
    versionsPage.value = 1
    versionsOpen.value = true
    await loadVersions()
  }

  async function changeVersionsPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === versionsPage.value) return
    versionsPage.value = nextPage
    await loadVersions()
  }

  async function loadAudit(): Promise<void> {
    const item = historyObject.value
    if (!item) return
    auditLoading.value = true
    try {
      await port.loadAudit(
        item,
        auditPage.value,
        auditPageSize.value,
        (items, total, page, pageSize) => {
          auditEvents.value = items
          auditTotal.value = total
          auditPage.value = page
          auditPageSize.value = pageSize
        },
      )
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      auditLoading.value = false
    }
  }

  async function openAudit(item: TItem): Promise<void> {
    if (!canOpenAudit(item)) return
    historyObject.value = item
    auditEvents.value = []
    auditPage.value = 1
    auditOpen.value = true
    await loadAudit()
  }

  async function changeAuditPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === auditPage.value) return
    auditPage.value = nextPage
    await loadAudit()
  }

  return {
    versionsOpen,
    versionsLoading,
    versions,
    versionsPage,
    versionsPageSize,
    versionsTotal,
    historyObject,
    auditOpen,
    auditLoading,
    auditEvents,
    auditPage,
    auditPageSize,
    auditTotal,
    openVersions,
    changeVersionsPage,
    openAudit,
    changeAuditPage,
  }
}
