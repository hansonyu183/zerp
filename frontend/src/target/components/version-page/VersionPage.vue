<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import RowActions from '../dynamic-fields/RowActions.vue'
import type { RowAction } from '../dynamic-fields/types.ts'
import DynamicCols from '../dynamic-fields/DynamicCols.vue'
import ListPagination from '../list-page/ListPagination.vue'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import {
  computed,
  provide,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toRaw,
} from 'vue'
import { ulid } from 'ulid'
import { approvalStatusPresentation } from '@zerp/model'
import { TargetApiError } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import { resourceDisplayName } from '../../navigation/resources.ts'
import ManagementPageFrame from '../ManagementPageFrame.vue'
import { DynamicForm } from '../dynamic-fields/index.ts'
import { createAttachments, attachmentScope } from './attachments.ts'
import WflScriptBlock from './WflScriptBlock.vue'
import WflGraphBlock from './WflGraphBlock.vue'
import { wflErrors, type WflData } from './wfl-data.ts'
import ProductDetailsEditor from './ProductDetailsEditor.vue'
import type { ProductSnapshot } from './product-data.ts'
import CustomerPricingDifference from './CustomerPricingDifference.vue'
import CustomerDetailsEditor from './CustomerDetailsEditor.vue'
import type { CustomerSnapshot } from './customer-data.ts'
import IdentityAssociations from './IdentityAssociations.vue'
import type { SupplierData, OtherUnitData, SalesPartnerData } from '@zerp/model'
import EditForm from '../dynamic-fields/EditForm.vue'
import { extraSnapshotDetails } from './snapshot-details.ts'
import DetailsBlock from './DetailsBlock.vue'
import HistoryBlock from './HistoryBlock.vue'
import type { EditValues } from '../dynamic-fields/edit-fields.ts'
import type {
  VersionDefinition,
  VersionCurrent,
  VersionSubmission,
  VersionQuery,
  VersionSubmissionItem,
} from './definition.ts'
import type { ArchiveSubmissionCommand } from './metadata.ts'
import {
  describeBobArchiveFailure,
  describeBobEnablementFailure,
} from './errors.ts'
import type { ArchiveReviewAction, ArchiveAuditEvent } from './metadata.ts'
type Snapshot = Record<string, unknown>
type Current = VersionCurrent<Snapshot>
type Submission = VersionSubmission<Snapshot>
type SubmissionItem = VersionSubmissionItem<Snapshot>
const props = defineProps<{ definition: VersionDefinition }>()
const definition = props.definition
const adapter = definition.adapter
const session = useTargetSession()
const generation = session.generation
let active = true,
  queryRequest = 0,
  detailRequest = 0,
  editorRequest = 0
const owns = () => active && session.generation === generation
const can = (action: string) =>
  owns() && session.can(`/${definition.resource}/${action}`)
const token = (action: string) => {
  if (!can(action) || !session.csrfToken)
    throw new Error('当前账号没有此操作权限。')
  return session.csrfToken
}
const [domain, entity] = definition.resource.split('/')
const title = resourceDisplayName(domain!, entity!)
const tab = ref<'current' | 'submissions'>('current')
const filter = ref({ keyword: '' })
const query = shallowRef<VersionQuery>({ keyword: '', page: 1, pageSize: 20 })
const rows = shallowRef<readonly Current[]>([]),
  candidates = shallowRef<readonly SubmissionItem[]>([])
function currentActions(item: Current): RowAction[] {
  const actions: RowAction[] = []
  if (can('get')) actions.push({ key: 'view', caption: '查看' })
  if (
    canCreate.value &&
    (definition.resource !== 'wfl/process-definition' || can('submission-get'))
  )
    actions.push({
      key: 'clone',
      caption: '克隆',
      disabled: locked.value || loading.value,
    })
  if (canChange.value)
    actions.push({ key: 'submit', caption: '提交变更', disabled: locked.value })
  const enablement = item.enabled ? 'disable' : 'enable'
  if (adapter.setEnabled && can(enablement))
    actions.push({
      key: enablement,
      caption: item.enabled ? '停用' : '启用',
      disabled: locked.value,
    })
  return actions
}
function runCurrentAction(key: string, item: Current) {
  if (key === 'view') void openCurrent(item)
  else if (key === 'clone') void cloneCurrent(item)
  else if (key === 'submit') void change(item)
  else if (key === 'enable' || key === 'disable') void toggle(item)
}
const submissionRows = computed(() =>
  candidates.value.map((item) => ({
    ...item,
    code: item.code ?? '待编',
    candidateStatus: item.openCandidate
      ? approvalStatusPresentation[item.openCandidate.status].label
      : '无',
    approvedVersion: item.latestApproved
      ? String(item.latestApproved.versionNo)
      : '无',
  })),
)
const total = ref(0),
  querying = ref(false),
  queryError = ref('')
const open = ref(false),
  busy = ref(false),
  loading = ref(false),
  error = ref(''),
  feedback = ref('')
const draft = shallowRef<Snapshot>({})
const mode = ref<'create' | 'change'>('create')
const customerEditor = computed(() => {
  const {
    defaultOperatingEntity,
    remittanceProfiles,
    identityAttachments,
    subunits,
  } = draft.value as unknown as CustomerSnapshot
  return {
    defaultOperatingEntity,
    remittanceProfiles,
    identityAttachments,
    subunits,
  }
})
const productEditor = computed(() => {
  const {
    productType,
    productCategory,
    pricingUnit,
    defaultInputUnit,
    unitConversions,
    defaultPackagingSpec,
    recyclable,
    fixedFormula,
  } = draft.value as unknown as ProductSnapshot
  return {
    productType,
    productCategory,
    pricingUnit,
    defaultInputUnit,
    unitConversions,
    defaultPackagingSpec,
    recyclable,
    fixedFormula,
  }
})
const identityEditor = computed(() => {
  const value = draft.value as unknown as
    SupplierData | OtherUnitData | SalesPartnerData
  return {
    operatingEntities: value.operatingEntities,
    defaultOperatingEntityId: value.defaultOperatingEntityId,
    ...('settlementMethod' in value
      ? { settlementMethod: value.settlementMethod }
      : {}),
    ...('defaultPurchaser' in value
      ? { defaultPurchaser: value.defaultPurchaser }
      : {}),
    ...('capabilities' in value ? { capabilities: value.capabilities } : {}),
  }
})

const detailOpen = ref(false),
  detailLoading = ref(false),
  detailError = ref('')
const currentDetail = shallowRef<Current | null>(null),
  selected = shallowRef<Submission | null>(null)
const versions = shallowRef<readonly Submission[]>([]),
  audits = shallowRef<readonly ArchiveAuditEvent[]>([])
const reason = ref(''),
  confirmDelete = ref(false)
let intent: ArchiveSubmissionCommand<Snapshot> | null = null
// The unresolved write belongs to the page, not a closable editor/history dialog.
type Pending =
  | { kind: 'submit'; command: ArchiveSubmissionCommand<Snapshot> }
  | { kind: 'review'; action: ArchiveReviewAction; submission: Submission }
  | { kind: 'toggle'; item: Current; enabled: boolean }
  | { kind: 'version-toggle'; submission: Submission; enabled: boolean }
const pending = shallowRef<Pending | null>(null)
const locked = computed(() => busy.value || pending.value !== null)
const attachments = createAttachments(
  'bob/customer',
  () => token('attachment-stage'),
  owns,
)
provide(attachmentScope, attachments.scope)
const attachmentReading = ref(false)
const canCreate = computed(
  () =>
    can('submit-new') &&
    (definition.resource !== 'bob/customer' || can('save-subunits')),
)
const canChange = computed(() => can('submit-change') && can('versions'))
const previousVersion = computed(() =>
  selected.value
    ? [...versions.value]
        .filter(
          (v) =>
            v.submissionId !== selected.value!.submissionId &&
            v.versionNo !== null &&
            (selected.value!.versionNo === null ||
              v.versionNo < selected.value!.versionNo),
        )
        .sort((a, b) => (b.versionNo ?? -1) - (a.versionNo ?? -1))[0]
    : undefined,
)
const previous = computed(() => previousVersion.value?.snapshot)
const previousAttachmentSource = computed(() =>
  previousVersion.value
    ? {
        source: 'submission' as const,
        subjectId: previousVersion.value.subjectId,
        submissionId: previousVersion.value.submissionId,
      }
    : undefined,
)
const historyVersions = computed(() =>
  versions.value.map(
    ({ subjectId, submissionId, versionNo, status, submittedAt }) => ({
      subjectId,
      submissionId,
      versionNo,
      status,
      submittedAt,
    }),
  ),
)
function pricingSubunits(snapshot: Snapshot | undefined) {
  return (
    (snapshot as unknown as CustomerSnapshot | undefined)?.subunits.map(
      ({ id, code, name, pricingPolicy }) => ({
        id,
        code,
        name,
        pricingPolicy,
      }),
    ) ?? []
  )
}
const customerPricingBefore = computed(() =>
  definition.resource === 'bob/customer' ? pricingSubunits(previous.value) : [],
)
const customerPricingAfter = computed(() =>
  definition.resource === 'bob/customer'
    ? pricingSubunits(selected.value?.snapshot)
    : [],
)
const detailFields = [
  ...definition.fields,
  ...extraSnapshotDetails[definition.resource],
]
const reviewLabels = {
  approve: '批准',
  reject: '驳回',
  unreject: '恢复审核',
  unapprove: '反批准',
  delete: '删除候选',
} as const
const reviewActions = computed(() =>
  selected.value
    ? (Object.keys(reviewLabels) as ArchiveReviewAction[]).filter(
        (action) =>
          can(action) &&
          (action === 'delete'
            ? selected.value!.canDelete
            : selected.value!.availableApprovalActions.includes(action)),
      )
    : [],
)
const needsReason = computed(
  () =>
    reviewActions.value.includes('reject') ||
    reviewActions.value.includes('unapprove'),
)
function message(cause: unknown) {
  return (
    (cause instanceof TargetApiError ? wflErrors[cause.errorKey] : null) ??
    describeBobArchiveFailure(cause) ??
    (cause instanceof Error ? cause.message : '操作失败。')
  )
}
async function read(input = query.value, nextTab = tab.value): Promise<void> {
  const action = nextTab === 'current' ? 'query' : 'submission-query'
  if (!can(action)) return
  const request = ++queryRequest
  const snapshot = { ...input }
  querying.value = true
  queryError.value = ''
  try {
    if (nextTab === 'current') {
      const result = await adapter.query(token(action), snapshot)
      if (!owns() || request !== queryRequest) return
      rows.value = result.items
      total.value = result.total
    } else {
      const result = await adapter.submissions(token(action), snapshot)
      if (!owns() || request !== queryRequest) return
      candidates.value = result.items
      total.value = result.total
    }
    query.value = snapshot
  } catch (cause) {
    if (owns() && request === queryRequest) {
      queryError.value = message(cause)
      throw cause
    }
  } finally {
    if (owns() && request === queryRequest) querying.value = false
  }
}
async function search() {
  try {
    await read({
      ...query.value,
      keyword: filter.value.keyword.trim(),
      page: 1,
    })
  } catch {
    /* visible query error */
  }
}
async function page(value: number) {
  try {
    await read({ ...query.value, page: value })
  } catch {
    /* visible query error */
  }
}
async function switchTab(value: 'current' | 'submissions') {
  queryRequest++
  tab.value = value
  rows.value = []
  candidates.value = []
  total.value = 0
  query.value = { keyword: '', page: 1, pageSize: 20 }
  filter.value = { keyword: '' }
  try {
    await read()
  } catch {
    /* visible query error */
  }
}
function create(source?: Snapshot) {
  if (locked.value || !canCreate.value) return
  editorRequest++
  attachments.reset()
  attachmentReading.value = false
  draft.value = source
    ? adapter.clone(structuredClone(toRaw(source)))
    : adapter.empty()
  mode.value = 'create'
  intent = {
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot: draft.value,
  }
  open.value = true
  loading.value = false
  error.value = ''
}
async function change(item: Current) {
  if (locked.value || !canChange.value) return
  const request = ++editorRequest
  attachments.reset()
  attachmentReading.value = false
  open.value = true
  loading.value = true
  draft.value = {}
  error.value = ''
  mode.value = 'change'
  intent = null
  try {
    const result = await adapter.versions(token('versions'), item.objectId)
    if (!owns() || request !== editorRequest) return
    const approved = [...result.items]
      .filter((v) => v.status === 'APPROVED')
      .sort((a, b) => (b.versionNo ?? -1) - (a.versionNo ?? -1))[0]
    if (!approved) {
      error.value = '没有可编辑的正式版本。'
      return
    }
    draft.value = structuredClone(toRaw(approved.snapshot))
    intent = {
      subjectId: item.objectId,
      submissionId: ulid(),
      idempotencyKey: ulid(),
      expectedLatestApprovedSubmissionId: approved.submissionId,
      expectedLatestApprovedRevision: approved.revision,
      snapshot: draft.value,
    }
  } catch (cause) {
    if (owns() && request === editorRequest) error.value = message(cause)
  } finally {
    if (owns() && request === editorRequest) loading.value = false
  }
}
function cloneSelected() {
  if (!selected.value || locked.value || !canCreate.value) return
  create(selected.value.snapshot)
  closeDetail()
}
function close() {
  if (busy.value) return
  editorRequest++
  attachments.reset()
  attachmentReading.value = false
  open.value = false
  loading.value = false
  draft.value = {}
  intent = null
}
function closeDetail() {
  detailRequest++
  detailOpen.value = false
  selected.value = null
  currentDetail.value = null
  versions.value = []
  audits.value = []
  reason.value = ''
  confirmDelete.value = false
}
async function openCurrent(item: Current) {
  if (!can('get')) return
  closeDetail()
  const request = ++detailRequest
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  try {
    const result = await adapter.current(
      token('get'),
      definition.resource === 'wfl/process-definition'
        ? item.code
        : item.objectId,
    )
    if (owns() && request === detailRequest) currentDetail.value = result
  } catch (cause) {
    if (owns() && request === detailRequest) detailError.value = message(cause)
  } finally {
    if (owns() && request === detailRequest) detailLoading.value = false
  }
}
async function readHistory(subjectId: string, request: number) {
  const tasks: Promise<void>[] = []
  if (can('versions'))
    tasks.push(
      adapter.versions(token('versions'), subjectId).then((result) => {
        if (owns() && request === detailRequest) versions.value = result.items
      }),
    )
  if (can('audit-history'))
    tasks.push(
      adapter.audit(token('audit-history'), subjectId).then((result) => {
        if (owns() && request === detailRequest) audits.value = result
      }),
    )
  const results = await Promise.allSettled(tasks)
  if (owns() && request === detailRequest) {
    const failed = results.filter((result) => result.status === 'rejected')
    if (failed.length)
      detailError.value = failed
        .map((result) => message(result.reason))
        .join('；')
  }
}
async function select(
  item: { subjectId: string; submissionId: string },
  history = false,
) {
  if (!can('submission-get') && !can('versions')) return
  const request = ++detailRequest
  selected.value = null
  currentDetail.value = null
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  reason.value = ''
  confirmDelete.value = false
  if (history) {
    versions.value = []
    audits.value = []
  }
  try {
    const tasks: Promise<void>[] = []
    if (can('submission-get'))
      tasks.push(
        adapter
          .submission(token('submission-get'), {
            subjectId: item.subjectId,
            submissionId: item.submissionId,
          })
          .then((result) => {
            if (owns() && request === detailRequest) selected.value = result
          }),
      )
    if (history) tasks.push(readHistory(item.subjectId, request))
    await Promise.all(tasks)
    if (owns() && request === detailRequest && !can('submission-get'))
      selected.value =
        versions.value.find(
          (version) => version.submissionId === item.submissionId,
        ) ?? null
  } catch (cause) {
    if (owns() && request === detailRequest) detailError.value = message(cause)
  } finally {
    if (owns() && request === detailRequest) detailLoading.value = false
  }
}
function openCandidate(item: SubmissionItem) {
  const candidate = item.openCandidate ?? item.latestApproved
  if (candidate) void select(candidate, true)
}
async function refreshAfterWrite() {
  try {
    await read()
  } catch {
    if (owns()) feedback.value = '操作已成功，但列表刷新失败；请重新查询。'
  }
}
async function write<T>(
  operation: () => Promise<T>,
  identity: Pending,
  apply: (result: T) => void,
) {
  if (locked.value) return
  // Invalidate earlier reads before accepting a write; their snapshots must not restore stale rows.
  queryRequest++
  querying.value = false
  busy.value = true
  error.value = ''
  feedback.value = ''
  try {
    const result = await operation()
    if (!owns()) return
    apply(result)
    pending.value = null
    feedback.value = '操作成功。'
    await refreshAfterWrite()
  } catch (cause) {
    if (!owns()) return
    const unknown =
      !(cause instanceof TargetApiError) ||
      cause.errorKey === 'invalid_response'
    if (unknown) pending.value = identity
    error.value =
      (identity.kind === 'toggle'
        ? (describeBobEnablementFailure(cause) ?? message(cause))
        : message(cause)) + (unknown ? ' 操作结果未知，请先核实后再继续。' : '')
  } finally {
    if (owns()) busy.value = false
  }
}
async function submit() {
  const action = mode.value === 'create' ? 'submit-new' : 'submit-change'
  if (
    !intent ||
    locked.value ||
    loading.value ||
    attachmentReading.value ||
    !can(action)
  )
    return
  const invalid = adapter.validate(draft.value)
  if (invalid) {
    error.value = invalid
    return
  }
  const command = { ...intent, snapshot: structuredClone(toRaw(draft.value)) }
  intent = command
  if (definition.resource === 'bob/customer') {
    const request = editorRequest
    busy.value = true
    try {
      const customer = command.snapshot as unknown as CustomerSnapshot
      await attachments.prepare([
        ...customer.identityAttachments,
        ...customer.subunits.flatMap((item) => item.attachments),
      ])
    } catch (cause) {
      if (owns()) error.value = message(cause)
      return
    } finally {
      if (owns()) busy.value = false
    }
    if (!owns() || request !== editorRequest) return
  }
  await write(
    () =>
      mode.value === 'create'
        ? adapter.submitNew(token(action), command)
        : adapter.submitChange(token(action), command),
    { kind: 'submit', command },
    () => {
      open.value = false
      draft.value = {}
      intent = null
      attachments.reset()
      editorRequest++
    },
  )
}
async function review(action: ArchiveReviewAction) {
  const submission = selected.value
  if (!submission || !reviewActions.value.includes(action) || locked.value)
    return
  if ((action === 'reject' || action === 'unapprove') && !reason.value.trim()) {
    error.value = '请填写原因。'
    return
  }
  const input = {
    subjectId: submission.subjectId,
    submissionId: submission.submissionId,
    expectedRevision: submission.revision,
  }
  const request = detailRequest
  const operation = () =>
    action === 'reject' || action === 'unapprove'
      ? adapter[action](token(action), {
          ...input,
          reason: reason.value.trim(),
        })
      : adapter[action](token(action), input)
  await write(operation, { kind: 'review', action, submission }, (result) => {
    if (request !== detailRequest) return
    confirmDelete.value = false
    reason.value = ''
    selected.value = action === 'delete' ? null : (result as Submission)
    if (selected.value)
      versions.value = versions.value.map((item) =>
        item.submissionId === submission.submissionId ? selected.value! : item,
      )
    void readHistory(submission.subjectId, request)
  })
}
async function toggle(item: Current) {
  const enabled = !item.enabled,
    action = enabled ? 'enable' : 'disable'
  if (!can(action) || !adapter.setEnabled || !item.revision) return
  await write(
    () =>
      adapter.setEnabled!(
        token(action),
        { ...item, revision: item.revision! },
        enabled,
      ),
    { kind: 'toggle', item, enabled },
    () => {},
  )
}
async function toggleVersion(enabled: boolean) {
  const item = selected.value,
    action = enabled ? 'enable' : 'disable'
  if (
    !item ||
    !adapter.setVersionEnabled ||
    !can(action) ||
    !item.availableRuntimeActions?.includes(action)
  )
    return
  const request = detailRequest
  await write(
    () => adapter.setVersionEnabled!(token(action), item, enabled),
    { kind: 'version-toggle', submission: item, enabled },
    (result) => {
      if (request === detailRequest) selected.value = result
    },
  )
}
async function cloneCurrent(item: Current) {
  if (definition.resource !== 'wfl/process-definition') {
    create(item.data)
    return
  }
  if (
    locked.value ||
    !canCreate.value ||
    !can('submission-get') ||
    !item.sourceApprovalEntryId
  )
    return
  const request = ++editorRequest
  loading.value = true
  try {
    const result = await adapter.submission(token('submission-get'), {
      subjectId: item.objectId,
      submissionId: item.sourceApprovalEntryId,
    })
    if (owns() && request === editorRequest) create(result.snapshot)
  } catch (cause) {
    if (owns() && request === editorRequest) error.value = message(cause)
  } finally {
    if (owns()) loading.value = false
  }
}
const canVerify = computed(
  () =>
    pending.value &&
    can(pending.value.kind === 'toggle' ? 'get' : 'submission-get'),
)
async function verify() {
  const identity = pending.value
  if (!identity || busy.value || !canVerify.value) return
  busy.value = true
  error.value = ''
  try {
    let applied = false
    if (identity.kind === 'toggle') {
      const result = await adapter.current(token('get'), identity.item.objectId)
      applied =
        result.enabled === identity.enabled &&
        result.revision !== undefined &&
        BigInt(result.revision) === BigInt(identity.item.revision!) + 1n
    } else {
      const ref =
        identity.kind === 'submit' ? identity.command : identity.submission
      try {
        const result = await adapter.submission(token('submission-get'), {
          subjectId: ref.subjectId,
          submissionId: ref.submissionId,
        })
        if (identity.kind === 'submit')
          applied =
            result.subjectId === identity.command.subjectId &&
            result.submissionId === identity.command.submissionId
        else if (identity.kind === 'version-toggle')
          applied =
            result.enabled === identity.enabled &&
            result.runtimeRevision !== undefined &&
            result.runtimeRevision !== null &&
            BigInt(result.runtimeRevision) ===
              BigInt(identity.submission.runtimeRevision ?? '0') + 1n
        else if (identity.action !== 'delete') {
          const status = {
            approve: 'APPROVED',
            reject: 'REJECTED',
            unreject: 'PENDING',
            unapprove: 'PENDING',
          }[identity.action]
          applied =
            result.status === status &&
            BigInt(result.revision) ===
              BigInt(identity.submission.revision) + 1n
        }
      } catch (cause) {
        if (
          identity.kind === 'review' &&
          identity.action === 'delete' &&
          cause instanceof TargetApiError &&
          cause.errorKey === 'approval_not_found'
        )
          applied = true
        else throw cause
      }
    }
    if (!owns()) return
    if (!applied) {
      error.value = '当前事实尚不能确认此次写入，结果仍未知，保持锁定。'
      return
    }
    pending.value = null
    open.value = false
    draft.value = {}
    intent = null
    feedback.value = '已核实操作成功。'
    closeDetail()
    await refreshAfterWrite()
  } catch (cause) {
    if (owns()) error.value = `${message(cause)} 结果仍未知，保持锁定。`
  } finally {
    if (owns()) busy.value = false
  }
}
onMounted(() => {
  void read().catch(() => {})
})
onBeforeUnmount(() => {
  active = false
  attachments.reset()
  queryRequest++
  detailRequest++
  editorRequest++
  draft.value = {}
  intent = null
  pending.value = null
})
</script>
<template>
  <ManagementPageFrame :title="title">
    <template #actions
      ><v-btn
        :prepend-icon="actionIcons.create"
        v-if="canCreate"
        :disabled="locked"
        @click="create()"
        >新增{{ title }}</v-btn
      ><v-btn
        v-if="can('query')"
        :disabled="tab === 'current'"
        @click="switchTab('current')"
        >正式资料</v-btn
      ><v-btn
        v-if="can('submission-query')"
        :disabled="tab === 'submissions'"
        @click="switchTab('submissions')"
        >提交记录</v-btn
      ></template
    >
    <template #alerts
      ><v-alert v-if="error" type="error">{{ error }}</v-alert
      ><v-alert v-if="pending" type="warning"
        >操作结果未知，保持写入锁定。<v-btn
          :prepend-icon="actionIcons.resolve"
          v-if="canVerify"
          :disabled="busy"
          @click="verify"
          >核实结果</v-btn
        ></v-alert
      ><v-alert v-if="feedback" type="success">{{ feedback }}</v-alert
      ><v-alert v-if="queryError" type="error">{{ queryError }}</v-alert
      ><v-alert
        v-if="!can(tab === 'current' ? 'query' : 'submission-query')"
        type="info"
        >当前账号没有此列表读取权限。</v-alert
      ></template
    >
    <template #filters
      ><DynamicForm
        :fields="[
          { key: 'keyword', type: 'text', caption: '编码、拼音或名称' },
        ]"
        v-model="filter"
        :disabled="!can(tab === 'current' ? 'query' : 'submission-query')"
        @search="search"
    /></template>
    <DynamicCols
      v-if="tab === 'current'"
      identity-key="objectId"
      :items="rows"
      :loading="querying"
      :fields="[
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
      ]"
      ><template #actions="{ item }">
        <RowActions
          :actions="currentActions(item)"
          @action="runCurrentAction($event, item)" /></template
    ></DynamicCols>
    <DynamicCols
      v-else
      identity-key="subjectId"
      :items="submissionRows"
      :loading="querying"
      :fields="[
        { key: 'code', type: 'text', caption: '编码' },
        { key: 'candidateStatus', type: 'text', caption: '候选版本' },
        { key: 'approvedVersion', type: 'text', caption: '最新批准' },
        { key: '$actions', type: 'actions', caption: '操作' },
      ]"
      ><template #actions="{ item }"
        ><RowActions
          :actions="
            can('submission-get') || can('versions')
              ? [{ key: 'view', caption: '查看' }]
              : []
          "
          @action="openCandidate(item)" /></template
    ></DynamicCols>
    <template #footer
      ><ListPagination
        :pagination="{
          mode: 'total',
          page: query.page,
          pageSize: query.pageSize,
          total,
        }"
        :disabled="querying"
        @page="page"
    /></template>
  </ManagementPageFrame>
  <v-dialog :model-value="open" persistent max-width="1000"
    ><v-card :title="`${title}提交`"
      ><v-card-text
        ><v-alert v-if="error" type="error">{{ error }}</v-alert
        ><v-progress-linear v-if="loading" indeterminate /><EditForm
          v-if="open && !loading && intent"
          :fields="definition.fields"
          :model-value="draft as EditValues"
          :disabled="locked"
          @update:model-value="draft = $event"
          @submit="submit" /><WflScriptBlock
          v-if="
            open &&
            !loading &&
            intent &&
            definition.resource === 'wfl/process-definition'
          "
          :model-value="draft as unknown as WflData"
          :disabled="locked"
          @update:model-value="draft = { ...draft, ...$event }"
          @pending="attachmentReading = $event" /><ProductDetailsEditor
          @pending="attachmentReading = $event"
          v-if="
            open && !loading && intent && definition.resource === 'bob/product'
          "
          :model-value="productEditor"
          :disabled="locked"
          @update:model-value="
            draft = { ...draft, ...$event }
          " /><CustomerDetailsEditor
          @pending="attachmentReading = $event"
          v-if="
            open && !loading && intent && definition.resource === 'bob/customer'
          "
          :model-value="customerEditor"
          :disabled="locked"
          @update:model-value="
            draft = { ...draft, ...$event }
          " /><IdentityAssociations
          v-if="
            open &&
            !loading &&
            intent &&
            ['bob/supplier', 'bob/other-unit', 'bob/sales-partner'].includes(
              definition.resource,
            )
          "
          :model-value="identityEditor"
          :disabled="locked"
          @update:model-value="draft = { ...draft, ...$event }" /></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn
          :prepend-icon="actionIcons.cancel"
          :disabled="busy"
          @click="close"
          >取消</v-btn
        ><v-btn
          :prepend-icon="actionIcons.submit"
          :disabled="locked || loading || attachmentReading || !intent"
          @click="submit"
          >提交</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog :model-value="detailOpen" persistent max-width="1080"
    ><v-card :title="`${title}${currentDetail ? '正式资料' : '提交详情'}`"
      ><v-card-text
        ><v-progress-linear v-if="detailLoading" indeterminate /><v-alert
          v-if="detailError"
          type="error"
          >{{ detailError }}</v-alert
        ><v-alert v-if="error" type="error">{{ error }}</v-alert>
        <HistoryBlock
          v-if="versions.length || audits.length"
          :versions="historyVersions"
          :audits="audits"
          :selected-id="selected?.submissionId ?? null"
          @select="select($event)"
        />
        <template v-if="selected">
          <p>
            版本：{{ selected.versionNo ?? '待分配' }} · 状态：{{
              approvalStatusPresentation[selected.status].label
            }}
            · 修订：{{ selected.revision }}
          </p>
          <FieldInput
            usage="edit"
            :field="{
              key: 'reason',
              type: 'textarea',
              caption: '驳回或反批准原因',
            }"
            v-if="needsReason"
            v-model="reason"
            :disabled="locked" />
          <div class="version-actions">
            <v-btn
              v-for="action in reviewActions"
              :key="action"
              :disabled="locked"
              @click="
                action === 'delete' ? (confirmDelete = true) : review(action)
              "
              >{{ reviewLabels[action] }}</v-btn
            ><v-btn v-if="canCreate" :disabled="locked" @click="cloneSelected"
              >克隆为新档案</v-btn
            >
          </div>
          <v-btn
            v-for="action in selected.availableRuntimeActions?.filter(
              (action) => can(action),
            ) ?? []"
            :key="action"
            :disabled="locked"
            @click="toggleVersion(action === 'enable')"
            >{{ action === 'enable' ? '启用' : '停用' }}</v-btn
          ><template v-if="definition.resource === 'wfl/process-definition'"
            ><DetailsBlock
              :fields="[
                { key: 'script', type: 'textarea', caption: 'Starlark 脚本' },
              ]"
              :value="selected.snapshot"
              :previous="previous" /><WflGraphBlock
              v-if="selected.snapshot.compiledGraph"
              :graph="
                (selected.snapshot as unknown as WflData).compiledGraph!
              " /></template
          ><DetailsBlock
            v-else
            :fields="detailFields"
            :value="selected.snapshot"
            :previous="previous"
            :previous-source="previousAttachmentSource"
            :source="{
              source: 'submission',
              subjectId: selected.subjectId,
              submissionId: selected.submissionId,
            }" /><CustomerPricingDifference
            v-if="definition.resource === 'bob/customer' && previous"
            :before="customerPricingBefore"
            :after="customerPricingAfter"
        /></template>
        <template
          v-if="
            currentDetail && definition.resource === 'wfl/process-definition'
          "
          ><WflGraphBlock
            v-if="currentDetail.data.compiledGraph"
            :graph="(currentDetail.data as unknown as WflData).compiledGraph!"
          /><v-btn
            v-if="can('submission-get') && currentDetail.sourceApprovalEntryId"
            @click="
              select(
                {
                  subjectId: currentDetail.objectId,
                  submissionId: currentDetail.sourceApprovalEntryId,
                },
                true,
              )
            "
            >查看提交与维护</v-btn
          ></template
        ><DetailsBlock
          v-else-if="currentDetail"
          :fields="detailFields"
          :value="currentDetail.data"
          :source="{ source: 'current', objectId: currentDetail.objectId }"
        /> </v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn @click="closeDetail">关闭</v-btn></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog v-model="confirmDelete" max-width="440"
    ><v-card title="确认删除候选版本"
      ><v-card-text>删除后无法恢复，确定继续吗？</v-card-text
      ><v-card-actions
        ><v-btn
          :prepend-icon="actionIcons.cancel"
          @click="confirmDelete = false"
          >取消</v-btn
        ><v-btn
          :prepend-icon="actionIcons.delete"
          :disabled="locked"
          @click="review('delete')"
          >确认删除</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
<style scoped>
.version-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
td {
  overflow-wrap: anywhere;
}
</style>
