import { computed, onMounted, ref } from 'vue'
import {
  approvalActionPresentation,
  projectWarehouseViewState,
  runTargetModelCorpus,
  type ApprovalStatus,
  type WarehouseSubmitFacts,
  type VouEntity,
  userCreatableVouEntities,
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
  queryTargetArchive,
  deleteTargetArchive,
  reviewTargetArchive,
  stageTargetCustomerAttachment,
  submitTargetArchive,
  queryTargetAuxReference,
  queryTargetBobReference,
  queryTargetAccMappingCatalog,
  queryTargetAccMappingCurrent,
  getTargetAccMappingCurrent,
  getTargetArchive,
  targetArchiveAuditHistory,
  targetArchiveVersions,
  targetArchiveEntities,
  type TargetArchiveCommonEntity,
  type TargetArchiveEntity,
  type TargetArchiveQueryRequest,
  type TargetArchiveDeleteRequest,
  type TargetArchiveReviewRequest,
  type TargetWarehouseAction,
  stageTargetVouAttachment,
  submitTargetVou,
  queryTargetVou,
} from './api.ts'
import {
  archiveSubmitRequest,
  cloneArchiveDraft,
  createArchiveDraft,
  type AnyArchiveDraft,
} from './archive-drafts.ts'
import {
  archiveEditorFields,
  archiveEntityPresentation,
  archiveWirePresentation,
  archiveReadOnlySummary,
  canCloneArchive,
  canSubmitArchive,
  type ArchiveField,
} from './archive-presentation.ts'
import {
  latestApproved,
  isLatestSubmission,
  parseArchiveSubmissionPage,
  parseArchiveQueryPage,
  parseArchiveSubmission,
  type ArchiveSubmissionListView,
  type ArchiveSubmissionView,
} from './archive-view.ts'
import {
  TargetDraftRepository,
  type LocalDraftAttachment,
} from './draft-storage.ts'
import {
  createTargetId,
  createWarehouseDraft,
  WarehouseDraftRepository,
  type WarehouseDraft,
} from './warehouse-drafts.ts'
import { VouDraftRepository, type VouDraft } from './vou-drafts.ts'

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
  const archiveEntity = ref<TargetArchiveEntity>(archiveEntityFromLocation())
  const vouEntity = ref<VouEntity | null>(vouEntityFromLocation())
  const vouDrafts = ref<VouDraft[]>([])
  const vouSubmissions = ref<unknown[]>([])
  const archiveDrafts = ref<AnyArchiveDraft[]>([])
  const archiveSubmissions = ref<ArchiveSubmissionListView[]>([])
  const archiveQueryKeyword = ref('')
  const archiveQueryStatus = ref<'' | ApprovalStatus>('')
  const archiveQueryEnabled = ref<'' | 'ENABLED' | 'DISABLED'>('')
  const archiveQueryProductTypeId = ref('')
  const archiveQueryProductCategoryId = ref('')
  const archiveQueryBookId = ref('')
  const archiveQueryVouEntity = ref('')
  const archiveQueryPage = ref(1)
  const archiveQueryTotal = ref(0)
  const archiveQueryLoaded = ref(false)
  const archiveReason = ref('')
  const archiveHistory = ref<{
    detail: ArchiveSubmissionView
    versions: ArchiveSubmissionView[]
    audit: Array<{
      id: string
      versionNo: number
      action: string
      reason: string | null
      createdAt: string
    }>
  } | null>(null)
  const archiveReferenceOptions = ref<
    Record<string, Record<string, unknown>[]>
  >({})
  const accMappingReadPage = ref(window.location.pathname === '/acc/mapping')
  const accMappingCatalog = ref<Awaited<
    ReturnType<typeof queryTargetAccMappingCatalog>
  > | null>(null)
  const accMappingPage = ref<Awaited<
    ReturnType<typeof queryTargetAccMappingCurrent>
  > | null>(null)
  const accMappingCurrent = ref<Awaited<
    ReturnType<typeof getTargetAccMappingCurrent>
  > | null>(null)
  const accBookId = ref('')
  const accVouEntity = ref('')
  const canQueryAccMapping = computed(() =>
    permissions.value.includes('/acc/mapping/query'),
  )
  const canGetAccMapping = computed(() =>
    permissions.value.includes('/acc/mapping/get'),
  )
  const archiveApproved = computed(() =>
    latestApproved(archiveSubmissions.value),
  )
  const archiveOpenSubmissions = computed(() =>
    archiveSubmissions.value.filter(
      (submission) =>
        submission.status === 'PENDING' || submission.status === 'REJECTED',
    ),
  )
  const reason = ref('')
  const signedIn = computed(() => csrfToken.value.length > 0)
  const canCreateArchiveDraft = computed(() =>
    hasArchiveSubmitPermission(archiveEntity.value, 'NEW'),
  )
  const canQueryArchive = computed(() =>
    permissions.value.includes(`/dcl/${archiveEntity.value}/query`),
  )
  const draftsRepository = new WarehouseDraftRepository()
  const archiveDraftRepository = new TargetDraftRepository()
  const vouDraftRepository = new VouDraftRepository(archiveDraftRepository)
  const modelCorpusResult = JSON.stringify(runTargetModelCorpus())

  async function applySession(session: TargetSession) {
    csrfToken.value = session.csrfToken
    currentUser.value = session.user
    permissions.value = session.permissions
    message.value = `当前用户：${session.user.displayName}`
    if (accMappingReadPage.value) {
      await loadAccMappingCatalog()
      return
    }
    if (vouEntity.value) {
      await Promise.all([loadVouDrafts(), loadVouSubmissions()])
      return
    }
    await Promise.all([
      loadDrafts(),
      loadWarehouses(),
      loadArchiveDrafts(),
      loadArchiveReferenceOptions(),
    ])
    await loadArchiveDeepLink()
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

  async function loadVouDrafts() {
    if (!currentUser.value || !vouEntity.value) return
    vouDrafts.value = await vouDraftRepository.list(currentUser.value.id, vouEntity.value)
  }

  async function loadVouSubmissions() {
    if (!vouEntity.value || !permissions.value.includes(`/vou/${vouEntity.value}/query`)) return
    try {
      const result = await queryTargetVou(csrfToken.value, vouEntity.value)
      vouSubmissions.value = Array.isArray(result) ? result : []
    } catch (error) { setError(error, '单据查询失败。') }
  }

  async function newVouDraft() {
    if (!currentUser.value || !vouEntity.value || !userCreatableVouEntities.includes(vouEntity.value as never)) return
    const draft: VouDraft = {
      entity: vouEntity.value, draftId: createTargetId(), ownerUserId: currentUser.value.id,
      updatedAt: new Date().toISOString(), documentId: createTargetId(), submissionId: createTargetId(), stableRevision: null,
      payload: { businessDate: new Date().toISOString().slice(0, 10), currency: 'CNY', amount: '0.00', lines: [] },
    }
    await vouDraftRepository.save(draft)
    await loadVouDrafts()
  }

  async function saveVouDraft(draft: VouDraft) {
    draft.updatedAt = new Date().toISOString()
    await vouDraftRepository.save(draft)
    message.value = '本地单据草稿已保存。'
  }

  async function addVouAttachment(draft: VouDraft, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { message.value = '附件仅支持 PDF、JPEG 或 PNG。'; return }
    await vouDraftRepository.saveAttachment(draft, {
      attachmentId: createTargetId(), fileName: file.name, mimeType: file.type,
      size: file.size, digest: await sha256(file), blob: file,
    })
    message.value = '附件已保存在本机草稿。'
  }

  async function submitVouDraft(draft: VouDraft) {
    try {
      const attachments = await vouDraftRepository.attachments(draft)
      for (const attachment of attachments)
        await stageTargetVouAttachment(csrfToken.value, draft.entity, {
          stagingId: attachment.attachmentId, fileId: attachment.attachmentId,
          fileName: attachment.fileName, mimeType: attachment.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png',
          size: attachment.size, digest: attachment.digest, contentBase64: await blobBase64(attachment.blob),
        })
      await submitTargetVou(csrfToken.value, draft.entity, draft.stableRevision ? 'CHANGE' : 'NEW', {
        documentId: draft.documentId, submissionId: draft.submissionId, idempotencyKey: draft.submissionId,
        expectedRevision: draft.stableRevision,
        payload: { ...draft.payload, attachments: attachments.map((attachment) => ({
          id: attachment.attachmentId, fileName: attachment.fileName,
          contentType: attachment.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png', sizeBytes: attachment.size,
          sha256: attachment.digest, stagingId: attachment.attachmentId,
        })) },
      })
      await vouDraftRepository.delete(draft)
      await Promise.all([loadVouDrafts(), loadVouSubmissions()])
      message.value = '单据已提交；本地草稿已删除。'
    } catch (error) { setError(error, '单据提交失败；本地草稿和附件仍保留。') }
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

  async function loadArchiveDrafts() {
    if (!currentUser.value) return
    archiveDrafts.value = await archiveDraftRepository.list(
      currentUser.value.id,
      archiveEntity.value,
    )
  }

  function currentArchiveQuery(page: number): TargetArchiveQueryRequest {
    const filters = {
      ...(archiveQueryKeyword.value.trim() && {
        keyword: archiveQueryKeyword.value.trim(),
      }),
      ...(archiveQueryStatus.value && { status: archiveQueryStatus.value }),
      ...(archiveQueryEnabled.value && {
        enabled: archiveQueryEnabled.value === 'ENABLED',
      }),
    }
    if (archiveEntity.value === 'product')
      return {
        entity: 'product',
        input: {
          page,
          pageSize: 20,
          filters: {
            ...filters,
            ...(archiveQueryProductTypeId.value && {
              productTypeId: archiveQueryProductTypeId.value,
            }),
            ...(archiveQueryProductCategoryId.value && {
              productCategoryId: archiveQueryProductCategoryId.value,
            }),
          },
        },
      }
    if (archiveEntity.value === 'acc-mapping')
      return {
        entity: 'acc-mapping',
        input: {
          page,
          pageSize: 20,
          filters: {
            ...filters,
            ...(archiveQueryBookId.value && {
              bookId: archiveQueryBookId.value,
            }),
            ...(archiveQueryVouEntity.value && {
              vouEntity: archiveQueryVouEntity.value,
            }),
          },
        },
      }
    return {
      entity: archiveEntity.value as TargetArchiveCommonEntity,
      input: { page, pageSize: 20, filters },
    }
  }

  async function queryArchive(page = 1, announce = true) {
    if (!signedIn.value || !canQueryArchive.value) {
      message.value = '无权查询该业务档案。'
      return
    }
    try {
      const result = parseArchiveQueryPage(
        archiveEntity.value,
        await queryTargetArchive(csrfToken.value, currentArchiveQuery(page)),
      )
      archiveSubmissions.value = result.submissions
      archiveQueryTotal.value = result.total
      archiveQueryPage.value = page
      archiveQueryLoaded.value = true
      if (announce) message.value = `已查询 ${result.total} 个业务档案。`
    } catch (error) {
      archiveSubmissions.value = []
      setError(error, '业务档案查询失败。')
    }
  }

  async function loadArchiveDeepLink() {
    const deepLink = archiveDeepLinkFromLocation()
    if (!deepLink || archiveEntity.value !== 'rpt-definition') return
    archiveQueryKeyword.value = deepLink.code
    await queryArchive(1, false)
    const subject = archiveSubmissions.value.find(
      (submission) => submission.code === deepLink.code,
    )
    if (!subject) {
      message.value = '深链指定的报表定义不存在。'
      return
    }
    await loadArchiveHistory(
      'rpt-definition',
      subject.subjectId,
      deepLink.approvalEntryId,
    )
  }

  function resetArchiveQuery() {
    archiveQueryKeyword.value = ''
    archiveQueryStatus.value = ''
    archiveQueryEnabled.value = ''
    archiveQueryProductTypeId.value = ''
    archiveQueryProductCategoryId.value = ''
    archiveQueryBookId.value = ''
    archiveQueryVouEntity.value = ''
    archiveQueryPage.value = 1
    archiveQueryTotal.value = 0
    archiveQueryLoaded.value = false
    archiveSubmissions.value = []
  }

  async function loadArchiveReferenceOptions() {
    const options: Record<string, Record<string, unknown>[]> = {}
    const aux = [
      ['vehicleType', 'dictionary-item'],
      ['productType', 'product-type'],
      ['productCategory', 'product-category'],
      ['measurementUnit', 'measurement-unit'],
      ['employeeCategory', 'employee-category'],
      ['department', 'department'],
      ['position', 'position'],
      ['settlementMethod', 'settlement-method'],
    ] as const
    if (permissions.value.includes('/aux/reference/query'))
      await Promise.all(
        aux
          .filter(([, entity]) =>
            permissions.value.includes(`/aux/${entity}/query`),
          )
          .map(async ([key, entity]) => {
            options[key] = await queryTargetAuxReference(
              csrfToken.value,
              entity,
            )
          }),
      )
    if (permissions.value.includes('/bob/reference/query'))
      await Promise.all(
        (
          [
            ['operatingEntity', 'operating-entity'],
            ['employee', 'employee'],
            ['otherUnit', 'other-unit'],
            ['salesPartner', 'sales-partner'],
          ] as const
        ).map(async ([key, entity]) => {
          options[key] = await queryTargetBobReference(csrfToken.value, entity)
        }),
      )
    if (permissions.value.includes('/acc/mapping/catalog')) {
      const catalog = await queryTargetAccMappingCatalog(csrfToken.value)
      options.accBook = catalog.books
      options.accVouEntity = catalog.vouEntities
      options.accSubject = catalog.subjects
    }
    archiveReferenceOptions.value = options
  }

  async function loadAccMappingCatalog() {
    if (!permissions.value.includes('/acc/mapping/catalog')) return
    accMappingCatalog.value = await queryTargetAccMappingCatalog(
      csrfToken.value,
    )
  }

  async function queryAccMappingCurrent() {
    if (!accBookId.value || !permissions.value.includes('/acc/mapping/query'))
      return
    accMappingCurrent.value = null
    accMappingPage.value = await queryTargetAccMappingCurrent(csrfToken.value, {
      bookId: accBookId.value,
      vouEntity: accVouEntity.value || undefined,
      page: 1,
      pageSize: 100,
    })
    if (accVouEntity.value && accMappingPage.value.items.length)
      await selectAccMappingCurrent(accVouEntity.value)
  }

  async function selectAccMappingCurrent(vouEntity: string) {
    if (!accBookId.value || !permissions.value.includes('/acc/mapping/get'))
      return
    accMappingCurrent.value = await getTargetAccMappingCurrent(
      csrfToken.value,
      { bookId: accBookId.value, vouEntity },
    )
  }

  async function selectArchiveEntity(entity: TargetArchiveEntity) {
    archiveEntity.value = entity
    archiveHistory.value = null
    resetArchiveQuery()
    if (window.location.pathname !== `/dcl/${entity}`)
      window.history.pushState({}, '', `/dcl/${entity}`)
    await loadArchiveDrafts()
  }

  async function newArchiveDraft() {
    if (!currentUser.value || !canCreateArchiveDraft.value) {
      message.value = '无权新建该业务档案草稿。'
      return
    }
    const draft = createArchiveDraft(currentUser.value.id, archiveEntity.value)
    await archiveDraftRepository.save(draft)
    await loadArchiveDrafts()
    message.value = '已创建仅保存在当前设备的本地草稿。'
  }

  async function saveArchiveDraft(draft: AnyArchiveDraft) {
    draft.updatedAt = new Date().toISOString()
    await archiveDraftRepository.save(draft)
    message.value = '草稿已保存在当前设备。'
  }

  function hasArchiveSubmitPermission(
    entity: TargetArchiveEntity,
    mode: AnyArchiveDraft['mode'],
  ) {
    return canSubmitArchive(permissions.value, entity, mode)
  }

  function canSubmitArchiveDraft(draft: AnyArchiveDraft) {
    return (
      hasArchiveSubmitPermission(draft.entity, draft.mode) &&
      archiveDraftReady(draft)
    )
  }

  function canViewArchiveHistory(entity: TargetArchiveEntity) {
    return ['get', 'versions', 'audit-history'].every((action) =>
      permissions.value.includes(`/dcl/${entity}/${action}`),
    )
  }

  async function loadArchiveHistory(
    entity: TargetArchiveEntity,
    subjectId: string,
    approvalEntryId?: string,
  ) {
    if (!canViewArchiveHistory(entity)) return
    try {
      const [detail, versions, audit] = await Promise.all([
        getTargetArchive(csrfToken.value, entity, subjectId, approvalEntryId),
        targetArchiveVersions(csrfToken.value, entity, subjectId),
        targetArchiveAuditHistory(csrfToken.value, entity, subjectId),
      ])
      archiveHistory.value = {
        detail: requiredArchiveSubmission(entity, detail),
        versions: parseArchiveSubmissionPage(entity, versions),
        audit: parseArchiveAuditHistory(audit),
      }
    } catch (error) {
      setError(error, '查询档案详情与历史失败。')
    }
  }

  async function viewArchiveHistory(submission: ArchiveSubmissionListView) {
    await loadArchiveHistory(
      submission.entity,
      submission.subjectId,
      submission.entity === 'rpt-definition'
        ? submission.submissionId
        : undefined,
    )
  }

  function archiveFields(entity: TargetArchiveEntity) {
    return archiveEditorFields(entity)
  }

  function archiveFieldValue(draft: AnyArchiveDraft, key: string) {
    return (draft.snapshot as Record<string, unknown>)[key]
  }

  function archiveIdentityKindOptions(entity: TargetArchiveEntity) {
    const values =
      entity === 'customer'
        ? (['MAINLAND_ENTERPRISE', 'MAINLAND_INDIVIDUAL', 'OTHER'] as const)
        : (['PERSON', 'ORGANIZATION'] as const)
    return values.map((value) => ({
      value,
      label: archiveWirePresentation.identity[value],
    }))
  }

  function archiveFieldOptions(
    field: ArchiveField,
    entity: TargetArchiveEntity,
  ) {
    if (field.kind === 'mapping-result')
      return Object.entries(archiveWirePresentation.mappingResult).map(
        ([value, label]) => ({ value, label }),
      )
    return archiveIdentityKindOptions(entity)
  }

  async function updateArchiveField(
    draft: AnyArchiveDraft,
    field: ArchiveField,
    value: string | number | boolean,
  ) {
    const snapshot = draft.snapshot as Record<string, unknown>
    snapshot[field.key] = value
    await saveArchiveDraft(draft)
  }

  async function deleteArchiveDraft(draft: AnyArchiveDraft) {
    await archiveDraftRepository.delete(
      draft.ownerUserId,
      draft.entity,
      draft.draftId,
    )
    await loadArchiveDrafts()
    message.value = '本地草稿已删除，未发送服务器请求。'
  }

  async function cloneArchiveSubmission(submission: ArchiveSubmissionListView) {
    if (!currentUser.value || !canCloneArchiveSubmission(submission)) {
      message.value = '无权创建该业务档案的提交草稿。'
      return
    }
    try {
      const detail = requiredArchiveSubmission(
        submission.entity,
        await getTargetArchive(
          csrfToken.value,
          submission.entity,
          submission.subjectId,
          submission.entity === 'rpt-definition'
            ? submission.submissionId
            : undefined,
        ),
      )
      if (detail.submissionId !== submission.submissionId)
        throw new Error('archive_submission_is_not_latest')
      const approved = approvedArchiveSubmission(submission)
      const draft = cloneArchiveDraft(
        currentUser.value.id,
        submission.entity,
        submission.subjectId,
        detail.snapshot,
        approved,
      )
      await archiveDraftRepository.save(draft)
      await loadArchiveDrafts()
      message.value = '已克隆为当前设备的本地草稿。'
    } catch (error) {
      setError(error, '读取档案详情并克隆失败。')
    }
  }

  function approvedArchiveSubmission(submission: ArchiveSubmissionListView) {
    return latestApproved(
      archiveSubmissions.value.filter(
        (candidate) => candidate.subjectId === submission.subjectId,
      ),
    )
  }

  function canCloneArchiveSubmission(submission: ArchiveSubmissionListView) {
    return (
      isLatestSubmission(submission, archiveSubmissions.value) &&
      canCloneArchive(
        permissions.value,
        submission.entity,
        approvedArchiveSubmission(submission) ? 'CHANGE' : 'NEW',
      )
    )
  }

  async function submitArchiveDraft(draft: AnyArchiveDraft) {
    if (!canSubmitArchiveDraft(draft)) {
      message.value = '无权提交该业务档案草稿。'
      return
    }
    try {
      if (draft.entity === 'customer') await stageCustomerAttachments(draft)
      await submitTargetArchive(csrfToken.value, archiveSubmitRequest(draft))
      await archiveDraftRepository.delete(
        draft.ownerUserId,
        draft.entity,
        draft.draftId,
      )
      await Promise.all([
        loadArchiveDrafts(),
        queryArchive(archiveQueryPage.value, false),
      ])
      message.value = '已提交，状态以服务器返回为准。'
    } catch (error) {
      setError(error, '提交失败；本地草稿已保留。')
    }
  }

  async function reviewArchive(
    submission: ArchiveSubmissionListView,
    action: TargetArchiveReviewRequest['action'],
  ) {
    const needsReason = action === 'reject' || action === 'unapprove'
    const submittedReason = archiveReason.value.trim()
    if (needsReason && !submittedReason) {
      message.value = '请填写审批原因。'
      return
    }
    try {
      const input = {
        subjectId: submission.subjectId,
        submissionId: submission.submissionId,
        expectedRevision: submission.revision,
      }
      await reviewTargetArchive(
        csrfToken.value,
        action === 'reject' || action === 'unapprove'
          ? {
              entity: submission.entity,
              action,
              input: { ...input, reason: submittedReason },
            }
          : { entity: submission.entity, action, input },
      )
      if (archiveReason.value === submittedReason) archiveReason.value = ''
      await queryArchive(archiveQueryPage.value, false)
      message.value = `提交件已${approvalActionPresentation[action].label}。`
    } catch (error) {
      setError(error, '审批动作失败。')
      await queryArchive(archiveQueryPage.value, false)
    }
  }

  async function withdrawArchive(submission: ArchiveSubmissionListView) {
    try {
      await deleteTargetArchive(csrfToken.value, {
        entity: submission.entity,
        input: {
          subjectId: submission.subjectId,
          submissionId: submission.submissionId,
          expectedRevision: submission.revision,
        },
      } as TargetArchiveDeleteRequest)
      await queryArchive(archiveQueryPage.value, false)
      message.value = '开放 Submission 已删除。'
    } catch (error) {
      setError(error, '撤回失败。')
      await queryArchive(archiveQueryPage.value, false)
    }
  }

  async function stageCustomerAttachments(draft: AnyArchiveDraft) {
    const attachments = await archiveDraftRepository.listAttachments(draft)
    for (const attachment of attachments) {
      const snapshot = draft.snapshot as {
        identityAttachments?: unknown[]
        subunits?: { id: string; attachments: unknown[] }[]
      }
      const attachmentList = attachment.subunitId
        ? snapshot.subunits?.find(
            (subunit) => subunit.id === attachment.subunitId,
          )?.attachments
        : snapshot.identityAttachments
      if (!attachmentList) throw new Error('customer_attachment_target_missing')
      const existing = attachmentList.find(
        (value) =>
          !!value &&
          typeof value === 'object' &&
          (value as { id?: unknown }).id === attachment.attachmentId,
      ) as { stagingId?: unknown } | undefined
      const stagingId =
        typeof existing?.stagingId === 'string'
          ? existing.stagingId
          : createTargetId()
      await stageTargetCustomerAttachment(csrfToken.value, {
        stagingId,
        fileId: attachment.attachmentId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType as
          'application/pdf' | 'image/jpeg' | 'image/png',
        size: attachment.size,
        digest: attachment.digest,
        contentBase64: await blobBase64(attachment.blob),
      })
      const staged = [
        ...attachmentList.filter(
          (value) =>
            !value ||
            typeof value !== 'object' ||
            (value as { id?: unknown }).id !== attachment.attachmentId,
        ),
        {
          id: attachment.attachmentId,
          fileName: attachment.fileName,
          contentType: attachment.mimeType,
          sizeBytes: attachment.size,
          sha256: attachment.digest,
          stagingId,
        },
      ]
      if (attachment.subunitId) {
        const subunit = snapshot.subunits!.find(
          (candidate) => candidate.id === attachment.subunitId,
        )!
        subunit.attachments = staged
      } else snapshot.identityAttachments = staged
      await archiveDraftRepository.save(draft)
    }
  }

  async function addCustomerAttachment(
    draft: AnyArchiveDraft,
    file: File,
    subunitId?: string,
  ) {
    if (draft.entity !== 'customer') return
    const attachment: LocalDraftAttachment = {
      attachmentId: createTargetId(),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      digest: await sha256(file),
      blob: file,
      ...(subunitId && { subunitId }),
    }
    await archiveDraftRepository.saveAttachment(draft, attachment)
    message.value = subunitId
      ? '客户子单位附件已保存在本地草稿，将在提交前暂存。'
      : '客户附件已保存在本地草稿，将在提交前暂存。'
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
    archiveEntity,
    archiveDrafts,
    archiveSubmissions,
    archiveQueryKeyword,
    archiveQueryStatus,
    archiveQueryEnabled,
    archiveQueryProductTypeId,
    archiveQueryProductCategoryId,
    archiveQueryBookId,
    archiveQueryVouEntity,
    archiveQueryPage,
    archiveQueryTotal,
    archiveQueryLoaded,
    archiveReason,
    archiveHistory,
    archiveApproved,
    archiveOpenSubmissions,
    archiveReferenceOptions,
    accMappingReadPage,
    vouEntity,
    vouDrafts,
    vouSubmissions,
    userCreatableVouEntities,
    newVouDraft,
    saveVouDraft,
    addVouAttachment,
    submitVouDraft,
    accMappingCatalog,
    accMappingPage,
    accMappingCurrent,
    accBookId,
    accVouEntity,
    canQueryAccMapping,
    canGetAccMapping,
    queryAccMappingCurrent,
    selectAccMappingCurrent,
    targetArchiveEntities,
    archiveEntityPresentation,
    canCreateArchiveDraft,
    canQueryArchive,
    queryArchive,
    canSubmitArchiveDraft,
    canViewArchiveHistory,
    viewArchiveHistory,
    archiveReadOnlySummary,
    archiveAuditActionLabel,
    archiveFields,
    archiveFieldValue,
    archiveFieldOptions,
    selectArchiveEntity,
    newArchiveDraft,
    saveArchiveDraft,
    deleteArchiveDraft,
    cloneArchiveSubmission,
    canCloneArchiveSubmission,
    submitArchiveDraft,
    addCustomerAttachment,
    updateArchiveField,
    reviewArchive,
    withdrawArchive,
  }
}

export function archiveDraftReady(draft: AnyArchiveDraft): boolean {
  const data = draft.snapshot as Record<string, unknown>
  const aux = (value: unknown) =>
    !!value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    !!(value as { id: string }).id
  const exact = (value: unknown) =>
    !!value &&
    typeof value === 'object' &&
    typeof (value as { objectId?: unknown }).objectId === 'string' &&
    !!(value as { objectId: string }).objectId &&
    typeof (value as { approvalEntryId?: unknown }).approvalEntryId ===
      'string' &&
    !!(value as { approvalEntryId: string }).approvalEntryId
  if (draft.entity === 'vehicle') {
    const carrier = data.carrier as {
      kind?: string
      operatingEntityId?: string
      otherUnitId?: string
      approvalEntryId?: string
    }
    return (
      aux(data.vehicleType) &&
      !!carrier.approvalEntryId &&
      !!(carrier.kind === 'INTERNAL'
        ? carrier.operatingEntityId
        : carrier.otherUnitId)
    )
  }
  if (draft.entity === 'fund-account') return exact(data.operatingEntity)
  if (draft.entity === 'product')
    return (
      aux(data.productType) &&
      aux(data.productCategory) &&
      aux(data.pricingUnit) &&
      aux(data.defaultInputUnit)
    )
  if (draft.entity === 'employee')
    return (
      aux(data.employeeCategory) &&
      aux(data.department) &&
      aux(data.position) &&
      exact(data.operatingEntity)
    )
  if (draft.entity === 'acc-mapping')
    return aux(data.book) && aux(data.vouEntity)
  return true
}

function parseArchiveAuditHistory(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.versionNo !== 'number' ||
      typeof record.action !== 'string' ||
      typeof record.createdAt !== 'string'
    )
      return []
    return [
      {
        id: record.id,
        versionNo: record.versionNo,
        action: record.action,
        reason: typeof record.reason === 'string' ? record.reason : null,
        createdAt: record.createdAt,
      },
    ]
  })
}

function archiveAuditActionLabel(action: string) {
  return (
    (
      {
        SUBMITTED: '已提交',
        APPROVED: '已批准',
        REJECTED: '已驳回',
        UNREJECTED: '已恢复审核',
        UNAPPROVED: '已反批准',
        DELETED: '已删除',
      } as Record<string, string>
    )[action] ?? '未识别审计动作'
  )
}

function nullable(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function archiveEntityFromLocation(): TargetArchiveEntity {
  const match = window.location.pathname.match(/^\/dcl\/([^/]+)\/?$/)
  const entity = match?.[1]
  return targetArchiveEntities.includes(entity as TargetArchiveEntity)
    ? (entity as TargetArchiveEntity)
    : 'operating-entity'
}

function vouEntityFromLocation(): VouEntity | null {
  const entity = window.location.pathname.match(/^\/vou\/([^/]+)\/?$/)?.[1]
  return entity && userCreatableVouEntities.includes(entity as never) ? entity as VouEntity : null
}

function archiveDeepLinkFromLocation(): {
  code: string
  approvalEntryId: string
} | null {
  if (archiveEntityFromLocation() !== 'rpt-definition') return null
  const parameters = new URLSearchParams(window.location.search)
  const code = parameters.get('code')?.trim() ?? ''
  const approvalEntryId = parameters.get('approvalEntryId')?.trim() ?? ''
  return code && approvalEntryId ? { code, approvalEntryId } : null
}

function requiredArchiveSubmission(
  entity: TargetArchiveEntity,
  value: unknown,
): ArchiveSubmissionView {
  const submission = parseArchiveSubmission(entity, value)
  if (!submission) throw new Error('archive_submission_response_invalid')
  return submission
}

function targetErrorMessage(
  error: unknown,
  fallback: string,
  unauthenticated: string,
): string {
  if (!(error instanceof TargetApiError)) return fallback
  if (error.errorKey === 'unauthenticated') return unauthenticated
  if (error.errorKey === 'forbidden') return '无权执行此操作。'
  return `${error.errorKey}: ${error.message || fallback}`
}

function targetErrorRequestId(error: unknown): string {
  return error instanceof TargetApiError ? error.requestId : ''
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
