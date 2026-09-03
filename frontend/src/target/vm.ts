import { computed, onMounted, ref } from 'vue'
import {
  approvalActionPresentation,
  projectWarehouseViewState,
  runTargetModelCorpus,
  type WarehouseSubmitFacts,
} from '@zerp/model'

import {
  deleteTargetWarehouseSubmission,
  queryTargetUsers,
  queryTargetWarehouses,
  restoreTargetSession,
  reviewTargetWarehouse,
  signInTarget,
  submitTargetWarehouse,
  targetWarehouseManagerReference,
  targetWarehouseVersions,
  TargetApiError,
  type TargetWarehouseAction,
} from './api.ts'
import {
  createWarehouseDraft,
  WarehouseDraftRepository,
  type WarehouseDraft,
} from './warehouse-drafts.ts'

type TargetSession = Awaited<ReturnType<typeof restoreTargetSession>>
type WarehouseItem = Awaited<
  ReturnType<typeof queryTargetWarehouses>
>['items'][number]

export function useTargetProbe() {
  const username = ref('')
  const password = ref('')
  const csrfToken = ref('')
  const currentUser = ref<TargetSession['user'] | null>(null)
  const permissions = ref<string[]>([])
  const message = ref('正在恢复会话…')
  const requestId = ref('')
  const users = ref<Awaited<ReturnType<typeof queryTargetUsers>>['items']>([])
  const warehouses = ref<WarehouseItem[]>([])
  const drafts = ref<WarehouseDraft[]>([])
  const reason = ref('')
  const signedIn = computed(() => csrfToken.value.length > 0)
  const draftsRepository = new WarehouseDraftRepository()
  const modelCorpusResult = JSON.stringify(runTargetModelCorpus())

  async function applySession(session: TargetSession) {
    csrfToken.value = session.csrfToken
    currentUser.value = session.user
    permissions.value = session.permissions
    message.value = `当前用户：${session.user.displayName}`
    await Promise.all([loadDrafts(), loadWarehouses()])
  }

  async function restoreSession() {
    try {
      await applySession(await restoreTargetSession())
    } catch (error) {
      message.value = targetErrorMessage(error, '请登录。', '请登录。')
      requestId.value = targetErrorRequestId(error)
    }
  }

  async function signIn() {
    try {
      await applySession(await signInTarget(username.value, password.value))
    } catch (error) {
      message.value = targetErrorMessage(
        error,
        '登录失败。',
        '用户名或密码错误。',
      )
      requestId.value = targetErrorRequestId(error)
    }
  }

  async function queryUsers() {
    try {
      const page = await queryTargetUsers(csrfToken.value)
      users.value = page.items
      message.value = `已查询 ${page.items.length} 位用户。`
    } catch (error) {
      setError(error, '查询失败。')
    }
  }

  async function loadDrafts() {
    if (!currentUser.value) return
    drafts.value = await draftsRepository.list(currentUser.value.id)
  }

  async function loadWarehouses() {
    if (!signedIn.value) return
    try {
      const page = await queryTargetWarehouses(csrfToken.value)
      warehouses.value = page.items
    } catch (error) {
      setError(error, '仓库查询失败。')
    }
  }

  async function newDraft() {
    if (!currentUser.value) return
    const draft = createWarehouseDraft(currentUser.value.id)
    await draftsRepository.save(draft)
    await loadDrafts()
    message.value = '已创建仅保存在当前设备的仓库草稿。'
  }

  async function saveDraft(draft: WarehouseDraft) {
    draft.updatedAt = new Date().toISOString()
    await draftsRepository.save(draft)
    message.value = '草稿已保存在当前设备。'
  }

  async function deleteDraft(draft: WarehouseDraft) {
    await draftsRepository.delete(draft.ownerUserId, draft.draftId)
    await loadDrafts()
    message.value = '本地草稿已删除，未发送服务器请求。'
  }

  async function submissionFacts(
    draft: WarehouseDraft,
  ): Promise<WarehouseSubmitFacts> {
    const managerEmployeeId = draft.snapshot.managerEmployeeId.trim()
    const manager = managerEmployeeId
      ? await targetWarehouseManagerReference(
          csrfToken.value,
          managerEmployeeId,
          draft.mode === 'NEW' ? 'submit-new' : 'submit-change',
        )
      : null
    if (draft.mode === 'NEW')
      return {
        subject: { exists: false, history: [] },
        ...(manager ? { manager } : {}),
      }
    const page = await targetWarehouseVersions(csrfToken.value, draft.subjectId)
    return {
      subject: {
        exists: true,
        history: page.items.map((item) => ({
          entryId: item.submissionId,
          versionNo: item.versionNo,
          status: item.status,
          revision: item.revision,
        })),
      },
      ...(manager ? { manager } : {}),
    }
  }

  async function submitDraft(draft: WarehouseDraft) {
    try {
      const facts = await submissionFacts(draft)
      const command = {
        action:
          draft.mode === 'NEW'
            ? ('submit-new' as const)
            : ('submit-change' as const),
        actor: {
          id: currentUser.value?.id ?? '',
          permissions: permissions.value,
        },
        requestId: draft.idempotencyKey,
        occurredAt: new Date().toISOString(),
        submissionId: draft.submissionId,
        idempotencyKey: draft.idempotencyKey,
        subjectId: draft.subjectId,
        expectedLatestApprovedSubmissionId:
          draft.expectedLatestApprovedSubmissionId,
        expectedLatestApprovedRevision: draft.expectedLatestApprovedRevision,
        data: {
          name: draft.snapshot.name,
          address: draft.snapshot.address,
          contactName: draft.snapshot.contactName,
          contactPhone: draft.snapshot.contactPhone,
          ...([
            draft.snapshot.managerEmployeeId,
            draft.snapshot.managerEmployeeApprovalEntryId,
            draft.snapshot.managerEmployeeCode,
            draft.snapshot.managerEmployeeName,
          ].some((value) => value.trim())
            ? {
                manager: {
                  employeeId: draft.snapshot.managerEmployeeId,
                  approvalEntryId:
                    draft.snapshot.managerEmployeeApprovalEntryId,
                  code: draft.snapshot.managerEmployeeCode,
                  displayName: draft.snapshot.managerEmployeeName,
                },
              }
            : {}),
          remark: draft.snapshot.remark,
          enabled: draft.snapshot.enabled,
        },
      }
      const advisory = projectWarehouseViewState(command, facts)
      if (!advisory.canSubmit) {
        message.value = `草稿不能提交：${advisory.errorKey}`
        return
      }
      const result = await submitTargetWarehouse(csrfToken.value, draft.mode, {
        subjectId: draft.subjectId,
        submissionId: draft.submissionId,
        idempotencyKey: draft.idempotencyKey,
        expectedLatestApprovedSubmissionId:
          draft.expectedLatestApprovedSubmissionId,
        expectedLatestApprovedRevision: draft.expectedLatestApprovedRevision,
        snapshot: {
          name: draft.snapshot.name.trim(),
          address: nullable(draft.snapshot.address),
          contactName: nullable(draft.snapshot.contactName),
          contactPhone: nullable(draft.snapshot.contactPhone),
          managerEmployeeId: nullable(draft.snapshot.managerEmployeeId),
          managerEmployeeApprovalEntryId: nullable(
            draft.snapshot.managerEmployeeApprovalEntryId,
          ),
          managerEmployeeCode: nullable(draft.snapshot.managerEmployeeCode),
          managerEmployeeName: nullable(draft.snapshot.managerEmployeeName),
          remark: nullable(draft.snapshot.remark),
          enabled: draft.snapshot.enabled,
        },
      })
      await draftsRepository.delete(draft.ownerUserId, draft.draftId)
      await Promise.all([loadDrafts(), loadWarehouses()])
      message.value = `已提交 ${result.code} V${result.versionNo}，状态：待批准。`
    } catch (error) {
      setError(error, '仓库提交失败；本地草稿已保留。')
      await loadWarehouses()
    }
  }

  async function cloneSubmission(item: WarehouseItem) {
    if (!currentUser.value) return
    const page = await targetWarehouseVersions(csrfToken.value, item.subjectId)
    const approved = page.items
      .filter((candidate) => candidate.status === 'APPROVED')
      .sort((left, right) => right.versionNo - left.versionNo)[0]
    const draft = createWarehouseDraft(currentUser.value.id, {
      mode: approved ? 'CHANGE' : 'NEW',
      subjectId: item.subjectId,
      expectedLatestApprovedSubmissionId: approved?.submissionId ?? null,
      expectedLatestApprovedRevision: approved?.revision ?? null,
      snapshot: {
        name: item.snapshot.name,
        address: item.snapshot.address ?? '',
        contactName: item.snapshot.contactName ?? '',
        contactPhone: item.snapshot.contactPhone ?? '',
        managerEmployeeId: item.snapshot.managerEmployeeId ?? '',
        managerEmployeeApprovalEntryId:
          item.snapshot.managerEmployeeApprovalEntryId ?? '',
        managerEmployeeCode: item.snapshot.managerEmployeeCode ?? '',
        managerEmployeeName: item.snapshot.managerEmployeeName ?? '',
        remark: item.snapshot.remark ?? '',
        enabled: item.snapshot.enabled,
      },
    })
    await draftsRepository.save(draft)
    await loadDrafts()
    message.value = '已克隆为当前设备的本地草稿。'
  }

  async function review(item: WarehouseItem, action: TargetWarehouseAction) {
    try {
      const needsReason = action === 'reject' || action === 'unapprove'
      await reviewTargetWarehouse(csrfToken.value, action, {
        subjectId: item.subjectId,
        submissionId: item.submissionId,
        expectedRevision: item.revision,
        ...(needsReason ? { reason: reason.value } : {}),
      })
      reason.value = ''
      await loadWarehouses()
      message.value = `仓库提交件已${approvalActionPresentation[action].label}。`
    } catch (error) {
      setError(error, '审批动作失败。')
      await loadWarehouses()
    }
  }

  async function withdraw(item: WarehouseItem) {
    try {
      await deleteTargetWarehouseSubmission(csrfToken.value, {
        subjectId: item.subjectId,
        submissionId: item.submissionId,
        expectedRevision: item.revision,
      })
      await loadWarehouses()
      message.value = '开放 Submission 已删除。'
    } catch (error) {
      setError(error, '撤回失败。')
      await loadWarehouses()
    }
  }

  function setError(error: unknown, fallback: string) {
    message.value = targetErrorMessage(error, fallback, '请重新登录。')
    requestId.value = targetErrorRequestId(error)
  }

  onMounted(() => void restoreSession())
  return {
    username,
    password,
    message,
    requestId,
    users,
    warehouses,
    drafts,
    reason,
    signedIn,
    modelCorpusResult,
    signIn,
    queryUsers,
    newDraft,
    saveDraft,
    deleteDraft,
    submitDraft,
    cloneSubmission,
    review,
    withdraw,
  }
}

function nullable(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function targetErrorMessage(
  error: unknown,
  fallback: string,
  unauthenticated: string,
): string {
  if (!(error instanceof TargetApiError)) return fallback
  if (error.errorKey === 'unauthenticated') return unauthenticated
  if (error.errorKey === 'forbidden') return '无权执行此操作。'
  return error.message || fallback
}

function targetErrorRequestId(error: unknown): string {
  return error instanceof TargetApiError ? error.requestId : ''
}
