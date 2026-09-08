import { openingErrorCaptions } from '../../pages/vou/opening-errors.ts'
import { computed, ref, shallowRef, toRaw, watch } from 'vue'
import {
  approvalActions,
  approvalActionPresentation,
  type ApprovalAction,
} from '@zerp/model'
import * as api from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import type { VouFilters, VouPageDefinition } from './definition.ts'

export type VouRow =
  | Awaited<ReturnType<typeof api.queryTargetVouchers>>['items'][number]
  | Awaited<ReturnType<typeof api.queryTargetOpenings>>['items'][number]
export type VouDetail = Awaited<ReturnType<typeof api.getTargetVoucher>>
export type VouPageRegistration<Filters extends VouFilters> = VouPageDefinition<
  VouRow,
  Filters
> & {
  initialFilters: () => Filters
  search: (
    csrf: string,
    input: Filters & { page: number; pageSize: 20 },
  ) => Promise<{ items: VouRow[]; total: number; page: number; pageSize: 20 }>
}
const errorCaptions: Record<string, string> = {
  forbidden: '没有此操作权限。',
  validation_failed: '输入格式不正确。',
  vou_not_found: '单据不存在。',
  approval_invalid_actor: '提交人与审批人必须分离。',
  approval_invalid_action: '没有此审批权限。',
  approval_invalid_transition: '当前状态不允许此操作。',
  approval_stale_revision: '单据已变化，请重新打开。',
  approval_reason_required: '请填写操作原因。',
  approval_self_review_forbidden: '不能审批自己提交的单据。',
  approval_invalid_request: '审批请求不完整，请重新打开单据。',
  approval_invalid_preparation: '审批准备失败，请重新打开单据。',
  approval_reason_not_allowed: '此审批动作不接受原因。',
  approval_not_found: '提交记录不存在。',
  vou_reference_unavailable: '采用的业务引用不可用，请先处理相关资料。',
  vou_period_locked: '会计期间已锁定，不能执行此操作。',
  vou_credit_limit_exceeded: '超过客户信用限额。',
  acc_control_book_unavailable: '控制账簿不可用，请检查会计配置。',
  vou_document_entity_mismatch: '单据类型与请求不一致。',
  vou_attachment_not_found: '附件不存在。',
  vou_attachment_download_not_found: '附件下载链接已失效，请重新获取。',
  vou_source_line_unavailable: '来源单据行不可用。',
  vou_source_line_quantity_exceeded: '数量超过来源可用数量。',
  vou_settlement_insufficient: '结算余额不足。',
  ...openingErrorCaptions,
  vou_delete_blocked: '单据仍有业务引用，不能删除。',
}
const auditActions = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  unreject: 'UNREJECTED',
  unapprove: 'UNAPPROVED',
  delete: 'DELETED',
} as const
const clone = <T>(value: T): T => structuredClone(toRaw(value))
function message(cause: unknown): string {
  return cause instanceof api.TargetApiError
    ? (errorCaptions[cause.errorKey] ??
        '操作未完成，请检查单据状态与相关业务限制。')
    : cause instanceof Error
      ? cause.message
      : '操作失败。'
}

export function useVouListViewModel<Filters extends VouFilters>(
  definition: VouPageRegistration<Filters>,
) {
  const session = useTargetSession()
  const generation = session.generation
  const can = (action: string) =>
    session.can(`/vou/${definition.vouType}/${action}`)
  let active = true,
    queryVersion = 0,
    detailVersion = 0,
    initialized = false
  const current = () => active && session.generation === generation
  const filterInput = shallowRef<Filters>(clone(definition.initialFilters()))
  const appliedQuery = shallowRef<Filters & { page: number }>({
    ...definition.normalizeFilters(clone(filterInput.value)),
    page: 1,
  })
  const items = shallowRef<VouRow[]>([]),
    total = ref(0),
    page = ref(1)
  const loading = ref(false),
    queryError = ref<string | null>(null),
    feedback = ref<string | null>(null)
  const selected = shallowRef<VouDetail | null>(null),
    detailLoading = ref(false),
    detailError = ref<string | null>(null)
  const attachmentLinks = ref(new Map<string, string>()),
    attachmentPending = ref(new Set<string>())
  const pending = ref(new Set<string>()),
    unknown = ref(new Set<string>())
  const intents = new Map<
    string,
    {
      action: ApprovalAction | 'delete'
      submissionId: string
      revision: string
      actorId: string
      reason: string | null
    }
  >()
  const canVerify = computed(() =>
    Boolean(
      current() &&
      selected.value &&
      unknown.value.has(selected.value.documentId) &&
      can('get') &&
      can('audit-history') &&
      !pending.value.has(selected.value.documentId),
    ),
  )
  const requestedAction = ref<ApprovalAction | null>(null),
    reason = ref('')
  const needsReason = computed(
    () =>
      requestedAction.value === 'reject' ||
      requestedAction.value === 'unapprove',
  )
  const reviewActions = computed(() =>
    approvalActions
      .filter(
        (action) =>
          can(action) &&
          selected.value?.availableApprovalActions.includes(action),
      )
      .map((key) => ({
        key,
        caption: approvalActionPresentation[key].label,
        disabled: !canReview(key),
        loading: Boolean(
          selected.value && pending.value.has(selected.value.documentId),
        ),
      })),
  )
  function rowActions(row: VouRow) {
    return can('get')
      ? [
          {
            key: 'open',
            caption: '打开',
            disabled: pending.value.has(row.documentId),
          },
        ]
      : []
  }
  function requestReview(key: string) {
    const action = approvalActions.find((action) => action === key)
    if (action && canReview(action)) {
      requestedAction.value = action
      reason.value = ''
      feedback.value = null
    }
  }
  function cancelReview() {
    requestedAction.value = null
    reason.value = ''
  }
  async function confirmReview() {
    const action = requestedAction.value
    if (!action) return
    const result = await review(action, reason.value)
    if (result) cancelReview()
  }
  const searchable = computed(() => current() && can('query'))

  async function query(input: Filters & { page: number }): Promise<boolean> {
    if (!current() || !can('query') || !session.csrfToken) return false
    const request = ++queryVersion
    appliedQuery.value = clone(input)
    loading.value = true
    queryError.value = null
    try {
      const result = await definition.search(session.csrfToken, {
        ...clone(input),
        pageSize: 20,
      })
      if (!current() || request !== queryVersion) return false
      definition.validateRows(result.items)
      items.value = result.items
      total.value = result.total
      page.value = result.page
      return true
    } catch (cause) {
      if (current() && request === queryVersion)
        queryError.value = message(cause)
      return false
    } finally {
      if (current() && request === queryVersion) loading.value = false
    }
  }
  async function initialize() {
    if (initialized) return
    initialized = true
    await query(clone(appliedQuery.value))
  }
  async function submitSearch() {
    try {
      await query({
        ...definition.normalizeFilters(clone(filterInput.value)),
        page: 1,
      })
    } catch (cause) {
      if (current()) queryError.value = message(cause)
    }
  }
  async function goToPage(next: number) {
    if (Number.isSafeInteger(next) && next > 0)
      await query({ ...clone(appliedQuery.value), page: next })
  }
  const refresh = () => query(clone(appliedQuery.value))
  async function open(row: VouRow) {
    if (
      !current() ||
      !can('get') ||
      !session.csrfToken ||
      pending.value.has(row.documentId)
    )
      return
    const request = ++detailVersion
    selected.value = null
    attachmentLinks.value.clear()
    attachmentPending.value.clear()
    detailLoading.value = true
    detailError.value = null
    try {
      const detail = await api.getTargetVoucher(
        session.csrfToken,
        definition.vouType,
        row.documentId,
      )
      if (
        detail.entity !== definition.vouType ||
        detail.documentId !== row.documentId
      )
        throw new Error('详情与请求的单据不一致。')
      if (current() && request === detailVersion) selected.value = detail
    } catch (cause) {
      if (current() && request === detailVersion)
        detailError.value = message(cause)
    } finally {
      if (current() && request === detailVersion) detailLoading.value = false
    }
  }
  function close() {
    cancelReview()
    detailVersion++
    selected.value = null
    attachmentLinks.value.clear()
    attachmentPending.value.clear()
    detailLoading.value = false
    detailError.value = null
  }
  function canReview(action: ApprovalAction) {
    const detail = selected.value
    return Boolean(
      current() &&
      detail &&
      can(action) &&
      detail.availableApprovalActions.includes(action) &&
      !pending.value.has(detail.documentId) &&
      !unknown.value.has(detail.documentId),
    )
  }
  async function review(action: ApprovalAction, reason: string) {
    const detail = selected.value
    if (!detail || !canReview(action) || !session.csrfToken) return
    if ((action === 'reject' || action === 'unapprove') && !reason.trim()) {
      feedback.value = '请填写操作原因。'
      return
    }
    const request = detailVersion
    const actorId = session.user?.id ?? ''
    pending.value.add(detail.documentId)
    feedback.value = null
    try {
      const result = await api.reviewTargetVoucher(
        session.csrfToken,
        definition.vouType,
        action,
        {
          documentId: detail.documentId,
          submissionId: detail.submissionId,
          expectedRevision: detail.revision,
        },
        reason.trim(),
      )
      if (!current()) return
      if (request === detailVersion) selected.value = result
      queryVersion++
      const refreshed = can('query') ? await refresh() : true
      if (current())
        feedback.value = refreshed
          ? '操作成功。'
          : '操作已成功，但列表刷新失败。'
      return 'changed' as const
    } catch (cause) {
      if (!current()) return
      if (
        !(cause instanceof api.TargetApiError) ||
        cause.errorKey === 'internal_error'
      ) {
        unknown.value.add(detail.documentId)
        intents.set(detail.documentId, {
          action,
          submissionId: detail.submissionId,
          revision: detail.revision,
          actorId,
          reason:
            action === 'reject' || action === 'unapprove'
              ? reason.trim()
              : null,
        })
        feedback.value = '操作结果未知，请核实单据；不会自动重试。'
        return 'unknown' as const
      } else feedback.value = message(cause)
    } finally {
      if (current()) pending.value.delete(detail.documentId)
    }
  }
  const canDelete = computed(() =>
    Boolean(
      current() &&
      selected.value &&
      can('delete') &&
      selected.value.status !== 'APPROVED' &&
      selected.value.submittedBy === session.user?.id &&
      !pending.value.has(selected.value.documentId) &&
      !unknown.value.has(selected.value.documentId),
    ),
  )
  async function deleteSelected() {
    const detail = selected.value
    if (!detail || !canDelete.value || !session.csrfToken) return
    pending.value.add(detail.documentId)
    feedback.value = null
    try {
      await api.deleteTargetVoucher(session.csrfToken, definition.vouType, {
        documentId: detail.documentId,
        submissionId: detail.submissionId,
        expectedRevision: detail.revision,
      })
      if (!current()) return
      close()
      const refreshed = can('query') ? await refresh() : true
      if (current())
        feedback.value = refreshed
          ? '已删除开放提交。'
          : '已删除开放提交，但列表刷新失败。'
      return 'changed' as const
    } catch (cause) {
      if (!current()) return
      if (
        !(cause instanceof api.TargetApiError) ||
        cause.errorKey === 'internal_error'
      ) {
        unknown.value.add(detail.documentId)
        intents.set(detail.documentId, {
          action: 'delete',
          submissionId: detail.submissionId,
          revision: detail.revision,
          actorId: session.user?.id ?? '',
          reason: null,
        })
        feedback.value = '删除结果未知，请核实原提交；不会自动重试。'
      } else feedback.value = message(cause)
    } finally {
      if (current()) pending.value.delete(detail.documentId)
    }
  }
  async function readAttachment(fileId: string) {
    const detail = selected.value
    if (
      !current() ||
      !detail ||
      detail.entity === 'opening' ||
      !can('attachment-read') ||
      !session.csrfToken ||
      attachmentPending.value.has(fileId) ||
      !detail.payload.attachments.some((file) => file.id === fileId)
    )
      return
    const request = detailVersion
    attachmentPending.value.add(fileId)
    try {
      const result = await api.readTargetVoucherAttachment(
        session.csrfToken,
        detail.entity,
        {
          documentId: detail.documentId,
          submissionId: detail.submissionId,
          fileId,
        },
      )
      if (current() && request === detailVersion)
        attachmentLinks.value.set(fileId, result.downloadUrl)
    } catch (cause) {
      if (current() && request === detailVersion)
        detailError.value = message(cause)
    } finally {
      if (current() && request === detailVersion)
        attachmentPending.value.delete(fileId)
    }
  }
  async function verifyOutcome() {
    const previous = selected.value
    if (!previous || !canVerify.value || !session.csrfToken) return
    const intent = intents.get(previous.documentId)
    if (!intent) return
    const request = detailVersion
    pending.value.add(previous.documentId)
    try {
      // Read current first, then the atomic audit, so a changed revision cannot
      // be mistaken for a failed write just because the audit read was earlier.
      const detail = await api
        .getTargetVoucher(
          session.csrfToken,
          definition.vouType,
          previous.documentId,
        )
        .catch((cause) => {
          if (
            intent.action === 'delete' &&
            cause instanceof api.TargetApiError &&
            ['approval_not_found', 'vou_not_found'].includes(cause.errorKey)
          )
            return null
          throw cause
        })
      const audit = await api.queryTargetVoucherAudit(
        session.csrfToken,
        definition.vouType,
        previous.documentId,
      )
      if (!current() || request !== detailVersion) return
      const committed = audit.some(
        (event) =>
          event.submissionId === intent.submissionId &&
          event.fromRevision === intent.revision &&
          event.actorId === intent.actorId &&
          event.reason === intent.reason &&
          event.action === auditActions[intent.action],
      )
      if (committed && intent.action === 'delete') {
        unknown.value.delete(previous.documentId)
        intents.delete(previous.documentId)
        close()
        const refreshed = can('query') ? await refresh() : true
        if (current())
          feedback.value = refreshed
            ? '已核实开放提交已删除。'
            : '已核实删除成功，但列表刷新失败。'
      } else if (committed) {
        const latest = await api.getTargetVoucher(
          session.csrfToken,
          definition.vouType,
          previous.documentId,
        )
        if (!current() || request !== detailVersion) return
        selected.value = latest
        unknown.value.delete(previous.documentId)
        intents.delete(previous.documentId)
        const refreshed = can('query') ? await refresh() : true
        if (current())
          feedback.value = refreshed
            ? '已核实操作成功。'
            : '已核实操作成功，但列表刷新失败。'
      } else if (
        detail &&
        (detail.submissionId !== intent.submissionId ||
          detail.revision !== intent.revision)
      ) {
        selected.value = detail
        unknown.value.delete(previous.documentId)
        intents.delete(previous.documentId)
        feedback.value = '已核实原修订已变化，此次操作未写入。'
      } else feedback.value = '尚无法确定操作结果，继续保持锁定。'
    } catch (cause) {
      if (current()) feedback.value = message(cause)
    } finally {
      if (current()) pending.value.delete(previous.documentId)
    }
  }
  function dispose() {
    active = false
    queryVersion++
    close()
    items.value = []
    loading.value = false
    pending.value.clear()
    unknown.value.clear()
    intents.clear()
    feedback.value = null
  }
  const stop = watch(
    () => session.generation,
    () => dispose(),
    { flush: 'sync' },
  )
  return {
    canDelete,
    deleteSelected,
    requestedAction,
    reason,
    needsReason,
    reviewActions,
    rowActions,
    requestReview,
    cancelReview,
    confirmReview,
    filterInput,
    appliedQuery,
    items,
    total,
    page,
    pageSize: 20 as const,
    loading,
    queryError,
    feedback,
    selected,
    detailLoading,
    detailError,
    pending,
    unknown,
    attachmentLinks,
    attachmentPending,
    readAttachment,
    searchable,
    can,
    canReview,
    canVerify,
    verifyOutcome,
    initialize,
    submitSearch,
    goToPage,
    refresh,
    open,
    close,
    review,
    dispose: () => {
      stop()
      dispose()
    },
    dismissFeedback: () => {
      feedback.value = null
    },
  }
}
