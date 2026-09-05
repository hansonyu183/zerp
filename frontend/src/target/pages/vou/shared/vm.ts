import { onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  createVouDraftPayload,
  type ApprovalAction,
  type ApprovalStatus,
  type VouEntity,
  type VouPayloadFor,
  type VouReferenceCandidateEntity,
  type VouSourceLineTargetEntity,
  vouSourceLineTargetEntities,
} from '@zerp/model'

import {
  deleteTargetVou,
  getTargetVou,
  queryTargetVou,
  queryTargetVouReference,
  queryTargetVouSourceLine,
  readTargetVouAttachment,
  reviewTargetVou,
  stageTargetVouAttachment,
  submitTargetVou,
  type TargetVouAttachmentReadResult,
  type TargetVouPageFor,
  type TargetVouQueryInput,
  type TargetVouReferenceResult,
  type TargetVouSourceLineResult,
  type TargetVouViewFor,
} from '../../../api.ts'
import {
  type LocalDraftAttachment,
  TargetDraftRepository,
} from '../../../draft-storage.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { createTargetId } from '../../../warehouse-drafts.ts'
import { vouPageConfigs } from './config.ts'

export type VouQueryInput = TargetVouQueryInput
export type VouQuerySortField = NonNullable<
  NonNullable<TargetVouQueryInput['sort']>[number]
>['field']
export type VouView<Entity extends VouEntity = VouEntity> =
  TargetVouViewFor<Entity>
export type VouPage<Entity extends VouEntity = VouEntity> =
  TargetVouPageFor<Entity>
export type VouReferenceOption = TargetVouReferenceResult['items'][number]
export type VouSourceLineCandidate = TargetVouSourceLineResult['items'][number]

export type VouDraftFor<Entity extends VouEntity> = {
  entity: Entity
  draftId: string
  ownerUserId: string
  updatedAt: string
  localRevision?: number
  documentId: string
  submissionId: string
  stableRevision: string | null
  payload: VouPayloadFor<Entity>
}

export type AnyVouDraft = {
  [Entity in VouEntity]: VouDraftFor<Entity>
}[VouEntity]

export interface VouWorkspaceContext {
  ownerUserId: string
  csrfToken: string
  permissions: readonly string[]
}

export interface VouWorkspacePorts {
  drafts: {
    list<Entity extends VouEntity>(
      ownerUserId: string,
      entity: Entity,
    ): Promise<VouDraftFor<Entity>[]>
    save<Entity extends VouEntity>(draft: VouDraftFor<Entity>): Promise<void>
    delete<Entity extends VouEntity>(draft: VouDraftFor<Entity>): Promise<void>
    listAttachments<Entity extends VouEntity>(
      draft: VouDraftFor<Entity>,
    ): Promise<LocalDraftAttachment[]>
    saveAndAddAttachment<Entity extends VouEntity>(
      draft: VouDraftFor<Entity>,
      attachment: LocalDraftAttachment,
    ): Promise<void>
    saveAndDeleteAttachments<Entity extends VouEntity>(
      draft: VouDraftFor<Entity>,
      attachmentIds: readonly string[],
    ): Promise<void>
  }
  api: {
    query: typeof queryTargetVou
    get: typeof getTargetVou
    submit: typeof submitTargetVou
    review: typeof reviewTargetVou
    deleteDocument: typeof deleteTargetVou
    stageAttachment: typeof stageTargetVouAttachment
    readAttachment: typeof readTargetVouAttachment
    reference: typeof queryTargetVouReference
    sourceLine: typeof queryTargetVouSourceLine
  }
  id(): string
  now(): string
}

export function createVouWorkspaceViewModel<Entity extends VouEntity>(
  entity: Entity,
  context: VouWorkspaceContext,
  ports: VouWorkspacePorts,
) {
  const config = vouPageConfigs[entity]
  const filters = reactive({
    keyword: '',
    status: [] as ApprovalStatus[],
    dateFrom: '',
    dateTo: '',
    counterpartyObjectId: '',
  })
  const sort = ref<{ field: VouQuerySortField; order: 'asc' | 'desc' }>({
    field: 'documentNo',
    order: 'desc',
  })
  const rows = shallowRef<VouView<Entity>[]>([])
  const drafts = shallowRef<VouDraftFor<Entity>[]>([])
  const detail = shallowRef<VouView<Entity> | null>(null)
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const draftSaving = ref(false)
  const error = ref('')
  const message = ref('')
  const reason = ref('')
  const referenceOptions = shallowRef<
    Partial<Record<VouReferenceCandidateEntity, VouReferenceOption[]>>
  >({})
  const sourceLineOptions = shallowRef<VouSourceLineCandidate[]>([])
  let queryVersion = 0
  const draftSaveQueues = new Map<string, Promise<void>>()
  let pendingDraftSaveCount = 0

  function persistDraft<DraftEntity extends VouEntity>(
    draft: VouDraftFor<DraftEntity>,
  ): Promise<void> {
    return queueDraftWrite(draft.draftId, () => ports.drafts.save(draft))
  }

  function queueDraftWrite(
    draftId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = draftSaveQueues.get(draftId) ?? Promise.resolve()
    pendingDraftSaveCount += 1
    draftSaving.value = true
    const queued = previous.catch(() => undefined).then(operation)
    draftSaveQueues.set(draftId, queued)
    void queued
      .finally(() => {
        pendingDraftSaveCount -= 1
        draftSaving.value = pendingDraftSaveCount > 0
        if (draftSaveQueues.get(draftId) === queued)
          draftSaveQueues.delete(draftId)
      })
      .catch(() => undefined)
    return queued
  }
  let detailVersion = 0
  let deepLinkVersion = 0

  const canCreate =
    config.creatable && permission(context, entity, 'submit-new')
  const canClone =
    config.creatable &&
    permission(context, entity, 'get') &&
    permission(context, entity, 'submit-change')
  const canReadAttachment = permission(context, entity, 'attachment-read')

  function queryInput(nextPage: number): VouQueryInput {
    return {
      page: nextPage,
      pageSize: 20,
      filters: {
        ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
        ...(filters.status.length ? { status: [...filters.status] } : {}),
        ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
        ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
        ...(filters.counterpartyObjectId.trim()
          ? { counterpartyObjectId: filters.counterpartyObjectId.trim() }
          : {}),
      },
      sort: [{ ...sort.value }],
    }
  }

  async function query(nextPage = page.value): Promise<void> {
    if (!permission(context, entity, 'query')) {
      rows.value = []
      total.value = 0
      error.value = '当前账号没有查询此类单据的权限。'
      return
    }
    const version = ++queryVersion
    loading.value = true
    try {
      const result = await ports.api.query(
        context.csrfToken,
        entity,
        queryInput(nextPage),
      )
      if (version !== queryVersion) return
      rows.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = ''
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, `${config.title}查询失败。`)
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function loadDrafts(): Promise<void> {
    drafts.value = await ports.drafts.list(context.ownerUserId, entity)
  }

  async function newDraft(): Promise<void> {
    if (!config.creatable) {
      error.value = `${config.title}由系统生成，不能人工创建。`
      return
    }
    if (!canCreate) {
      error.value = '当前账号没有创建此类单据的权限。'
      return
    }
    const draftId = ports.id()
    const documentId = ports.id()
    const submissionId = ports.id()
    const payload = createVouDraftPayload(entity, ports.id)
    payload.businessDate = ports.now().slice(0, 10)
    payload.currency = 'CNY'
    const draft: VouDraftFor<Entity> = {
      entity,
      draftId,
      ownerUserId: context.ownerUserId,
      documentId,
      submissionId,
      stableRevision: null,
      payload,
      updatedAt: ports.now(),
    }
    await persistDraft(draft)
    drafts.value = [draft, ...drafts.value]
    error.value = ''
    message.value = '已创建仅保存在当前浏览器的本地草稿。'
  }

  async function saveDraft(draft: VouDraftFor<Entity>): Promise<void> {
    draft.updatedAt = ports.now()
    drafts.value = drafts.value.map((candidate) =>
      candidate.draftId === draft.draftId ? draft : candidate,
    )
    await persistDraft(draft)
  }

  async function saveFamilyDraft<DraftEntity extends VouEntity>(
    draft: VouDraftFor<DraftEntity>,
  ): Promise<void> {
    if (String(draft.entity) !== entity) {
      error.value = '本地草稿类型与当前页面不一致。'
      return
    }
    draft.updatedAt = ports.now()
    drafts.value = drafts.value.map((candidate) =>
      candidate.draftId === draft.draftId
        ? (draft as unknown as VouDraftFor<Entity>)
        : candidate,
    )
    await persistDraft(draft)
  }

  async function deleteDraft(draft: VouDraftFor<Entity>): Promise<void> {
    await draftSaveQueues.get(draft.draftId)
    await ports.drafts.delete(draft)
    drafts.value = drafts.value.filter(
      (candidate) => candidate.draftId !== draft.draftId,
    )
  }

  async function addLocalAttachment(
    draft: VouDraftFor<Entity>,
    attachment: LocalDraftAttachment,
  ): Promise<void> {
    if (
      draft.payload.attachments.some(
        (item) => item.id === attachment.attachmentId,
      )
    )
      throw new Error('本地附件标识重复。')
    await queueDraftWrite(draft.draftId, async () => {
      const replacement = {
        ...draft,
        payload: {
          ...draft.payload,
          attachments: [
            ...draft.payload.attachments,
            {
              id: attachment.attachmentId,
              fileName: attachment.fileName,
              contentType: vouAttachmentMime(attachment.mimeType),
              sizeBytes: attachment.size,
              sha256: attachment.digest,
              // A staging ID is issued only immediately before submit. Local Drafts
              // deliberately retain bytes in IndexedDB, never a server staging lease.
              stagingId: '',
            },
          ],
        } as VouPayloadFor<Entity>,
        updatedAt: ports.now(),
      } as VouDraftFor<Entity>
      await ports.drafts.saveAndAddAttachment(replacement, attachment)
      draft.payload = replacement.payload
      draft.updatedAt = replacement.updatedAt
      draft.localRevision = replacement.localRevision
      drafts.value = drafts.value.map((candidate) =>
        candidate.draftId === draft.draftId ? draft : candidate,
      )
    })
  }

  async function addFile(
    draft: VouDraftFor<Entity>,
    file: File,
  ): Promise<void> {
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      error.value = '附件只支持 PDF、JPEG 或 PNG。'
      return
    }
    if (file.size <= 0 || file.size > 10_485_760) {
      error.value = '附件大小必须在 10MB 以内。'
      return
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer(),
    )
    await addLocalAttachment(draft, {
      attachmentId: ports.id(),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      digest: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
      blob: file,
    })
    error.value = ''
  }

  async function deleteLocalAttachment(
    draft: VouDraftFor<Entity>,
    attachmentId: string,
  ): Promise<void> {
    await queueDraftWrite(draft.draftId, async () => {
      const index = draft.payload.attachments.findIndex(
        (attachment) => attachment.id === attachmentId,
      )
      if (index < 0) return
      const replacement = {
        ...draft,
        payload: {
          ...draft.payload,
          attachments: draft.payload.attachments.filter(
            (attachment) => attachment.id !== attachmentId,
          ),
        },
      } as VouDraftFor<Entity>
      await ports.drafts.saveAndDeleteAttachments(replacement, [attachmentId])
      draft.payload = replacement.payload
      draft.updatedAt = replacement.updatedAt
      draft.localRevision = replacement.localRevision
      drafts.value = drafts.value.map((candidate) =>
        candidate.draftId === draft.draftId ? draft : candidate,
      )
    })
  }

  async function submitDraft(draft: VouDraftFor<Entity>): Promise<void> {
    const mode = draft.stableRevision === null ? 'NEW' : 'CHANGE'
    const action = mode === 'NEW' ? 'submit-new' : 'submit-change'
    if (!config.creatable || !permission(context, entity, action)) {
      error.value = !config.creatable
        ? `${config.title}由系统生成，不能人工提交。`
        : '当前账号没有提交此类单据的权限。'
      return
    }
    saving.value = true
    error.value = ''
    try {
      await saveDraft(draft)
      // Draft bodies are JSON; Vue editors may introduce nested reactive proxies.
      // Attachment bytes remain in their separate IndexedDB store.
      const payload: VouPayloadFor<Entity> = JSON.parse(
        JSON.stringify(draft.payload),
      )
      const attachments = await ports.drafts.listAttachments(draft)
      for (const attachment of attachments) {
        const stagingId = ports.id()
        await ports.api.stageAttachment(context.csrfToken, entity, {
          stagingId,
          fileId: attachment.attachmentId,
          fileName: attachment.fileName,
          mimeType: vouAttachmentMime(attachment.mimeType),
          size: attachment.size,
          digest: attachment.digest,
          contentBase64: await blobBase64(attachment.blob),
        })
        const metadata = payload.attachments.find(
          (item) => item.id === attachment.attachmentId,
        )
        if (!metadata) throw new Error('本地附件与草稿元数据不一致。')
        metadata.stagingId = stagingId
      }
      await ports.api.submit(context.csrfToken, entity, mode, {
        documentId: draft.documentId,
        submissionId: draft.submissionId,
        idempotencyKey: draft.submissionId,
        expectedRevision: draft.stableRevision,
        payload,
      })
      await ports.drafts.delete(draft)
      drafts.value = drafts.value.filter(
        (candidate) => candidate.draftId !== draft.draftId,
      )
      if (permission(context, entity, 'query')) await query(page.value)
      message.value = '本地草稿已提交，单据状态以服务器返回为准。'
    } catch (cause) {
      error.value = errorMessage(cause, '提交失败；本地草稿已保留。')
    } finally {
      saving.value = false
    }
  }

  async function openDetail(documentId: string): Promise<void> {
    if (!permission(context, entity, 'get')) {
      error.value = '当前账号没有查看此类单据详情的权限。'
      return
    }
    const version = ++detailVersion
    detail.value = null
    loading.value = true
    try {
      const result = await ports.api.get(context.csrfToken, entity, documentId)
      if (version !== detailVersion) return
      detail.value = result
      error.value = ''
    } catch (cause) {
      if (version === detailVersion)
        error.value = errorMessage(cause, `${config.title}详情读取失败。`)
    } finally {
      if (version === detailVersion) loading.value = false
    }
  }

  function closeDetail(): void {
    detailVersion += 1
    detail.value = null
    loading.value = false
  }

  async function cloneDetail(): Promise<void> {
    const view = detail.value
    if (!view || !config.creatable) return
    if (!canClone) {
      error.value = '当前账号没有变更此类单据的权限。'
      return
    }
    if (view.status !== 'APPROVED') {
      error.value = '只有服务器当前批准版本可以创建变更草稿。'
      return
    }
    const draft: VouDraftFor<Entity> = {
      entity,
      draftId: ports.id(),
      ownerUserId: context.ownerUserId,
      documentId: view.documentId,
      submissionId: ports.id(),
      stableRevision: view.stableRevision,
      // Server attachments are immutable blobs tied to the prior Submission.
      // A change Draft owns only fresh IndexedDB bytes that it stages itself.
      payload: { ...structuredClone(view.payload), attachments: [] },
      updatedAt: ports.now(),
    }
    await ports.drafts.save(draft)
    drafts.value = [draft, ...drafts.value]
    message.value = '已从服务器详情创建本地变更草稿；附件需重新添加。'
  }

  async function synchronizeDeepLink(deepLink: {
    objectId?: string
    documentId?: string
    submissionId?: string
    revision?: string
    mode?: string
  }): Promise<void> {
    const version = ++deepLinkVersion
    const objectId = deepLink.objectId?.trim()
    const documentId = deepLink.documentId?.trim()
    if (objectId && documentId && objectId !== documentId) {
      closeDetail()
      error.value = '深链对象标识不一致。'
      return
    }
    const targetDocumentId = documentId ?? objectId
    if (deepLink.mode && deepLink.mode !== 'edit') {
      closeDetail()
      error.value = '深链模式无效。'
      return
    }
    if (!targetDocumentId) {
      closeDetail()
      return
    }
    await openDetail(targetDocumentId)
    const view = detail.value
    if (
      version !== deepLinkVersion ||
      !view ||
      view.documentId !== targetDocumentId ||
      (deepLink.submissionId?.trim() &&
        view.submissionId !== deepLink.submissionId.trim()) ||
      (deepLink.revision?.trim() && view.revision !== deepLink.revision.trim())
    ) {
      if (version === deepLinkVersion && view) {
        closeDetail()
        error.value = '深链目标已变化，请从当前列表重新打开。'
      }
      return
    }
    if (deepLink.mode === 'edit') await cloneDetail()
  }

  async function review(
    view: VouView<Entity>,
    action: ApprovalAction,
  ): Promise<void> {
    if (!view.availableApprovalActions.includes(action)) {
      error.value = '服务器未提供该审批动作，请刷新单据后重试。'
      return
    }
    if (
      (action === 'reject' || action === 'unapprove') &&
      !reason.value.trim()
    ) {
      error.value = '请填写原因。'
      return
    }
    saving.value = true
    try {
      const input = {
        documentId: view.documentId,
        submissionId: view.submissionId,
        expectedRevision: view.revision,
      }
      const updated = await ports.api.review(
        context.csrfToken,
        entity,
        action === 'reject' || action === 'unapprove'
          ? { action, input: { ...input, reason: reason.value.trim() } }
          : { action, input },
      )
      if (detail.value?.submissionId === view.submissionId)
        detail.value = updated
      reason.value = ''
      error.value = ''
      message.value = '审批动作已完成，页面已采用服务器返回状态。'
      if (permission(context, entity, 'query')) await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '审批动作失败。')
      await refreshCurrent(view.documentId)
    } finally {
      saving.value = false
    }
  }

  async function withdraw(view: VouView<Entity>): Promise<void> {
    if (!view.canDelete || !permission(context, entity, 'delete')) {
      error.value = '服务器未允许撤回该单据。'
      return
    }
    await ports.api.deleteDocument(context.csrfToken, entity, {
      documentId: view.documentId,
      submissionId: view.submissionId,
      expectedRevision: view.revision,
    })
    detail.value = null
    await query(page.value)
  }

  async function readAttachment(
    view: VouView<Entity>,
    attachmentId: string,
  ): Promise<TargetVouAttachmentReadResult> {
    return ports.api.readAttachment(context.csrfToken, entity, {
      documentId: view.documentId,
      submissionId: view.submissionId,
      fileId: attachmentId,
    })
  }

  async function loadReference(
    referenceEntity: VouReferenceCandidateEntity,
    keyword = '',
  ): Promise<void> {
    const result = await ports.api.reference(context.csrfToken, {
      entity: referenceEntity,
      ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
    })
    referenceOptions.value = {
      ...referenceOptions.value,
      [referenceEntity]: result.items,
    }
  }

  async function refreshCurrent(documentId: string): Promise<void> {
    await Promise.all([
      openDetail(documentId),
      ...(permission(context, entity, 'query') ? [query(page.value)] : []),
    ])
  }

  async function loadSourceLines(
    keyword = '',
    sourceDocumentId = '',
  ): Promise<void> {
    if (!isSourceLineTargetEntity(entity)) {
      sourceLineOptions.value = []
      return
    }
    const result = await ports.api.sourceLine(context.csrfToken, {
      targetEntity: entity,
      page: 1,
      pageSize: 20,
      ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      ...(sourceDocumentId.trim()
        ? { sourceDocumentId: sourceDocumentId.trim() }
        : {}),
    })
    sourceLineOptions.value = result.items
  }

  return {
    config,
    filters,
    sort,
    rows,
    drafts,
    detail,
    total,
    page,
    loading,
    saving,
    draftSaving,
    error,
    message,
    reason,
    referenceOptions,
    sourceLineOptions,
    canCreate,
    canClone,
    canReadAttachment,
    query,
    loadDrafts,
    newDraft,
    saveDraft,
    saveFamilyDraft,
    deleteDraft,
    addLocalAttachment,
    addFile,
    deleteLocalAttachment,
    submitDraft,
    openDetail,
    closeDetail,
    cloneDetail,
    synchronizeDeepLink,
    review,
    withdraw,
    readAttachment,
    loadReference,
    loadSourceLines,
    createId: ports.id,
  }
}

export async function initializeVouWorkspace<Entity extends VouEntity>(
  model: ReturnType<typeof createVouWorkspaceViewModel<Entity>>,
): Promise<void> {
  await Promise.all([
    model.loadDrafts(),
    model.query(1),
    ...vouReferenceEntities[model.config.entity].map((entity) =>
      model.loadReference(entity),
    ),
    ...(isSourceLineTargetEntity(model.config.entity)
      ? [model.loadSourceLines()]
      : []),
  ])
}

export function useVouPageController<Entity extends VouEntity>(entity: Entity) {
  const session = useTargetSession()
  if (!session.user || !session.csrfToken)
    throw new Error('VOU page requires an authenticated session.')
  const route = useRoute()
  const repository = new TargetDraftRepository()
  const model = createVouWorkspaceViewModel(
    entity,
    {
      ownerUserId: session.user.id,
      csrfToken: session.csrfToken,
      permissions: session.permissions,
    },
    {
      drafts: {
        list: (ownerUserId, targetEntity) =>
          repository.list(ownerUserId, targetEntity),
        save: (draft) => repository.save(draft),
        delete: (draft) =>
          repository.delete(draft.ownerUserId, draft.entity, draft.draftId),
        listAttachments: (draft) => repository.listAttachments(draft),
        saveAndAddAttachment: (draft, attachment) =>
          repository.saveAndAddAttachment(draft, attachment),
        saveAndDeleteAttachments: (draft, attachmentIds) =>
          repository.saveAndDeleteAttachments(draft, attachmentIds),
      },
      api: {
        query: queryTargetVou,
        get: getTargetVou,
        submit: submitTargetVou,
        review: reviewTargetVou,
        deleteDocument: deleteTargetVou,
        stageAttachment: stageTargetVouAttachment,
        readAttachment: readTargetVouAttachment,
        reference: queryTargetVouReference,
        sourceLine: queryTargetVouSourceLine,
      },
      id: createTargetId,
      now: () => new Date().toISOString(),
    },
  )
  const deepLink = () => ({
    ...(typeof route.query.objectId === 'string'
      ? { objectId: route.query.objectId }
      : {}),
    ...(typeof route.query.documentId === 'string'
      ? { documentId: route.query.documentId }
      : {}),
    ...(typeof route.query.mode === 'string' ? { mode: route.query.mode } : {}),
    ...(typeof route.query.submissionId === 'string'
      ? { submissionId: route.query.submissionId }
      : {}),
    ...(typeof route.query.revision === 'string'
      ? { revision: route.query.revision }
      : {}),
  })
  let initialized = false
  onMounted(async () => {
    try {
      await initializeVouWorkspace(model)
      initialized = true
      await model.synchronizeDeepLink(deepLink())
    } catch (cause) {
      model.error.value = errorMessage(cause, '单据工作区初始化失败。')
    }
  })
  watch(
    () => [
      route.query.objectId,
      route.query.documentId,
      route.query.submissionId,
      route.query.revision,
      route.query.mode,
    ],
    async () => {
      if (!initialized) return
      try {
        await model.synchronizeDeepLink(deepLink())
      } catch (cause) {
        model.error.value = errorMessage(cause, '单据深链同步失败。')
      }
    },
  )
  return model
}

const vouReferenceEntities = {
  'sale-pricing': ['product'],
  'sale-order': [
    'customer-subunit',
    'operating-entity',
    'employee',
    'warehouse',
    'product',
    'measurement-unit',
  ],
  'sale-outbound': [],
  'sale-delivery': ['other-unit', 'vehicle'],
  'sale-signoff': ['customer-subunit'],
  'sale-return': ['warehouse'],
  'purchase-order': [
    'supplier',
    'employee',
    'warehouse',
    'product',
    'measurement-unit',
  ],
  'purchase-inbound': ['supplier', 'warehouse'],
  'purchase-return': ['supplier', 'warehouse'],
  'purchase-inquiry': ['supplier', 'product'],
  'order-production': ['warehouse', 'product', 'measurement-unit'],
  'self-production': ['warehouse', 'product', 'measurement-unit'],
  'inventory-count': ['warehouse', 'product', 'measurement-unit'],
  'sales-receipt': [
    'customer',
    'operating-entity',
    'fund-account',
    'employee',
    'customer-subunit',
  ],
  'purchase-refund': ['supplier', 'fund-account', 'employee'],
  'other-receipt': [
    'customer-subunit',
    'supplier',
    'other-unit',
    'employee',
    'sales-partner',
    'fund-account',
  ],
  'sales-refund': ['customer', 'fund-account', 'employee'],
  'purchase-payment': ['supplier', 'fund-account', 'employee'],
  'other-payment': [
    'customer-subunit',
    'supplier',
    'other-unit',
    'employee',
    'sales-partner',
    'fund-account',
  ],
  'employee-loan': ['employee', 'fund-account'],
  'employee-repayment': ['employee', 'fund-account'],
  'employee-loan-writeoff': ['employee'],
  'expense-reimbursement': ['employee'],
  'expense-payment': ['employee', 'fund-account'],
  'other-income': [
    'customer-subunit',
    'supplier',
    'other-unit',
    'employee',
    'sales-partner',
    'fund-account',
  ],
  'asset-acquisition': ['supplier', 'asset-category', 'department', 'employee'],
  'asset-sale': ['customer-subunit', 'other-unit', 'asset'],
  'asset-liquidation': ['asset'],
  'bill-receipt': ['customer', 'employee', 'bill', 'fund-account'],
  'bill-payment': ['supplier', 'employee', 'bill', 'fund-account'],
  'bill-issue': ['supplier', 'other-unit', 'fund-account'],
  'bill-discount': ['other-unit', 'bill', 'fund-account'],
  'bill-maturity': ['bill', 'fund-account'],
  'intermediary-calculation': [
    'customer-subunit',
    'employee',
    'sales-partner',
    'other-unit',
    'product',
  ],
  'service-contract': ['other-unit', 'sales-partner', 'employee'],
  'service-acceptance': ['employee', 'service-contract'],
} as const satisfies Record<VouEntity, readonly VouReferenceCandidateEntity[]>

function isSourceLineTargetEntity(
  entity: VouEntity,
): entity is VouSourceLineTargetEntity {
  return vouSourceLineTargetEntities.some((candidate) => candidate === entity)
}

function permission(
  context: VouWorkspaceContext,
  entity: VouEntity,
  action: string,
): boolean {
  return context.permissions.includes(`/vou/${entity}/${action}`)
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

function vouAttachmentMime(
  value: string,
): 'application/pdf' | 'image/jpeg' | 'image/png' {
  if (
    value !== 'application/pdf' &&
    value !== 'image/jpeg' &&
    value !== 'image/png'
  )
    throw new Error('本地附件类型无效。')
  return value
}
