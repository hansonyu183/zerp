import { computed, onMounted, reactive, ref } from 'vue'
import {
  approvalActionPresentation,
  projectWarehouseViewState,
  runTargetModelCorpus,
  createVouDraftPayload as createModelVouDraftPayload,
  vouEntityInputDescriptors,
  type ApprovalAction,
  type ApprovalStatus,
  type WarehouseSubmitFacts,
  type VouEntity,
  type VouPayload,
  type VouInputFieldDescriptor,
  type VouReferenceCandidateEntity,
  userCreatableVouEntities,
} from '@zerp/model'

import {
  deleteTargetWarehouseSubmission,
  deleteTargetWflDefinition,
  queryTargetUsers,
  queryTargetWorkbench,
  queryTargetWarehouses,
  getTargetWarehouse,
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
  type TargetWorkbenchQueryInput,
  stageTargetVouAttachment,
  submitTargetVou,
  queryTargetVou,
  getTargetVou,
  queryTargetVouReference,
  reviewTargetVou,
  deleteTargetVou,
  actionTargetWflInstance,
  createTargetAccBook,
  createTargetAccSubject,
  deleteTargetAccBook,
  deleteTargetAccOpening,
  deleteTargetAccSubject,
  getTargetWflCurrentDefinition,
  getTargetWflInstance,
  queryTargetAccBooks,
  queryTargetAccOpening,
  queryTargetAccPeriods,
  queryTargetAccSubjects,
  queryTargetWflCurrentDefinitions,
  queryTargetWflDefinitions,
  getTargetWflDefinition,
  queryTargetWflInstances,
  reviewTargetAccOpening,
  reviewTargetWflDefinition,
  saveTargetAccBook,
  saveTargetAccSubject,
  setTargetAccPeriod,
  setTargetWflDefinitionEnabled,
  submitTargetAccOpening,
  submitTargetWflDefinition,
  trialTargetWflDefinition,
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
import {
  TargetWorkflowDraftRepository,
  VouDraftRepository,
  type OpeningDraft,
  type VouDraft,
  type WflDefinitionDraft,
} from './vou-drafts.ts'

type TargetSession = Awaited<ReturnType<typeof restoreTargetSession>>
type WarehouseItem = Awaited<
  ReturnType<typeof queryTargetWarehouses>
>['items'][number]

interface VouSubmissionView {
  entity: VouEntity
  documentId: string
  submissionId: string
  documentNo: string
  status: ApprovalStatus
  revision: string
  payload: VouPayload
  availableApprovalActions: ApprovalAction[]
  canDelete: boolean
}

type WorkbenchReviewAction = Extract<ApprovalAction, 'reject' | 'approve' | 'unreject'>
type WorkbenchAction = 'view' | 'edit' | 'delete' | WorkbenchReviewAction
type WorkbenchTab = 'DOCUMENT' | 'ARCHIVE'

interface WorkbenchTabState {
  keyword: string
  entity: string
  status: Extract<ApprovalStatus, 'PENDING' | 'REJECTED'> | ''
  page: number
  items: WorkbenchItemView[]
  total: number
  queryError: string | null
  actionError: string | null
}

interface WorkbenchItemView {
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

function newWorkbenchTabState(): WorkbenchTabState {
  return {
    keyword: '',
    entity: '',
    status: '',
    page: 1,
    items: [],
    total: 0,
    queryError: null,
    actionError: null,
  }
}

interface AccBookView {
  id: string
  code: string
  name: string
  description: string
  startMonth: string
  baseCurrency: string
  controlBook: boolean
  revision: string
}

interface AccSubjectView {
  id: string
  bookId: string
  code: string
  name: string
  balanceDirection: 'DEBIT' | 'CREDIT'
  enabled: boolean
  parentId: string | null
  requiredDimensions: string[]
  inventoryQuantity: boolean
  settlementPurpose: string
  revision: string
}

interface AccOpeningView {
  bookId: string
  submissionId: string
  approval: { status: ApprovalStatus; revision: string }
  payload: OpeningDraft
  availableApprovalActions: ApprovalAction[]
}

interface AccPeriodView {
  bookId: string
  month: string
  locked: boolean
  revision: string
}

interface WflDefinitionView {
  subjectId: string
  submissionId: string
  code: string
  versionNo: number
  status: ApprovalStatus
  revision: string
  script: string
  compiledGraph: { code: string; name: string }
  availableApprovalActions: ApprovalAction[]
  enabled: boolean
  runtimeRevision: string | null
}

interface WflCurrentDefinitionView {
  subjectId: string
  approvalEntryId: string
  code: string
  name: string
  enabled: boolean
  compiledGraph: { code: string; name: string }
}

interface WflInstanceNodeView {
  nodeId: string
  nodeKey: string
  nodeName: string
  entity: VouEntity | null
  documentId: string | null
  submissionId: string | null
  status: ApprovalStatus | null
  revision: string | null
  availableActions: string[]
}

interface WflInstanceView {
  processId: string
  definitionCode: string
  definitionName: string
  nodes: WflInstanceNodeView[]
  availableTargets: Array<{
    parentNodeId: string
    targetNodeKey: string
    targetNodeName: string
  }>
}

interface VouInputEntry {
  field: VouInputFieldDescriptor
  path: string[]
  referenceEntity?: VouReferenceCandidateEntity
  allowedEntities?: readonly VouReferenceCandidateEntity[]
  referenceKind?: 'object' | 'versioned' | 'snapshot'
}

interface VouReferenceCandidate {
  entity: VouReferenceCandidateEntity
  objectId: string
  approvalEntryId?: string
  code: string
  name: string
}

const targetErrorPresentation: Readonly<Record<string, string>> = {
  approval_invalid_action: '当前状态不允许此操作。',
  approval_invalid_actor: '当前用户不能执行此操作。',
  approval_invalid_transition: '审批状态转换无效。',
  approval_not_latest_approved: '当前版本不是最新已批准版本。',
  approval_open_version_exists: '已有开放提交版本。',
  approval_reason_required: '请填写审批原因。',
  approval_not_found: '提交件不存在或已被删除。',
  approval_stale_revision: '提交件已被其他操作更新，请重新加载。',
  vou_attachment_digest_invalid: '附件内容校验失败，请重新选择文件。',
  vou_attachment_limit_exceeded: '附件数量超过上限。',
  vou_attachment_size_invalid: '附件大小不符合要求。',
  vou_attachment_staging_conflict: '附件暂存与当前草稿不一致，请重新上传。',
  vou_attachment_staging_invalid: '附件暂存无效，请重新上传。',
  vou_attachment_type_invalid: '附件类型不受支持。',
  vou_delete_blocked: '该单据存在下游业务，不能删除。',
  vou_attachment_not_found: '附件暂存记录不存在，请重新提交。',
  vou_document_entity_mismatch: '单据类型与已有单据不一致。',
  vou_idempotency_conflict: '本次提交标识已被用于不同内容，请新建草稿后重试。',
  vou_document_number_exhausted: '单据编号已用尽。',
  vou_invalid_payload: '请补全必填引用和明细后再提交。',
  vou_not_found: '单据不存在或已被删除。',
  vou_parent_invalid: '来源单据无效。',
  vou_period_locked: '业务期间已锁定。',
  vou_reference_unavailable: '引用已失效或不再是当前有效版本。',
  vou_stale_revision: '草稿基于过期版本，请重新加载。',
  vou_submission_exists: '该单据已有开放提交件。',
  vou_submit_mode_mismatch: '当前草稿提交方式无效。',
  vou_trusted_actor_required: '系统生成单据不能从浏览器新建。',
  acc_amount_invalid: '金额格式或金额方向无效。',
  acc_book_access_denied: '当前用户无权访问该账簿。',
  acc_book_code_exhausted: '账簿编码已用尽。',
  acc_book_delete_blocked: '账簿存在关联业务，不能删除。',
  acc_control_book_delete_forbidden: '控制账簿不能删除。',
  acc_inventory_dimension_required: '库存核算缺少必填辅助核算。',
  acc_inventory_quantity_required: '库存核算缺少数量。',
  acc_mapping_collection_invalid: '记账映射集合无效。',
  acc_mapping_currency_invalid: '记账映射币种无效。',
  acc_mapping_dimension_required: '记账映射缺少辅助核算。',
  acc_mapping_multi_currency_unsupported: '记账映射不支持多币种。',
  acc_mapping_not_found: '记账映射不存在。',
  acc_mapping_rule_conflict: '记账映射规则冲突。',
  acc_mapping_template_not_found: '记账映射模板不存在。',
  acc_book_not_found: '会计账簿不存在。',
  acc_opening_delete_blocked: '期初提交件不能删除。',
  acc_opening_dimension_required: '期初明细缺少必填辅助核算。',
  acc_opening_empty: '期初至少需要一条明细。',
  acc_opening_register_id_required: '期初登记对象缺少标识。',
  acc_opening_register_invalid: '期初登记对象无效。',
  acc_opening_subject_invalid: '期初明细的会计科目无效。',
  acc_opening_unapprove_blocked: '期初已被后续业务使用，不能反批准。',
  acc_opening_unbalanced: '期初借贷金额不平衡。',
  acc_period_already_locked: '会计期间已经锁定。',
  acc_period_before_book_start: '会计期间早于账簿启用期间。',
  acc_period_mapping_missing: '会计期间缺少记账映射。',
  acc_period_negative_inventory: '会计期间出现负库存。',
  acc_period_not_continuous: '会计期间必须连续锁定。',
  acc_period_not_ended: '会计期间尚未结束。',
  acc_period_not_locked: '会计期间尚未锁定。',
  acc_period_open_vou: '期间仍有未完成单据。',
  acc_period_opening_not_approved: '期初尚未批准，不能锁定期间。',
  acc_period_unbalanced: '会计期间借贷不平衡。',
  acc_period_unlock_not_latest: '只能解锁最近锁定的会计期间。',
  acc_subject_frozen: '会计科目已停用。',
  acc_subject_delete_blocked: '会计科目存在关联业务，不能删除。',
  acc_subject_not_found: '会计科目不存在。',
  acc_subject_parent_invalid: '会计科目父级无效。',
  acc_posting_subject_invalid: '记账科目无效。',
  acc_posting_unbalanced: '记账借贷不平衡。',
  wfl_action_conflict: '该流程动作已使用不同请求标识执行。',
  wfl_action_unavailable: '当前流程节点不允许此动作。',
  wfl_child_target_unavailable: '当前流程节点没有可创建的目标。',
  wfl_compile_failed: '流程脚本无法编译。',
  wfl_definition_code_conflict: '流程定义编码已存在。',
  wfl_definition_in_use: '流程定义正在被实例使用。',
  wfl_definition_not_found: '流程定义不存在。',
  wfl_downstream_blocker: '流程存在下游单据，不能执行该操作。',
  wfl_instance_not_found: '流程实例不存在。',
  wfl_multiple_definitions_match: '存在多个匹配的启用流程定义。',
  wfl_node_not_found: '流程节点不存在。',
  wfl_request_key_consumed: '该请求标识已经使用。',
  wfl_request_key_invalid: '请求标识格式无效。',
  wfl_resource_limit: '流程定义超过资源限制。',
  wfl_runtime_failed: '流程脚本执行失败。',
  wfl_script_too_large: '流程脚本超过长度限制。',
  wfl_trial_document_not_found: '试运行单据不存在。',
  wfl_trial_entity_mismatch: '试运行单据类型不匹配。',
  wfl_trial_failed: '流程试运行未通过。',
  wfl_trial_required: '请先完成流程试运行。',
  wfl_vou_port_invalid_result: '流程单据协作返回无效结果。',
}

const targetWireValuePresentation: Readonly<Record<string, string>> = {
  false: '否',
  true: '是',
  CURRENT: '当前版本',
  HISTORICAL: '历史版本',
  CNY: '人民币',
  'customer-subunit': '客户子单位',
  supplier: '供应商',
  'other-unit': '其他往来单位',
  employee: '员工',
  'sales-partner': '销售合作伙伴',
  product: '产品',
  COMMISSION: '佣金',
  INTERMEDIARY: '中介',
  BANK_DEDUCTED: '银行代扣',
  THIRD_PARTY_PAYABLE: '第三方应付',
  RECEIPT: '收款',
  PAYMENT: '付款',
  PACKAGED: '包装品',
  BULK_LIQUID: '散装液体',
  RAW_SELF: '自有原料',
  PRODUCT_FIXED: '产品固定',
  CUSTOMER_LATEST: '客户当前',
  MANUAL: '手工录入',
  IN: '流入',
  OUT: '流出',
  PRINCIPAL: '本金',
  INTEREST: '利息',
  FEE: '手续费',
  MARGIN: '保证金',
  OTHER: '其他',
  PRIMARY: '主业务',
  CHANGE: '变更',
  ASSET: '资产',
  LIABILITY: '负债',
  BANK_ACCEPTANCE: '银行承兑汇票',
  COMMERCIAL_ACCEPTANCE: '商业承兑汇票',
  CHECK: '支票',
  PAPER: '纸质',
  ELECTRONIC: '电子',
  PAYABLE: '应付',
  RECEIVABLE: '应收',
  SALE: '销售',
  RETURN_ADJUSTMENT: '退货调整',
  INTERNAL_EMPLOYEE: '内部员工',
  EXTERNAL_PART_TIME: '外聘兼职',
  CHANNEL_PARTNER: '渠道合作伙伴',
  NOT_REQUIRED: '不需要',
  MISSING: '缺失',
  APPLICABLE: '适用',
  RAW_MATERIAL: '原材料',
  STANDARD_FINISHED: '标准产成品',
  CUSTOM_FINISHED: '定制产成品',
  PACKAGING: '包装材料',
  OPEN_DOCUMENT: '打开单据',
  CREATE_CHILD: '创建下游单据',
  APPROVE_CHILD: '批准下游单据',
  REJECT_CHILD: '驳回下游单据',
  RETRY_CHILD: '重新提交下游单据',
  CANCEL_CHILD: '取消下游单据',
  'asset-primary': '资产期初',
  change: '变更',
  'payment-primary': '付款期初',
  'liability-primary': '负债期初',
  'discount-primary': '贴现期初',
  'maturity-primary': '到期期初',
}

export function targetWireValueLabel(value: string): string {
  return targetWireValuePresentation[value] ?? value
}

export function hasCompleteTargetPermissions(
  grantedPermissions: readonly string[],
  requiredPermissions: readonly string[],
) {
  return requiredPermissions.every((permission) =>
    grantedPermissions.includes(permission),
  )
}

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
  const vouSubmissions = ref<VouSubmissionView[]>([])
  const vouReasons = ref<Record<string, string>>({})
  const vouAttachmentCounts = ref<Record<string, number>>({})
  const vouReferenceCandidates = ref<
    Partial<Record<VouReferenceCandidateEntity, VouReferenceCandidate[]>>
  >({})
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
  const accSubjectCode = ref('')
  const accSubjectName = ref('')
  const accSubjectDirection = ref<'DEBIT' | 'CREDIT'>('DEBIT')
  const accVouEntity = ref('')
  const targetPath = window.location.pathname
  const workbenchPage = ref(targetPath === '/home/dashboard')
  const workbenchActiveTab = ref<WorkbenchTab>('DOCUMENT')
  const workbenchDocumentState = reactive<WorkbenchTabState>(newWorkbenchTabState())
  const workbenchArchiveState = reactive<WorkbenchTabState>(newWorkbenchTabState())
  const workbenchRequestVersions: Record<WorkbenchTab, number> = { DOCUMENT: 0, ARCHIVE: 0 }
  const workbenchActiveState = computed(() => workbenchState(workbenchActiveTab.value))
  const workbenchReasons = ref<Record<string, string>>({})
  const accBookPage = ref(targetPath === '/acc/book')
  const accSubjectPage = ref(targetPath === '/acc/subject')
  const accOpeningPage = ref(targetPath === '/acc/opening')
  const accPeriodPage = ref(targetPath === '/acc/period')
  const wflDefinitionPage = ref(targetPath === '/dcl/wfl-process-definition')
  const wflCurrentPage = ref(targetPath === '/wfl/process-definition')
  const wflInstancePage = ref(targetPath === '/wfl/process-instance')
  const accBooks = ref<AccBookView[]>([])
  const accSubjects = ref<AccSubjectView[]>([])
  const openingDrafts = ref<OpeningDraft[]>([])
  const accOpening = ref<AccOpeningView | null>(null)
  const accPeriods = ref<AccPeriodView[]>([])
  const accPeriodMonth = ref('')
  const accReason = ref('')
  const wflDrafts = ref<WflDefinitionDraft[]>([])
  const wflDefinitions = ref<WflDefinitionView[]>([])
  const wflCurrentDefinitions = ref<WflCurrentDefinitionView[]>([])
  const wflCurrentDefinition = ref<WflCurrentDefinitionView | null>(null)
  const wflInstances = ref<WflInstanceView[]>([])
  const wflInstance = ref<WflInstanceView | null>(null)
  const wflReasons = ref<Record<string, string>>({})
  const wflRequestKeys = ref<Record<string, string>>({})
  function canCompleteAction(...requiredPermissions: string[]) {
    return hasCompleteTargetPermissions(permissions.value, requiredPermissions)
  }
  const canQueryAccMapping = computed(() =>
    permissions.value.includes('/acc/mapping/query'),
  )
  const canGetAccMapping = computed(() =>
    permissions.value.includes('/acc/mapping/get'),
  )
  const canQueryAccBooks = computed(() =>
    permissions.value.includes('/acc/book/query'),
  )
  const canCreateAccBook = computed(() =>
    canCompleteAction('/acc/book/query', '/acc/book/create'),
  )
  const canSaveAccBook = computed(() =>
    canCompleteAction('/acc/book/query', '/acc/book/save'),
  )
  const canCreateAccSubject = computed(
    () =>
      !!accBookId.value &&
      !!accSubjectCode.value.trim() &&
      !!accSubjectName.value.trim() &&
      canCompleteAction(
        '/acc/book/query',
        '/acc/subject/query',
        '/acc/subject/create',
      ),
  )
  const canSaveAccSubject = computed(
    () =>
      !!accBookId.value &&
      canCompleteAction(
        '/acc/book/query',
        '/acc/subject/query',
        '/acc/subject/save',
      ),
  )
  const canCreateOpeningDraft = computed(
    () =>
      !!accBookId.value &&
      [
        '/acc/book/query',
        '/acc/subject/query',
        '/acc/opening/query',
        '/acc/opening/submit-new',
      ].every((permission) => permissions.value.includes(permission)),
  )
  const canQueryWflDefinitions = computed(() =>
    permissions.value.includes('/dcl/wfl-process-definition/query'),
  )
  const canCreateWflDefinitionDraft = computed(() =>
    [
      '/dcl/wfl-process-definition/query',
      '/dcl/wfl-process-definition/submit-new',
      '/wfl/process-definition/trial',
    ].every((permission) => permissions.value.includes(permission)),
  )
  const canCreateVouDraft = computed(
    () =>
      !!vouEntity.value &&
      userCreatableVouEntities.includes(vouEntity.value as never) &&
      [
        `/vou/${vouEntity.value}/submit-new`,
        `/vou/${vouEntity.value}/query`,
        ...vouReferencePermissions(vouEntity.value),
      ].every((permission) => permissions.value.includes(permission)),
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
  const canSubmitWflDefinitionDraft = computed(() =>
    permissions.value.includes('/dcl/wfl-process-definition/submit-new'),
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
  const workflowDraftRepository = new TargetWorkflowDraftRepository(
    archiveDraftRepository,
  )
  const modelCorpusResult = JSON.stringify(runTargetModelCorpus())

  async function applySession(session: TargetSession) {
    csrfToken.value = session.csrfToken
    currentUser.value = session.user
    permissions.value = session.permissions
    message.value = `当前用户：${session.user.displayName}`
    if (workbenchPage.value) {
      await queryWorkbench('DOCUMENT', 1)
      return
    }
    if (accMappingReadPage.value) {
      await loadAccMappingCatalog()
      return
    }
    if (
      accBookPage.value ||
      accSubjectPage.value ||
      accOpeningPage.value ||
      accPeriodPage.value
    ) {
      await loadAccBooks()
      if (accBookId.value) await loadAccBookDetail()
      return
    }
    if (wflDefinitionPage.value) {
      await Promise.all([loadWflDrafts(), loadWflDefinitions()])
      await loadWflDefinitionDeepLink()
      return
    }
    if (wflCurrentPage.value) {
      await loadWflCurrentDefinitions()
      return
    }
    if (wflInstancePage.value) {
      await loadWflInstances()
      return
    }
    if (vouEntity.value) {
      await Promise.all([
        loadVouDrafts(),
        loadVouSubmissions(),
        loadVouReferenceCandidates(vouEntity.value),
      ])
      await loadVouDeepLink()
      return
    }
    await Promise.all([
      loadDrafts(),
      loadWarehouses(),
      loadArchiveDrafts(),
      loadArchiveReferenceOptions(),
    ])
    await loadWarehouseDeepLink()
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

  function workbenchState(tab: WorkbenchTab) {
    return tab === 'DOCUMENT' ? workbenchDocumentState : workbenchArchiveState
  }

  function currentWorkbenchQuery(
    tab: WorkbenchTab,
    page: number,
  ): TargetWorkbenchQueryInput {
    const state = workbenchState(tab)
    const filters = {
      kind: tab,
      ...(state.entity.trim() ? { entity: state.entity.trim() } : {}),
      ...(state.status ? { status: state.status } : {}),
      ...(state.keyword.trim() ? { keyword: state.keyword.trim() } : {}),
    }
    return {
      page,
      pageSize: 20,
      ...(Object.keys(filters).length ? { filters } : {}),
    }
  }

  async function queryWorkbench(
    tab: WorkbenchTab = workbenchActiveTab.value,
    page = workbenchState(tab).page,
    correctingExpiredPage = false,
  ) {
    const state = workbenchState(tab)
    const requestVersion = ++workbenchRequestVersions[tab]
    try {
      const result = await queryTargetWorkbench(
        csrfToken.value,
        currentWorkbenchQuery(tab, page),
      )
      if (requestVersion !== workbenchRequestVersions[tab]) return
      const lastPage = Math.max(1, Math.ceil(result.total / 20))
      if (!correctingExpiredPage && result.page > lastPage)
        return queryWorkbench(tab, lastPage, true)
      state.items = result.items as WorkbenchItemView[]
      state.total = result.total
      state.page = result.page
      state.queryError = null
      message.value = `已查询 ${result.total} 项待办。`
    } catch (error) {
      if (requestVersion !== workbenchRequestVersions[tab]) return
      state.queryError = targetErrorMessage(error, '工作台查询失败。', '请重新登录。')
      requestId.value = targetErrorRequestId(error)
    }
  }

  async function switchWorkbenchTab(tab: WorkbenchTab) {
    workbenchActiveTab.value = tab
    const state = workbenchState(tab)
    await queryWorkbench(tab, state.page)
  }

  async function applyWorkbenchFilters() {
    const state = workbenchActiveState.value
    state.page = 1
    await queryWorkbench(workbenchActiveTab.value, 1)
  }

  async function resetWorkbenchFilters() {
    const state = workbenchActiveState.value
    state.keyword = ''
    state.entity = ''
    state.status = ''
    state.page = 1
    await queryWorkbench(workbenchActiveTab.value, 1)
  }

  async function retryWorkbench() {
    await queryWorkbench(workbenchActiveTab.value, workbenchActiveState.value.page)
  }

  function workbenchItemHref(item: WorkbenchItemView, mode: 'view' | 'edit'): string {
    const parameters = new URLSearchParams({ mode })
    if (item.domain === 'vou') parameters.set('documentId', item.subjectOrDocumentId)
    else {
      parameters.set('objectId', item.subjectOrDocumentId)
      parameters.set('approvalEntryId', item.submissionId)
      parameters.set('code', item.code)
    }
    return `/${item.domain}/${item.entity}?${parameters.toString()}`
  }

  function visibleWorkbenchActions(item: WorkbenchItemView): WorkbenchAction[] {
    return item.availableActions.filter((action) => action !== 'view' || !item.availableActions.includes('edit'))
  }

  function workbenchActionLabel(action: WorkbenchAction): string {
    if (action === 'view') return '查看'
    if (action === 'edit') return '编辑'
    if (action === 'delete') return '撤回'
    return approvalActionPresentation[action].label
  }

  async function reviewWorkbench(item: WorkbenchItemView, action: WorkbenchReviewAction) {
    const tab = workbenchActiveTab.value
    const state = workbenchState(tab)
    const reason = workbenchReasons.value[item.submissionId]?.trim()
    state.actionError = null
    if (action === 'reject' && !reason) {
      state.actionError = '请填写驳回原因。'
      return
    }
    try {
      if (item.domain === 'dcl') {
        const input = {
          subjectId: item.subjectOrDocumentId,
          submissionId: item.submissionId,
          expectedRevision: item.revision,
          ...(action === 'reject' ? { reason: reason ?? '' } : {}),
        }
        if (item.entity === 'warehouse')
          await reviewTargetWarehouse(
            csrfToken.value,
            action as TargetWarehouseAction,
            input,
          )
        else if (item.entity === 'wfl-process-definition')
          await reviewTargetWflDefinition(csrfToken.value, action, input)
        else
          await reviewTargetArchive(csrfToken.value, {
            entity: item.entity as TargetArchiveEntity,
            action,
            input,
          } as TargetArchiveReviewRequest)
      } else {
        await reviewTargetVou(csrfToken.value, item.entity as VouEntity, action, {
          documentId: item.subjectOrDocumentId,
          submissionId: item.submissionId,
          expectedRevision: item.revision,
          ...(action === 'reject' ? { reason: reason ?? '' } : {}),
        } as Parameters<typeof reviewTargetVou>[3])
      }
      message.value = `${approvalActionPresentation[action].label}已提交，已刷新待办。`
    } catch (error) {
      state.actionError = targetErrorMessage(error, '待办处理失败。', '请重新登录。')
      requestId.value = targetErrorRequestId(error)
    } finally {
      await queryWorkbench(tab, state.page)
    }
  }

  async function deleteWorkbench(item: WorkbenchItemView) {
    const tab = workbenchActiveTab.value
    const state = workbenchState(tab)
    state.actionError = null
    try {
      const input = { subjectId: item.subjectOrDocumentId, submissionId: item.submissionId, expectedRevision: item.revision }
      if (item.domain === 'vou')
        await deleteTargetVou(csrfToken.value, item.entity as VouEntity, {
          documentId: item.subjectOrDocumentId, submissionId: item.submissionId, expectedRevision: item.revision,
        })
      else if (item.entity === 'warehouse') await deleteTargetWarehouseSubmission(csrfToken.value, input)
      else if (item.entity === 'wfl-process-definition') await deleteTargetWflDefinition(csrfToken.value, input)
      else await deleteTargetArchive(csrfToken.value, {
        entity: item.entity as TargetArchiveEntity, input,
      } as TargetArchiveDeleteRequest)
      message.value = '撤回已提交，已刷新待办。'
    } catch (error) {
      state.actionError = targetErrorMessage(error, '撤回失败。', '请重新登录。')
      requestId.value = targetErrorRequestId(error)
    } finally {
      await queryWorkbench(tab, state.page)
    }
  }

  async function loadVouDrafts() {
    if (!currentUser.value || !vouEntity.value) return
    vouDrafts.value = await vouDraftRepository.list(
      currentUser.value.id,
      vouEntity.value,
    )
    const counts = await Promise.all(
      vouDrafts.value.map(
        async (draft) =>
          [
            draft.draftId,
            (await vouDraftRepository.attachments(draft)).length,
          ] as const,
      ),
    )
    vouAttachmentCounts.value = Object.fromEntries(counts)
  }

  async function loadVouSubmissions() {
    if (
      !vouEntity.value ||
      !permissions.value.includes(`/vou/${vouEntity.value}/query`)
    )
      return
    try {
      const result: unknown = await queryTargetVou(
        csrfToken.value,
        vouEntity.value,
      )
      vouSubmissions.value = Array.isArray(result)
        ? result.filter(isVouSubmissionView)
        : []
    } catch (error) {
      setError(error, '单据查询失败。')
    }
  }

  async function loadVouDeepLink() {
    if (!vouEntity.value) return
    const parameters = new URLSearchParams(window.location.search)
    const documentId = parameters.get('documentId')?.trim()
    const mode = parameters.get('mode')
    if (!documentId || (mode !== 'view' && mode !== 'edit')) return
    try {
      const detail = await getTargetVou(
        csrfToken.value,
        vouEntity.value,
        documentId,
      )
      if (!isVouSubmissionView(detail))
        throw new Error('vou_submission_response_invalid')
      vouSubmissions.value = [
        detail,
        ...vouSubmissions.value.filter(
          (item) => item.documentId !== documentId,
        ),
      ]
      if (mode === 'edit') await cloneVouSubmission(detail)
    } catch (error) {
      setError(error, '工作台单据深链读取失败。')
    }
  }

  async function loadVouReferenceCandidates(entity: VouEntity) {
    const entities = vouCandidateEntities(entity)
    const candidates: Partial<
      Record<VouReferenceCandidateEntity, VouReferenceCandidate[]>
    > = {}
    try {
      const results = await Promise.all(
        entities.map(async (candidate) => {
          const page: unknown = await queryTargetVouReference(csrfToken.value, {
            entity: candidate,
          })
          return [candidate, page] as const
        }),
      )
      for (const [entityName, page] of results)
        candidates[entityName] =
          isRecord(page) && Array.isArray(page.items)
            ? page.items.flatMap((row) => referenceCandidate(entityName, row))
            : []
      vouReferenceCandidates.value = candidates
    } catch (error) {
      setError(error, '引用候选查询失败。')
    }
  }

  async function newVouDraft() {
    if (!currentUser.value || !vouEntity.value || !canCreateVouDraft.value) {
      message.value = '无权新建并完成该单据的提交闭环。'
      return
    }
    await loadVouReferenceCandidates(vouEntity.value)
    const draft: VouDraft = {
      entity: vouEntity.value,
      draftId: createTargetId(),
      ownerUserId: currentUser.value.id,
      updatedAt: new Date().toISOString(),
      documentId: createTargetId(),
      submissionId: createTargetId(),
      stableRevision: null,
      payload: createVouDraftPayload(vouEntity.value),
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
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      message.value = '附件仅支持 PDF、JPEG 或 PNG。'
      return
    }
    await vouDraftRepository.saveAttachment(draft, {
      attachmentId: createTargetId(),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      digest: await sha256(file),
      blob: file,
    })
    vouAttachmentCounts.value = {
      ...vouAttachmentCounts.value,
      [draft.draftId]: (vouAttachmentCounts.value[draft.draftId] ?? 0) + 1,
    }
    message.value = '附件已保存在本机草稿。'
  }

  async function submitVouDraft(draft: VouDraft) {
    try {
      const attachments = await vouDraftRepository.attachments(draft)
      for (const attachment of attachments)
        await stageTargetVouAttachment(csrfToken.value, draft.entity, {
          stagingId: attachment.attachmentId,
          fileId: attachment.attachmentId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType as
            'application/pdf' | 'image/jpeg' | 'image/png',
          size: attachment.size,
          digest: attachment.digest,
          contentBase64: await blobBase64(attachment.blob),
        })
      await submitTargetVou(
        csrfToken.value,
        draft.entity,
        draft.stableRevision ? 'CHANGE' : 'NEW',
        {
          documentId: draft.documentId,
          submissionId: draft.submissionId,
          idempotencyKey: draft.submissionId,
          expectedRevision: draft.stableRevision,
          payload: {
            ...compactVouDraftPayload(draft.entity, draft.payload),
            attachments: attachments.map((attachment) => ({
              id: attachment.attachmentId,
              fileName: attachment.fileName,
              contentType: attachment.mimeType as
                'application/pdf' | 'image/jpeg' | 'image/png',
              sizeBytes: attachment.size,
              sha256: attachment.digest,
              stagingId: attachment.attachmentId,
            })),
          },
        },
      )
      await vouDraftRepository.delete(draft)
      await Promise.all([loadVouDrafts(), loadVouSubmissions()])
      message.value = '单据已提交；本地草稿已删除。'
    } catch (error) {
      setError(error, '单据提交失败；本地草稿和附件仍保留。')
    }
  }

  function vouInputs(draft: VouDraft): VouInputEntry[] {
    const entries: VouInputEntry[] = []
    const visit = (
      fields: readonly VouInputFieldDescriptor[],
      parent: string[] = [],
      referenceEntity?: VouReferenceCandidateEntity,
      allowedEntities?: readonly VouReferenceCandidateEntity[],
      referenceKind?: 'object' | 'versioned' | 'snapshot',
    ) => {
      for (const field of fields) {
        const path = [...parent, field.key]
        if (field.key === 'attachments') continue
        if (field.kind === 'object' && field.fields?.length) {
          visit(
            field.fields,
            path,
            field.referenceEntity,
            field.allowedEntities,
            field.fields.some((child) => child.key === 'selectionOrigin')
              ? 'versioned'
              : field.fields.some((child) => child.key === 'entity')
                ? 'snapshot'
                : 'object',
          )
          continue
        }
        if (field.kind === 'array' && field.item?.length) {
          const rows = valueAt(draft.payload as Record<string, unknown>, path)
          if (!Array.isArray(rows)) continue
          for (let index = 0; index < rows.length; index++) {
            const row = rows[index]
            const variant = field.variants?.find(
              (candidate) =>
                isRecord(row) &&
                Object.entries(candidate.discriminators).every(
                  ([key, value]) => row[key] === value,
                ),
            )
            visit(variant?.fields ?? field.item, [...path, String(index)])
          }
          continue
        }
        entries.push({
          field,
          path,
          referenceEntity: field.referenceEntity ?? referenceEntity,
          allowedEntities: field.allowedEntities ?? allowedEntities,
          referenceKind,
        })
      }
    }
    visit(vouEntityInputDescriptors[draft.entity])
    return entries
  }

  function vouArrayInputs(draft: VouDraft): VouInputEntry[] {
    return vouEntityInputDescriptors[draft.entity]
      .filter((field) => field.key !== 'attachments' && field.kind === 'array')
      .map((field) => ({ field, path: [field.key] }))
  }

  function vouInputTestId(entry: VouInputEntry) {
    return `vou-field-${entry.path.join('-')}`
  }

  function vouInputLabel(entry: VouInputEntry) {
    return `${entry.path.join(' · ')}${entry.referenceEntity ? `（${entry.referenceEntity}）` : ''}`
  }

  function vouInputCandidates(entry: VouInputEntry) {
    const entities = entry.referenceEntity
      ? [entry.referenceEntity]
      : (entry.allowedEntities ?? [])
    return entities.flatMap(
      (entity) => vouReferenceCandidates.value[entity] ?? [],
    )
  }

  function selectVouInputCandidate(
    draft: VouDraft,
    entry: VouInputEntry,
    event: Event,
  ) {
    const candidate = vouInputCandidates(entry).find(
      (item) => item.objectId === (event.target as HTMLSelectElement).value,
    )
    if (!candidate) return
    const payload = draft.payload as Record<string, unknown>
    const leaf = entry.path.at(-1)
    if (leaf === 'assetId' || leaf === 'billId') {
      setValueAt(payload, entry.path, candidate.objectId)
      return
    }
    const parent = entry.path.slice(0, -1)
    setValueAt(payload, [...parent, 'objectId'], candidate.objectId)
    if (entry.referenceKind === 'snapshot') {
      if (candidate.approvalEntryId)
        setValueAt(
          payload,
          [...parent, 'approvalEntryId'],
          candidate.approvalEntryId,
        )
      setValueAt(payload, [...parent, 'entity'], candidate.entity)
      setValueAt(payload, [...parent, 'code'], candidate.code)
      setValueAt(payload, [...parent, 'name'], candidate.name)
      return
    }
    if (entry.referenceKind === 'versioned' && candidate.approvalEntryId) {
      setValueAt(
        payload,
        [...parent, 'approvalEntryId'],
        candidate.approvalEntryId,
      )
      setValueAt(payload, [...parent, 'selectionOrigin'], 'CURRENT')
    }
  }

  function valueAt(object: Record<string, unknown>, path: readonly string[]) {
    let current: unknown = object
    for (const segment of path) {
      if (Array.isArray(current)) current = current[Number(segment)]
      else if (isRecord(current)) current = current[segment]
      else return undefined
    }
    return current
  }

  function setValueAt(
    object: Record<string, unknown>,
    path: readonly string[],
    value: unknown,
  ) {
    let current: Record<string, unknown> | unknown[] = object
    for (const [index, segment] of path.entries()) {
      const last = index === path.length - 1
      const nextIsArray = /^\d+$/.test(path[index + 1] ?? '')
      if (Array.isArray(current)) {
        const key = Number(segment)
        if (last) current[key] = value
        else {
          current[key] ??= nextIsArray ? [] : {}
          current = current[key] as Record<string, unknown> | unknown[]
        }
        continue
      }
      if (last) current[segment] = value
      else {
        current[segment] ??= nextIsArray ? [] : {}
        current = current[segment] as Record<string, unknown> | unknown[]
      }
    }
  }

  function emptyVouInput(field: VouInputFieldDescriptor): unknown {
    switch (field.kind) {
      case 'decimal':
        return '0.00'
      case 'integer':
        return 0
      case 'date':
        return '2026-01-01'
      case 'boolean':
        return false
      case 'enum':
        return field.enumValues?.[0] ?? ''
      case 'object':
        return Object.fromEntries(
          (field.fields ?? []).map((child) => [
            child.key,
            emptyVouInput(child),
          ]),
        )
      case 'array':
        return []
      default:
        return ''
    }
  }

  function vouInputValue(draft: VouDraft, entry: VouInputEntry) {
    const value = valueAt(draft.payload as Record<string, unknown>, entry.path)
    const { field } = entry
    if (field.kind === 'boolean') return value === true ? 'true' : 'false'
    return String(value ?? '')
  }

  function updateVouInput(draft: VouDraft, entry: VouInputEntry, event: Event) {
    const raw = (event.target as HTMLInputElement).value
    const payload = draft.payload as Record<string, unknown>
    const { field } = entry
    if (field.kind === 'boolean')
      setValueAt(payload, entry.path, raw === 'true')
    else if (field.kind === 'integer')
      setValueAt(payload, entry.path, Number(raw))
    else if (field.kind === 'array')
      setValueAt(
        payload,
        entry.path,
        raw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
    else setValueAt(payload, entry.path, raw)
  }

  function appendVouArrayItem(draft: VouDraft, entry: VouInputEntry) {
    const payload = draft.payload as Record<string, unknown>
    let existing = valueAt(payload, entry.path)
    if (existing === undefined) {
      setValueAt(payload, entry.path, [])
      existing = valueAt(payload, entry.path)
    }
    if (!Array.isArray(existing)) return
    existing.push(
      Object.fromEntries(
        (entry.field.variants?.[0]?.fields ?? entry.field.item ?? []).map(
          (child) => [child.key, emptyVouInput(child)],
        ),
      ),
    )
  }

  function selectVouArrayVariant(
    draft: VouDraft,
    entry: VouInputEntry,
    event: Event,
  ) {
    const variant = entry.field.variants?.find(
      (candidate) => candidate.id === (event.target as HTMLSelectElement).value,
    )
    const rows = valueAt(draft.payload as Record<string, unknown>, entry.path)
    if (!variant || !Array.isArray(rows) || rows.length === 0) return
    rows[0] = Object.fromEntries(
      variant.fields.map((field) => [field.key, emptyVouInput(field)]),
    )
  }

  function vouAttachmentCount(draft: VouDraft) {
    return vouAttachmentCounts.value[draft.draftId] ?? 0
  }

  function canReviewVou(submission: VouSubmissionView, action: ApprovalAction) {
    return submission.availableApprovalActions.includes(action)
  }

  async function reviewVou(
    submission: VouSubmissionView,
    action: ApprovalAction,
  ) {
    const reason = vouReasons.value[submission.submissionId]?.trim() ?? ''
    if ((action === 'reject' || action === 'unapprove') && !reason) {
      message.value = '请填写审批原因。'
      return
    }
    try {
      await reviewTargetVou(csrfToken.value, submission.entity, action, {
        documentId: submission.documentId,
        submissionId: submission.submissionId,
        expectedRevision: submission.revision,
        ...((action === 'reject' || action === 'unapprove') && { reason }),
      } as never)
      delete vouReasons.value[submission.submissionId]
      await loadVouSubmissions()
      message.value = `单据已${approvalActionPresentation[action].label}。`
    } catch (error) {
      setError(error, '审批操作失败。')
      await loadVouSubmissions()
    }
  }

  async function deleteVou(submission: VouSubmissionView) {
    if (!submission.canDelete) {
      message.value = '无权删除该开放提交件。'
      return
    }
    try {
      await deleteTargetVou(csrfToken.value, submission.entity, {
        documentId: submission.documentId,
        submissionId: submission.submissionId,
        expectedRevision: submission.revision,
      })
      await loadVouSubmissions()
      message.value = '开放提交件已删除。'
    } catch (error) {
      setError(error, '删除提交件失败。')
      await loadVouSubmissions()
    }
  }

  async function cloneVouSubmission(submission: VouSubmissionView) {
    if (
      !currentUser.value ||
      !permissions.value.includes(`/vou/${submission.entity}/submit-change`)
    ) {
      message.value = '无权创建改单草稿。'
      return
    }
    const { attachments: _attachments, ...payload } = submission.payload
    const draft: VouDraft = {
      entity: submission.entity,
      draftId: createTargetId(),
      ownerUserId: currentUser.value.id,
      updatedAt: new Date().toISOString(),
      documentId: submission.documentId,
      submissionId: createTargetId(),
      stableRevision: submission.revision,
      payload: structuredClone(payload),
    }
    await vouDraftRepository.save(draft)
    await loadVouDrafts()
    message.value = '已复制为本机改单草稿。'
  }

  async function loadAccBooks() {
    if (!canQueryAccBooks.value) return
    try {
      const result: unknown = await queryTargetAccBooks(csrfToken.value)
      accBooks.value = Array.isArray(result) ? result.filter(isAccBookView) : []
      if (!accBookId.value && accBooks.value[0])
        accBookId.value = accBooks.value[0].id
    } catch (error) {
      setError(error, '会计账簿查询失败。')
    }
  }

  async function createAccBook() {
    if (!canCreateAccBook.value) return
    const id = createTargetId()
    try {
      await createTargetAccBook(csrfToken.value, {
        id,
        name: '本地新账簿',
        description: '',
        startMonth: previousMonthText(),
        baseCurrency: 'CNY',
      })
      await loadAccBooks()
      accBookId.value = id
      message.value = '会计账簿已创建。'
    } catch (error) {
      setError(error, '会计账簿创建失败。')
    }
  }

  async function saveAccBook(book: AccBookView) {
    if (!canSaveAccBook.value) return
    try {
      await saveTargetAccBook(csrfToken.value, {
        id: book.id,
        expectedRevision: book.revision,
        name: book.name,
        description: book.description,
        baseCurrency: book.baseCurrency,
      })
      await loadAccBooks()
      message.value = '会计账簿已保存。'
    } catch (error) {
      setError(error, '会计账簿保存失败。')
      await loadAccBooks()
    }
  }

  async function deleteAccBook(book: AccBookView) {
    if (!permissions.value.includes('/acc/book/delete')) return
    try {
      await deleteTargetAccBook(csrfToken.value, {
        id: book.id,
        expectedRevision: book.revision,
      })
      if (accBookId.value === book.id) accBookId.value = ''
      await loadAccBooks()
      message.value = '会计账簿已删除。'
    } catch (error) {
      setError(error, '会计账簿删除失败。')
      await loadAccBooks()
    }
  }

  async function loadAccBookDetail() {
    if (!accBookId.value) return
    await Promise.all([
      loadAccSubjects(),
      loadOpeningDrafts(),
      loadAccOpening(),
      loadAccPeriods(),
    ])
  }

  async function selectAccBook(bookId: string) {
    accBookId.value = bookId
    await loadAccBookDetail()
  }

  async function loadAccSubjects() {
    if (!accBookId.value || !permissions.value.includes('/acc/subject/query'))
      return
    try {
      const result: unknown = await queryTargetAccSubjects(
        csrfToken.value,
        accBookId.value,
      )
      accSubjects.value = Array.isArray(result)
        ? result.filter(isAccSubjectView)
        : []
    } catch (error) {
      setError(error, '会计科目查询失败。')
    }
  }

  async function createAccSubject() {
    if (!canCreateAccSubject.value) return
    try {
      await createTargetAccSubject(csrfToken.value, {
        id: createTargetId(),
        bookId: accBookId.value,
        code: accSubjectCode.value.trim(),
        name: accSubjectName.value.trim(),
        parentId: null,
        balanceDirection: accSubjectDirection.value,
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      })
      accSubjectCode.value = ''
      accSubjectName.value = ''
      await loadAccSubjects()
      message.value = '会计科目已创建。'
    } catch (error) {
      setError(error, '会计科目创建失败。')
    }
  }

  async function saveAccSubject(subject: AccSubjectView) {
    if (!canSaveAccSubject.value) return
    try {
      await saveTargetAccSubject(csrfToken.value, {
        id: subject.id,
        bookId: subject.bookId,
        expectedRevision: subject.revision,
        code: subject.code,
        name: subject.name,
        parentId: subject.parentId,
        balanceDirection: subject.balanceDirection,
        enabled: subject.enabled,
        requiredDimensions: subject.requiredDimensions as never,
        inventoryQuantity: subject.inventoryQuantity,
        settlementPurpose: subject.settlementPurpose,
      })
      await loadAccSubjects()
      message.value = '会计科目已保存。'
    } catch (error) {
      setError(error, '会计科目保存失败。')
      await loadAccSubjects()
    }
  }

  async function deleteAccSubject(subject: AccSubjectView) {
    if (!permissions.value.includes('/acc/subject/delete')) return
    try {
      await deleteTargetAccSubject(csrfToken.value, {
        id: subject.id,
        expectedRevision: subject.revision,
      })
      await loadAccSubjects()
      message.value = '会计科目已删除。'
    } catch (error) {
      setError(error, '会计科目删除失败。')
      await loadAccSubjects()
    }
  }

  async function loadOpeningDrafts() {
    if (!currentUser.value || !accBookId.value) return
    openingDrafts.value = await workflowDraftRepository.listOpenings(
      currentUser.value.id,
      accBookId.value,
    )
  }

  async function newOpeningDraft() {
    if (!currentUser.value || !canCreateOpeningDraft.value) return
    const debit = accSubjects.value.find(
      (subject) => subject.balanceDirection === 'DEBIT',
    )
    const credit = accSubjects.value.find(
      (subject) => subject.balanceDirection === 'CREDIT',
    )
    const draft: OpeningDraft = {
      entity: 'acc-opening',
      draftId: createTargetId(),
      ownerUserId: currentUser.value.id,
      updatedAt: new Date().toISOString(),
      bookId: accBookId.value,
      submissionId: createTargetId(),
      lines: [
        ...(debit
          ? [
              {
                subjectId: debit.id,
                currency: 'CNY',
                direction: 'DEBIT' as const,
                amount: '100.00',
                dimensions: {},
              },
            ]
          : []),
        ...(credit
          ? [
              {
                subjectId: credit.id,
                currency: 'CNY',
                direction: 'CREDIT' as const,
                amount: '100.00',
                dimensions: {},
              },
            ]
          : []),
      ],
      assets: [],
      bills: [],
      containers: [],
    }
    await workflowDraftRepository.save(draft)
    await loadOpeningDrafts()
    message.value = '期初草稿已保存在本机。'
  }

  async function saveOpeningDraft(draft: OpeningDraft) {
    draft.updatedAt = new Date().toISOString()
    await workflowDraftRepository.save(draft)
    message.value = '期初草稿已保存到本机。'
  }

  function addOpeningLine(draft: OpeningDraft) {
    const subject = accSubjects.value[0]
    if (!subject) return
    draft.lines.push({
      subjectId: subject.id,
      currency: 'CNY',
      direction: subject.balanceDirection,
      amount: '0.00',
      dimensions: {},
    })
    void saveOpeningDraft(draft)
  }

  function deleteOpeningLine(draft: OpeningDraft, index: number) {
    draft.lines.splice(index, 1)
    void saveOpeningDraft(draft)
  }

  function openingCollectionJson(
    draft: OpeningDraft,
    collection: 'assets' | 'bills' | 'containers',
  ) {
    return JSON.stringify(draft[collection], null, 2)
  }

  async function updateOpeningCollection(
    draft: OpeningDraft,
    collection: 'assets' | 'bills' | 'containers',
    event: Event,
  ) {
    try {
      const parsed: unknown = JSON.parse(
        (event.target as HTMLTextAreaElement).value,
      )
      if (!Array.isArray(parsed))
        throw new Error('opening_collection_not_array')
      draft[collection] = parsed
      await saveOpeningDraft(draft)
    } catch {
      message.value = '登记内容必须是 JSON 数组。'
    }
  }

  async function updateOpeningDimensions(
    draft: OpeningDraft,
    line: OpeningDraft['lines'][number],
    event: Event,
  ) {
    try {
      const parsed: unknown = JSON.parse(
        (event.target as HTMLTextAreaElement).value,
      )
      if (
        !isRecord(parsed) ||
        Object.values(parsed).some((value) => typeof value !== 'string')
      )
        throw new Error('opening_dimensions_not_object')
      line.dimensions = parsed as Record<string, string>
      await saveOpeningDraft(draft)
    } catch {
      message.value = '辅助维度必须是字符串值的 JSON 对象。'
    }
  }

  function openingQuantity(line: OpeningDraft['lines'][number]) {
    return (
      (line as OpeningDraft['lines'][number] & { quantity?: string })
        .quantity ?? ''
    )
  }

  async function updateOpeningQuantity(
    draft: OpeningDraft,
    line: OpeningDraft['lines'][number],
    event: Event,
  ) {
    ;(line as OpeningDraft['lines'][number] & { quantity?: string }).quantity =
      (event.target as HTMLInputElement).value
    await saveOpeningDraft(draft)
  }

  async function deleteOpeningDraft(draft: OpeningDraft) {
    await workflowDraftRepository.delete(draft)
    await loadOpeningDrafts()
  }

  async function submitOpeningDraft(draft: OpeningDraft) {
    try {
      await submitTargetAccOpening(csrfToken.value, {
        bookId: draft.bookId,
        submissionId: draft.submissionId,
        idempotencyKey: draft.submissionId,
        lines: draft.lines.map((line) => {
          const quantity = openingQuantity(line)
          return quantity ? { ...line, quantity } : line
        }) as never,
        assets: draft.assets,
        bills: draft.bills,
        containers: draft.containers,
      })
      await workflowDraftRepository.delete(draft)
      await Promise.all([loadOpeningDrafts(), loadAccOpening()])
      message.value = '期初已提交；本地草稿已删除。'
    } catch (error) {
      setError(error, '期初提交失败；本地草稿仍保留。')
      await loadAccOpening()
    }
  }

  async function loadAccOpening() {
    if (!accBookId.value || !permissions.value.includes('/acc/opening/query'))
      return
    try {
      accOpening.value = parseAccOpeningView(
        await queryTargetAccOpening(csrfToken.value, accBookId.value),
      )
    } catch (error) {
      if (
        error instanceof TargetApiError &&
        error.errorKey === 'approval_not_found'
      ) {
        accOpening.value = null
        return
      }
      setError(error, '期初查询失败。')
    }
  }

  async function reviewAccOpening(action: ApprovalAction) {
    const opening = accOpening.value
    if (!opening || !canReviewAccOpening(action)) return
    const reason = accReason.value.trim()
    if ((action === 'reject' || action === 'unapprove') && !reason) {
      message.value = '请填写审批原因。'
      return
    }
    try {
      await reviewTargetAccOpening(csrfToken.value, action, {
        bookId: opening.bookId,
        submissionId: opening.submissionId,
        expectedRevision: opening.approval.revision,
        ...((action === 'reject' || action === 'unapprove') && { reason }),
      })
      accReason.value = ''
      await loadAccOpening()
      message.value = `期初已${approvalActionPresentation[action].label}。`
    } catch (error) {
      setError(error, '期初审批失败。')
      await loadAccOpening()
    }
  }

  function canReviewAccOpening(action: ApprovalAction) {
    return !!accOpening.value?.availableApprovalActions.includes(action)
  }

  async function deleteAccOpening() {
    const opening = accOpening.value
    if (!opening) return
    try {
      await deleteTargetAccOpening(csrfToken.value, {
        bookId: opening.bookId,
        submissionId: opening.submissionId,
        expectedRevision: opening.approval.revision,
      })
      await loadAccOpening()
      message.value = '开放期初提交件已删除。'
    } catch (error) {
      setError(error, '期初删除失败。')
      await loadAccOpening()
    }
  }

  async function loadAccPeriods() {
    if (!accBookId.value || !permissions.value.includes('/acc/period/query'))
      return
    try {
      const result: unknown = await queryTargetAccPeriods(
        csrfToken.value,
        accBookId.value,
      )
      accPeriods.value = Array.isArray(result)
        ? result.filter(isAccPeriodView)
        : []
      if (!accPeriodMonth.value) {
        const book = accBooks.value.find((item) => item.id === accBookId.value)
        accPeriodMonth.value = book?.startMonth ?? previousMonthText()
      }
    } catch (error) {
      setError(error, '会计期间查询失败。')
    }
  }

  async function setAccPeriod(locked: boolean, period?: AccPeriodView) {
    const month = period?.month ?? accPeriodMonth.value
    if (!accBookId.value || !month) return
    const permission = `/acc/period/${locked ? 'lock' : 'unlock'}`
    if (!permissions.value.includes(permission)) return
    try {
      await setTargetAccPeriod(csrfToken.value, locked ? 'lock' : 'unlock', {
        bookId: accBookId.value,
        month,
        expectedRevision: period?.revision ?? null,
      })
      await loadAccPeriods()
      message.value = locked ? '会计期间已锁定。' : '会计期间已解锁。'
    } catch (error) {
      setError(error, '会计期间操作失败。')
      await loadAccPeriods()
    }
  }

  async function loadWflDrafts() {
    if (!currentUser.value) return
    wflDrafts.value = await workflowDraftRepository.listDefinitions(
      currentUser.value.id,
    )
  }

  async function loadWflDefinitions() {
    if (!canQueryWflDefinitions.value) return
    try {
      const result = await queryTargetWflDefinitions(csrfToken.value)
      wflDefinitions.value = flattenWflDefinitions(result)
    } catch (error) {
      setError(error, '流程定义查询失败。')
    }
  }

  async function loadWflDefinitionDeepLink() {
    const parameters = new URLSearchParams(window.location.search)
    const subjectId = parameters.get('objectId')?.trim()
    const mode = parameters.get('mode')
    if (!subjectId || (mode !== 'view' && mode !== 'edit')) return
    try {
      const detail: unknown = await getTargetWflDefinition(
        csrfToken.value,
        subjectId,
      )
      if (!isWflDefinitionView(detail))
        throw new Error('wfl_definition_response_invalid')
      wflDefinitions.value = [
        detail,
        ...wflDefinitions.value.filter(
          (item) => item.submissionId !== detail.submissionId,
        ),
      ]
    } catch (error) {
      setError(error, '工作台流程定义深链读取失败。')
    }
  }

  async function newWflDefinitionDraft() {
    if (!currentUser.value || !canCreateWflDefinitionDraft.value) return
    const draft: WflDefinitionDraft = {
      entity: 'wfl-process-definition',
      draftId: createTargetId(),
      ownerUserId: currentUser.value.id,
      updatedAt: new Date().toISOString(),
      subjectId: createTargetId(),
      submissionId: createTargetId(),
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      script: defaultWflScript(),
      trialDocument: { entity: 'sale-order', documentId: '' },
      trialSucceeded: false,
    }
    await workflowDraftRepository.save(draft)
    await loadWflDrafts()
    message.value = '流程定义草稿已保存在本机。'
  }

  async function saveWflDefinitionDraft(draft: WflDefinitionDraft) {
    draft.updatedAt = new Date().toISOString()
    draft.trialSucceeded = false
    await workflowDraftRepository.save(draft)
    message.value = '流程定义草稿已保存到本机。'
  }

  async function deleteWflDefinitionDraft(draft: WflDefinitionDraft) {
    await workflowDraftRepository.delete(draft)
    await loadWflDrafts()
  }

  async function trialWflDefinition(draft: WflDefinitionDraft) {
    try {
      const result = await trialTargetWflDefinition(csrfToken.value, {
        script: draft.script,
        document: draft.trialDocument,
      })
      draft.trialSucceeded = true
      draft.updatedAt = new Date().toISOString()
      await workflowDraftRepository.save(draft)
      message.value = result ? '流程试运行成功。' : '流程试运行完成。'
    } catch (error) {
      setError(error, '流程试运行失败；草稿仍保留。')
    }
  }

  async function submitWflDefinitionDraft(draft: WflDefinitionDraft) {
    if (!draft.trialSucceeded || !canSubmitWflDefinitionDraft.value) {
      message.value = '请先以当前草稿完成试运行，并确认具备提交流程定义的权限。'
      return
    }
    try {
      await submitTargetWflDefinition(csrfToken.value, 'NEW', {
        subjectId: draft.subjectId,
        submissionId: draft.submissionId,
        idempotencyKey: draft.submissionId,
        expectedLatestApprovedSubmissionId:
          draft.expectedLatestApprovedSubmissionId,
        expectedLatestApprovedRevision: draft.expectedLatestApprovedRevision,
        script: draft.script,
        trialDocument: draft.trialDocument,
      })
      await workflowDraftRepository.delete(draft)
      await Promise.all([loadWflDrafts(), loadWflDefinitions()])
      message.value = '流程定义已提交；本地草稿已删除。'
    } catch (error) {
      setError(error, '流程定义提交失败；本地草稿仍保留。')
    }
  }

  async function reviewWflDefinition(
    definition: WflDefinitionView,
    action: ApprovalAction,
  ) {
    if (!canReviewWflDefinition(definition, action)) return
    const reason = wflReasons.value[definition.submissionId]?.trim() ?? ''
    if ((action === 'reject' || action === 'unapprove') && !reason) {
      message.value = '请填写审批原因。'
      return
    }
    try {
      await reviewTargetWflDefinition(csrfToken.value, action, {
        subjectId: definition.subjectId,
        submissionId: definition.submissionId,
        expectedRevision: definition.revision,
        ...((action === 'reject' || action === 'unapprove') && { reason }),
      })
      await loadWflDefinitions()
      message.value = `流程定义已${approvalActionPresentation[action].label}。`
    } catch (error) {
      setError(error, '流程定义审批失败。')
      await loadWflDefinitions()
    }
  }

  function canReviewWflDefinition(
    definition: WflDefinitionView,
    action: ApprovalAction,
  ) {
    return definition.availableApprovalActions.includes(action)
  }

  async function setWflDefinitionEnabled(
    definition: WflDefinitionView,
    enabled: boolean,
  ) {
    const action = enabled ? 'enable' : 'disable'
    if (!permissions.value.includes(`/dcl/wfl-process-definition/${action}`))
      return
    try {
      await setTargetWflDefinitionEnabled(csrfToken.value, action, {
        subjectId: definition.subjectId,
        approvalEntryId: definition.submissionId,
        expectedApprovalRevision: definition.revision,
        expectedRuntimeRevision: definition.runtimeRevision,
      })
      await loadWflDefinitions()
      message.value = enabled ? '流程定义已启用。' : '流程定义已停用。'
    } catch (error) {
      setError(error, '流程定义启停失败。')
      await loadWflDefinitions()
    }
  }

  async function loadWflCurrentDefinitions() {
    if (!permissions.value.includes('/wfl/process-definition/query')) return
    try {
      const result: unknown = await queryTargetWflCurrentDefinitions(
        csrfToken.value,
      )
      const items =
        isRecord(result) && Array.isArray(result.items) ? result.items : result
      wflCurrentDefinitions.value = Array.isArray(items)
        ? items.filter(isWflCurrentDefinitionView)
        : []
    } catch (error) {
      setError(error, '当前流程定义查询失败。')
    }
  }

  async function selectWflCurrentDefinition(code: string) {
    try {
      wflCurrentDefinition.value = parseWflCurrentDefinitionView(
        await getTargetWflCurrentDefinition(csrfToken.value, code),
      )
    } catch (error) {
      setError(error, '当前流程定义读取失败。')
    }
  }

  async function loadWflInstances() {
    if (!permissions.value.includes('/wfl/process-instance/query')) return
    try {
      const result: unknown = await queryTargetWflInstances(csrfToken.value)
      wflInstances.value =
        isRecord(result) && Array.isArray(result.items)
          ? result.items.filter(isWflInstanceView)
          : []
    } catch (error) {
      setError(error, '流程实例查询失败。')
    }
  }

  async function selectWflInstance(processId: string) {
    try {
      wflInstance.value = parseWflInstanceView(
        await getTargetWflInstance(csrfToken.value, processId),
      )
    } catch (error) {
      setError(error, '流程实例读取失败。')
    }
  }

  async function actionWflInstance(
    node: WflInstanceNodeView,
    action: string,
    targetNodeKey?: string,
  ) {
    const instance = wflInstance.value
    if (!instance || !canActionWflInstance(node, action)) return
    const reason = wflReasons.value[node.nodeId]?.trim() ?? ''
    if (action === 'REJECT_CHILD' && !reason) {
      message.value = '请填写审批原因。'
      return
    }
    const requestKey = wflRequestKeys.value[node.nodeId] || createTargetId()
    wflRequestKeys.value[node.nodeId] = requestKey
    try {
      wflInstance.value = parseWflInstanceView(
        await actionTargetWflInstance(csrfToken.value, {
          processId: instance.processId,
          nodeId: node.nodeId,
          action,
          ...(targetNodeKey && { targetNodeKey, requestKey }),
          ...(node.revision &&
            action !== 'OPEN_DOCUMENT' &&
            action !== 'CREATE_CHILD' && { expectedRevision: node.revision }),
          ...(action === 'REJECT_CHILD' && { reason }),
        }),
      )
      await loadWflInstances()
      message.value = '流程实例动作已完成。'
    } catch (error) {
      setError(error, '流程实例动作失败。')
      await selectWflInstance(instance.processId)
    }
  }

  function canActionWflInstance(node: WflInstanceNodeView, action: string) {
    return node.availableActions.includes(action)
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

  async function loadWarehouseDeepLink() {
    if (window.location.pathname !== '/dcl/warehouse') return
    const parameters = new URLSearchParams(window.location.search)
    const subjectId = parameters.get('objectId')?.trim()
    const mode = parameters.get('mode')
    if (!subjectId || (mode !== 'view' && mode !== 'edit')) return
    try {
      const detail = await getTargetWarehouse(csrfToken.value, subjectId)
      warehouses.value = [
        detail,
        ...warehouses.value.filter((item) => item.subjectId !== subjectId),
      ]
      if (mode === 'edit') await cloneSubmission(detail)
    } catch (error) {
      setError(error, '工作台仓库深链读取失败。')
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
    if (!deepLink) return
    try {
      if (!deepLink.objectId) {
        archiveQueryKeyword.value = deepLink.code
        await queryArchive(1, false)
        const subject = archiveSubmissions.value.find(
          (submission) => submission.code === deepLink.code,
        )
        if (!subject) throw new Error('archive_deep_link_submission_not_found')
        await loadArchiveHistory(
          'rpt-definition',
          subject.subjectId,
          deepLink.approvalEntryId,
        )
        return
      }
      const detail = requiredArchiveSubmission(
        archiveEntity.value,
        await getTargetArchive(
          csrfToken.value,
          archiveEntity.value,
          deepLink.objectId,
          archiveEntity.value === 'rpt-definition'
            ? deepLink.approvalEntryId
            : undefined,
        ),
      )
      archiveHistory.value = { detail, versions: [], audit: [] }
      if (deepLink.mode === 'edit') {
        archiveQueryKeyword.value = deepLink.code
        await queryArchive(1, false)
        const subject = archiveSubmissions.value.find(
          (submission) => submission.submissionId === deepLink.approvalEntryId,
        )
        if (!subject) throw new Error('archive_deep_link_submission_not_found')
        await cloneArchiveSubmission(subject)
      }
    } catch (error) {
      setError(error, '工作台档案深链读取失败。')
    }
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
  workbenchPage,
  workbenchActiveTab,
  workbenchDocumentState,
  workbenchArchiveState,
  workbenchActiveState,
  workbenchReasons,
    warehouses,
    drafts,
    reason,
    signedIn,
    modelCorpusResult,
  signIn,
  queryUsers,
  queryWorkbench,
  switchWorkbenchTab,
  applyWorkbenchFilters,
  resetWorkbenchFilters,
    retryWorkbench,
    reviewWorkbench,
    deleteWorkbench,
    workbenchItemHref,
    visibleWorkbenchActions,
    workbenchActionLabel,
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
    vouReasons,
    userCreatableVouEntities,
    canCreateVouDraft,
    newVouDraft,
    saveVouDraft,
    addVouAttachment,
    submitVouDraft,
    vouInputs,
    vouArrayInputs,
    vouInputTestId,
    vouInputLabel,
    targetWireValueLabel,
    vouInputCandidates,
    vouInputValue,
    updateVouInput,
    selectVouInputCandidate,
    selectVouArrayVariant,
    appendVouArrayItem,
    vouAttachmentCount,
    canReviewVou,
    reviewVou,
    deleteVou,
    cloneVouSubmission,
    accMappingCatalog,
    accMappingPage,
    accMappingCurrent,
    accBookId,
    accSubjectCode,
    accSubjectName,
    accSubjectDirection,
    accVouEntity,
    accBookPage,
    accSubjectPage,
    accOpeningPage,
    accPeriodPage,
    wflDefinitionPage,
    wflCurrentPage,
    wflInstancePage,
    accBooks,
    accSubjects,
    openingDrafts,
    accOpening,
    accPeriods,
    accPeriodMonth,
    accReason,
    wflDrafts,
    wflDefinitions,
    wflCurrentDefinitions,
    wflCurrentDefinition,
    wflInstances,
    wflInstance,
    wflReasons,
    wflRequestKeys,
    canQueryAccMapping,
    canGetAccMapping,
    canQueryAccBooks,
    canCreateAccBook,
    canSaveAccBook,
    canCreateAccSubject,
    canSaveAccSubject,
    canCreateOpeningDraft,
    canQueryWflDefinitions,
    canCreateWflDefinitionDraft,
    canSubmitWflDefinitionDraft,
    queryAccMappingCurrent,
    selectAccMappingCurrent,
    createAccBook,
    saveAccBook,
    deleteAccBook,
    selectAccBook,
    createAccSubject,
    saveAccSubject,
    deleteAccSubject,
    newOpeningDraft,
    saveOpeningDraft,
    addOpeningLine,
    deleteOpeningLine,
    openingCollectionJson,
    updateOpeningCollection,
    updateOpeningDimensions,
    openingQuantity,
    updateOpeningQuantity,
    deleteOpeningDraft,
    submitOpeningDraft,
    reviewAccOpening,
    canReviewAccOpening,
    deleteAccOpening,
    setAccPeriod,
    newWflDefinitionDraft,
    saveWflDefinitionDraft,
    deleteWflDefinitionDraft,
    trialWflDefinition,
    submitWflDefinitionDraft,
    reviewWflDefinition,
    canReviewWflDefinition,
    setWflDefinitionEnabled,
    selectWflCurrentDefinition,
    selectWflInstance,
    actionWflInstance,
    canActionWflInstance,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function vouCandidateEntities(entity: VouEntity) {
  const candidates = new Set<VouReferenceCandidateEntity>()
  const visit = (fields: readonly VouInputFieldDescriptor[]) => {
    for (const field of fields) {
      if (field.referenceEntity) candidates.add(field.referenceEntity)
      for (const allowed of field.allowedEntities ?? []) candidates.add(allowed)
      if (field.fields) visit(field.fields)
      if (field.item) visit(field.item)
    }
  }
  visit(vouEntityInputDescriptors[entity])
  return [...candidates]
}

function vouReferencePermissions(entity: VouEntity) {
  const candidates = vouCandidateEntities(entity)
  return candidates.length ? ['/vou/reference/query'] : []
}

function referenceCandidate(
  entity: VouReferenceCandidateEntity,
  value: unknown,
): VouReferenceCandidate[] {
  if (
    !isRecord(value) ||
    typeof value.objectId !== 'string' ||
    typeof value.code !== 'string' ||
    typeof value.name !== 'string'
  )
    return []
  return [
    {
      entity,
      objectId: value.objectId,
      ...(typeof value.approvalEntryId === 'string' && {
        approvalEntryId: value.approvalEntryId,
      }),
      code: value.code,
      name: value.name,
    },
  ]
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED'
}

function isApprovalAction(value: unknown): value is ApprovalAction {
  return (
    value === 'approve' ||
    value === 'reject' ||
    value === 'unreject' ||
    value === 'unapprove'
  )
}

function isAccBookView(value: unknown): value is AccBookView {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.startMonth === 'string' &&
    typeof value.baseCurrency === 'string' &&
    typeof value.controlBook === 'boolean' &&
    typeof value.revision === 'string'
  )
}

function isAccSubjectView(value: unknown): value is AccSubjectView {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.bookId === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    (value.balanceDirection === 'DEBIT' ||
      value.balanceDirection === 'CREDIT') &&
    typeof value.enabled === 'boolean' &&
    (typeof value.parentId === 'string' || value.parentId === null) &&
    Array.isArray(value.requiredDimensions) &&
    value.requiredDimensions.every((item) => typeof item === 'string') &&
    typeof value.inventoryQuantity === 'boolean' &&
    typeof value.settlementPurpose === 'string' &&
    typeof value.revision === 'string'
  )
}

function isAccPeriodView(value: unknown): value is AccPeriodView {
  return (
    isRecord(value) &&
    typeof value.bookId === 'string' &&
    typeof value.month === 'string' &&
    typeof value.locked === 'boolean' &&
    typeof value.revision === 'string'
  )
}

function parseAccOpeningView(value: unknown): AccOpeningView | null {
  if (
    !isRecord(value) ||
    typeof value.bookId !== 'string' ||
    typeof value.submissionId !== 'string' ||
    !isRecord(value.approval) ||
    !isApprovalStatus(value.approval.status) ||
    typeof value.approval.revision !== 'string' ||
    !isRecord(value.payload) ||
    !Array.isArray(value.availableApprovalActions)
  )
    return null
  return {
    bookId: value.bookId,
    submissionId: value.submissionId,
    approval: {
      status: value.approval.status,
      revision: value.approval.revision,
    },
    payload: value.payload as unknown as OpeningDraft,
    availableApprovalActions:
      value.availableApprovalActions.filter(isApprovalAction),
  }
}

function isWflDefinitionView(value: unknown): value is WflDefinitionView {
  return (
    isRecord(value) &&
    typeof value.subjectId === 'string' &&
    typeof value.submissionId === 'string' &&
    typeof value.code === 'string' &&
    typeof value.versionNo === 'number' &&
    isApprovalStatus(value.status) &&
    typeof value.revision === 'string' &&
    typeof value.script === 'string' &&
    isRecord(value.compiledGraph) &&
    typeof value.compiledGraph.code === 'string' &&
    typeof value.compiledGraph.name === 'string' &&
    typeof value.enabled === 'boolean' &&
    (typeof value.runtimeRevision === 'string' ||
      value.runtimeRevision === null) &&
    Array.isArray(value.availableApprovalActions)
  )
}

function flattenWflDefinitions(value: unknown): WflDefinitionView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    return [item.latestApproved, item.openCandidate].filter(isWflDefinitionView)
  })
}

function isWflCurrentDefinitionView(
  value: unknown,
): value is WflCurrentDefinitionView {
  return (
    isRecord(value) &&
    typeof value.subjectId === 'string' &&
    typeof value.approvalEntryId === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    typeof value.enabled === 'boolean' &&
    isRecord(value.compiledGraph) &&
    typeof value.compiledGraph.code === 'string' &&
    typeof value.compiledGraph.name === 'string'
  )
}

function parseWflCurrentDefinitionView(
  value: unknown,
): WflCurrentDefinitionView | null {
  return isWflCurrentDefinitionView(value) ? value : null
}

function isWflInstanceView(value: unknown): value is WflInstanceView {
  return (
    isRecord(value) &&
    typeof value.processId === 'string' &&
    typeof value.definitionCode === 'string' &&
    typeof value.definitionName === 'string' &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.availableTargets)
  )
}

function parseWflInstanceView(value: unknown): WflInstanceView | null {
  return isWflInstanceView(value) ? value : null
}

function previousMonthText() {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - 1)
  return date.toISOString().slice(0, 7)
}

function defaultWflScript() {
  return 'root = node(key="root", name="销售订单", entity="sale-order")\nworkflow(code="local-flow", name="本地流程", root=root, edges=[])'
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
  return entity && userCreatableVouEntities.includes(entity as never)
    ? (entity as VouEntity)
    : null
}

function createVouDraftPayload(entity: VouEntity): VouDraft['payload'] {
  return createModelVouDraftPayload(
    entity,
    createTargetId,
  ) as VouDraft['payload']
}

function compactVouDraftPayload(
  entity: VouEntity,
  payload: VouDraft['payload'],
): VouDraft['payload'] {
  const requiredTopLevelFields = new Set(
    vouEntityInputDescriptors[entity]
      .filter((field) => field.required)
      .map((field) => field.key),
  )
  const compact = (value: unknown, depth = 0): unknown => {
    if (Array.isArray(value))
      return value.map((item) => compact(item, depth + 1))
    if (!isRecord(value)) return value
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nested]) => {
        const next = compact(nested, depth + 1)
        if (next === '') return []
        if (
          isRecord(next) &&
          Object.keys(next).length === 0 &&
          !(depth === 0 && requiredTopLevelFields.has(key))
        )
          return []
        return [[key, next]]
      }),
    )
  }
  return compact(payload) as VouDraft['payload']
}

function isVouSubmissionView(value: unknown): value is VouSubmissionView {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.entity === 'string' &&
    typeof item.documentId === 'string' &&
    typeof item.submissionId === 'string' &&
    typeof item.documentNo === 'string' &&
    typeof item.revision === 'string' &&
    (item.status === 'PENDING' ||
      item.status === 'APPROVED' ||
      item.status === 'REJECTED') &&
    !!item.payload &&
    typeof item.payload === 'object' &&
    Array.isArray(item.availableApprovalActions) &&
    typeof item.canDelete === 'boolean'
  )
}

function archiveDeepLinkFromLocation(): {
  objectId?: string
  code: string
  approvalEntryId: string
  mode?: 'view' | 'edit'
} | null {
  const entity = window.location.pathname.match(/^\/dcl\/([^/]+)\/?$/)?.[1]
  if (!targetArchiveEntities.includes(entity as TargetArchiveEntity))
    return null
  const parameters = new URLSearchParams(window.location.search)
  const objectId = parameters.get('objectId')?.trim() ?? ''
  const code = parameters.get('code')?.trim() ?? ''
  const approvalEntryId = parameters.get('approvalEntryId')?.trim() ?? ''
  const mode = parameters.get('mode')
  if (
    objectId &&
    code &&
    approvalEntryId &&
    (mode === 'view' || mode === 'edit')
  )
    return { objectId, code, approvalEntryId, mode }
  if (entity === 'rpt-definition' && code && approvalEntryId)
    return { code, approvalEntryId }
  return null
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
  return targetErrorPresentation[error.errorKey] ?? (error.message || fallback)
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
