<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import ListPagination from '../list-page/ListPagination.vue'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import {
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  provide,
  computed,
} from 'vue'
import {
  checkIntermediaryResult,
  approvalActionPresentation,
  approvalStatusPresentation,
  userCreatableVouEntities,
} from '@zerp/model'
import ManagementPageFrame from '../ManagementPageFrame.vue'
import {
  DynamicForm,
  DynamicCols,
  RowActions,
  useReferenceOptionsViewModel,
} from '../dynamic-fields/index.ts'
import type { FilterField } from '../dynamic-fields/types.ts'
import type { DocumentDefinition } from './definition.ts'
import { vouPages } from './catalog-list.ts'
import { openingPage } from './opening-list.ts'
import { useVouListViewModel } from './list-runtime.ts'
import { ulid } from 'ulid'
import * as api from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import AttachmentBlock from '../attachments/AttachmentBlock.vue'
import {
  createAttachments,
  attachmentScope,
} from '../attachments/attachments.ts'
import DocumentFields from './DocumentFields.vue'
import IntermediaryInput from './IntermediaryInput.vue'
import IntermediaryScript from './IntermediaryScript.vue'
import IntermediaryResult from './IntermediaryResult.vue'
import DocumentSnapshot from './DocumentSnapshot.vue'
import { documentError } from './errors.ts'
import {
  createDocumentDraft,
  cloneDocumentDraft,
  documentCommand,
  type EditorDraft,
  type DocumentCommand,
} from './draft.ts'
import type { IntermediaryScriptEditor } from './intermediary-data.ts'
import type { OrderDraft } from './order-data.ts'
const props = defineProps<{ definition: DocumentDefinition }>()
const definition =
  props.definition.vouType === 'opening'
    ? openingPage
    : vouPages[props.definition.vouType]
const editorAvailable =
  definition.vouType === 'opening' ||
  userCreatableVouEntities.includes(definition.vouType)
const session = useTargetSession(),
  generation = session.generation
let active = true
const attachments = createAttachments(
  definition.vouType === 'opening'
    ? 'vou/purchase-order'
    : `vou/${definition.vouType}`,
  () => {
    if (!vm.can('attachment-stage') || !session.csrfToken)
      throw new Error('没有附件上传权限。')
    return session.csrfToken
  },
  () =>
    active &&
    session.generation === generation &&
    Boolean(attachmentDraft.value),
)
provide(attachmentScope, attachments.scope)
const attachmentPending = ref(false)
const saving = ref(false),
  uncertain = ref(false),
  editError = ref(''),
  blockPending = ref(false)
const editor = ref<EditorDraft | null>(null)
const intermediaryDraft = computed({
  get: () =>
    editor.value?.kind === 'intermediary' ? editor.value.value : null,
  set: (value) => {
    if (value) editor.value = { kind: 'intermediary', value }
  },
})
const openingDraft = computed(() =>
  editor.value?.kind === 'opening' ? editor.value.value : null,
)
const attachmentDraft = computed(() =>
  editor.value?.kind !== 'opening' ? editor.value?.value : null,
)
const openingSource = ref<Awaited<
  ReturnType<typeof api.getTargetOpening>
> | null>(null)
const pendingOpeningDelete = ref<Awaited<
    ReturnType<typeof api.getTargetOpening>
  > | null>(null),
  deletingSource = ref(false)
const canVerifySubmission = computed(() =>
  pendingOpeningDelete.value ? vm.can('audit-history') : vm.can('get'),
)
const editorOpen = computed(() => editor.value !== null)
const zeroOpening = computed(
  () =>
    openingDraft.value &&
    ['lines', 'assets', 'bills', 'containers'].every(
      (key) => !openingDraft.value![key as 'lines'].length,
    ),
)
let identity = { documentId: '', submissionId: '', idempotencyKey: '' }
const intermediaryScript = ref<IntermediaryScriptEditor>({
  name: '',
  source: '',
})
const savedIntermediaryScript =
  ref<Awaited<ReturnType<typeof api.getTargetIntermediaryScript>>>(null)
const testedIntermediarySource = ref('')
const intermediaryScriptUnknown = ref(false)
const pendingIntermediaryScript = ref<
  (IntermediaryScriptEditor & { expectedRevision: number | null }) | null
>(null)
const intermediaryScriptTested = computed(
  () =>
    Boolean(testedIntermediarySource.value) &&
    testedIntermediarySource.value === intermediaryScript.value.source,
)
async function loadIntermediaryScript() {
  if (saving.value || !vm.can('script-get') || !session.csrfToken) return
  saving.value = true
  const submissionId = identity.submissionId
  try {
    const script = await api.getTargetIntermediaryScript(session.csrfToken)
    if (
      !active ||
      session.generation !== generation ||
      identity.submissionId !== submissionId
    )
      return
    if (intermediaryScriptUnknown.value && pendingIntermediaryScript.value) {
      const pending = pendingIntermediaryScript.value
      if (
        !script ||
        script.revision !== (pending.expectedRevision ?? 0) + 1 ||
        script.name !== pending.name ||
        script.source !== pending.source
      ) {
        editError.value = '尚未读取到本次脚本保存结果，请稍后重新读取核实。'
        return
      }
      pendingIntermediaryScript.value = null
      if (intermediaryDraft.value)
        intermediaryDraft.value = {
          ...intermediaryDraft.value,
          calculation: null,
        }
    }
    savedIntermediaryScript.value = script
    intermediaryScript.value = {
      name: script?.name ?? '',
      source: script?.source ?? '',
    }
    testedIntermediarySource.value = ''
    intermediaryScriptUnknown.value = false
    editError.value = ''
  } catch (cause) {
    if (active && session.generation === generation)
      editError.value = documentError(cause)
  } finally {
    if (active && session.generation === generation) saving.value = false
  }
}
async function calculateIntermediary(testOnly = false) {
  const draft = intermediaryDraft.value
  if (
    !draft ||
    saving.value ||
    uncertain.value ||
    !vm.can('source') ||
    !session.csrfToken ||
    (testOnly ? !vm.can('script-save') : !vm.can('script-get'))
  )
    return
  saving.value = true
  editError.value = ''
  try {
    const source = await api.getTargetIntermediarySource(session.csrfToken, {
      businessDate: draft.businessDate,
    })
    const script = testOnly
      ? null
      : await api.getTargetIntermediaryScript(session.csrfToken)
    if (!testOnly && !script) throw new Error('请先维护并保存可用的计算脚本。')
    const sourceText = testOnly
      ? intermediaryScript.value.source
      : script!.source
    const { runIntermediaryScript } = await import('./intermediary-script.ts')
    const result = await runIntermediaryScript(sourceText, source.source)
    if (!checkIntermediaryResult(source.source, result).ok)
      throw new Error('脚本结果的明细、金额或收款方汇总不符合来源事实。')
    if (
      !active ||
      session.generation !== generation ||
      intermediaryDraft.value !== draft
    )
      return
    if (testOnly) testedIntermediarySource.value = sourceText
    else {
      savedIntermediaryScript.value = script
      intermediaryDraft.value = {
        ...draft,
        calculation: { ...source, script: script!, result },
      }
    }
  } catch (cause) {
    if (active && session.generation === generation)
      editError.value = documentError(cause)
  } finally {
    if (active && session.generation === generation) saving.value = false
  }
}
async function saveIntermediaryScript() {
  if (
    saving.value ||
    uncertain.value ||
    intermediaryScriptUnknown.value ||
    !intermediaryScriptTested.value ||
    !vm.can('script-save') ||
    !session.csrfToken
  )
    return
  saving.value = true
  try {
    pendingIntermediaryScript.value = {
      ...intermediaryScript.value,
      name: intermediaryScript.value.name.trim(),
      expectedRevision: savedIntermediaryScript.value?.revision ?? null,
    }
    const script = await api.saveTargetIntermediaryScript(
      session.csrfToken,
      pendingIntermediaryScript.value,
    )
    if (!active || session.generation !== generation) return
    pendingIntermediaryScript.value = null
    savedIntermediaryScript.value = script
    testedIntermediarySource.value = ''
    if (intermediaryDraft.value)
      intermediaryDraft.value = {
        ...intermediaryDraft.value,
        calculation: null,
      }
    editError.value = ''
  } catch (cause) {
    if (active && session.generation === generation) {
      intermediaryScriptUnknown.value =
        !(cause instanceof api.TargetApiError) ||
        ['internal_error', 'invalid_response'].includes(cause.errorKey)
      if (!intermediaryScriptUnknown.value)
        pendingIntermediaryScript.value = null
      editError.value = documentError(cause)
    }
  } finally {
    if (active && session.generation === generation) saving.value = false
  }
}
function create() {
  if (
    !vm.can('submit-new') ||
    saving.value ||
    uncertain.value ||
    intermediaryScriptUnknown.value ||
    !editorAvailable
  )
    return
  const submissionId = ulid()
  identity = {
    documentId: ulid(),
    submissionId,
    idempotencyKey: submissionId,
  }
  editError.value = ''
  attachments.reset()
  openingSource.value = null
  editor.value = createDocumentDraft(definition.vouType)
  if (editor.value?.kind === 'intermediary' && vm.can('script-get'))
    void loadIntermediaryScript()
}
function closeDraft() {
  if (!saving.value) {
    editor.value = null
    openingSource.value = null
    attachments.reset()
  }
}
function cloneSelected() {
  const original = vm.selected
  if (
    !original ||
    saving.value ||
    uncertain.value ||
    intermediaryScriptUnknown.value ||
    !vm.can('submit-new')
  )
    return
  create()
  editor.value = cloneDocumentDraft(original)
  if (original.entity === 'opening') openingSource.value = original
  else
    editError.value = original.payload.attachments.length
      ? '附件不随复制继承，请重新上传需要的文件。'
      : ''
  vm.close()
}
async function submit() {
  if (
    !editorOpen.value ||
    saving.value ||
    uncertain.value ||
    intermediaryScriptUnknown.value ||
    blockPending.value ||
    attachmentPending.value ||
    openingSource.value ||
    !vm.can('submit-new') ||
    !session.csrfToken
  )
    return
  editError.value = ''
  let command: DocumentCommand
  try {
    if (!editor.value) return
    command = documentCommand(editor.value, identity)
    if (editor.value.kind === 'opening')
      identity.documentId = editor.value.value.bookId
  } catch (cause) {
    editError.value = cause instanceof Error ? cause.message : '输入不完整。'
    return
  }
  saving.value = true
  if (command.kind !== 'opening') {
    try {
      await attachments.prepare(command.input.payload.attachments)
    } catch (cause) {
      if (active && session.generation === generation) {
        editError.value =
          cause instanceof Error ? cause.message : '附件上传失败。'
        saving.value = false
      }
      return
    }
  }
  if (!active || session.generation !== generation) return
  try {
    if (command.kind === 'opening')
      await api.submitTargetOpening(session.csrfToken, command.input)
    else if (command.kind !== 'order')
      await api.submitTargetVoucher(
        session.csrfToken,
        command.entity,
        command.input,
      )
    else
      await api.submitTargetOrder(
        session.csrfToken,
        command.entity,
        command.input,
      )
    if (!active || session.generation !== generation) return
    editor.value = null
    attachments.reset()
    const refreshed = await vm.refresh()
    if (active && session.generation === generation)
      vm.feedback =
        refreshed || !vm.searchable
          ? '提交成功，等待其他操作人审批。'
          : '提交成功，但列表刷新失败。'
  } catch (cause) {
    if (!active || session.generation !== generation) return
    if (
      !(cause instanceof api.TargetApiError) ||
      ['internal_error', 'invalid_response'].includes(cause.errorKey)
    ) {
      uncertain.value = true
      editError.value = '提交结果未知，保持锁定，不会自动重试。'
    } else editError.value = documentError(cause)
  } finally {
    if (active && session.generation === generation) saving.value = false
  }
}
async function verifySubmission() {
  if (
    !uncertain.value ||
    saving.value ||
    !canVerifySubmission.value ||
    !session.csrfToken
  )
    return
  saving.value = true
  try {
    if (pendingOpeningDelete.value) {
      const original = pendingOpeningDelete.value
      const audit = await api.queryTargetVoucherAudit(
        session.csrfToken,
        'opening',
        original.documentId,
      )
      if (!active || session.generation !== generation) return
      if (
        audit.some(
          (event) =>
            event.action === 'DELETED' &&
            event.submissionId === original.submissionId &&
            event.fromRevision === original.revision &&
            event.actorId === session.user?.id,
        )
      ) {
        uncertain.value = false
        pendingOpeningDelete.value = null
        openingSource.value = null
        editError.value = '已核实原提交删除成功，可以重新提交。'
        await vm.refresh()
      } else editError.value = '尚无法确定删除结果，继续保持锁定。'
      return
    }
    const result = await api.getTargetVoucher(
      session.csrfToken,
      definition.vouType,
      identity.documentId,
    )
    if (!active || session.generation !== generation) return
    if (
      result.submissionId !== identity.submissionId ||
      result.documentId !== identity.documentId
    ) {
      editError.value = '尚无法确定原提交结果，继续保持锁定。'
      return
    }
    uncertain.value = false
    editor.value = null
    attachments.reset()
    const refreshed = await vm.refresh()
    if (active && session.generation === generation) {
      editError.value = ''
      vm.feedback =
        refreshed || !vm.searchable
          ? '已核实提交成功。'
          : '已核实提交成功，但列表刷新失败。'
    }
  } catch {
    if (active && session.generation === generation)
      editError.value = '尚无法确定原提交结果，继续保持锁定。'
  } finally {
    if (active && session.generation === generation) saving.value = false
  }
}
const canDeleteSource = computed(() =>
  Boolean(
    openingSource.value &&
    openingSource.value.status !== 'APPROVED' &&
    openingSource.value.submittedBy === session.user?.id &&
    vm.can('delete') &&
    !saving.value &&
    !uncertain.value,
  ),
)
async function deleteOpeningSource() {
  const original = openingSource.value
  if (!original || !canDeleteSource.value || !session.csrfToken) return
  saving.value = true
  try {
    await api.deleteTargetVoucher(session.csrfToken, 'opening', {
      documentId: original.documentId,
      submissionId: original.submissionId,
      expectedRevision: original.revision,
    })
    if (!active || session.generation !== generation) return
    openingSource.value = null
    const refreshed = await vm.refresh()
    if (active && session.generation === generation)
      editError.value =
        refreshed || !vm.searchable
          ? '原提交已删除，可以修改后重新提交。'
          : '原提交已删除，但列表刷新失败。'
  } catch (cause) {
    if (!active || session.generation !== generation) return
    if (
      !(cause instanceof api.TargetApiError) ||
      ['internal_error', 'invalid_response'].includes(cause.errorKey)
    ) {
      uncertain.value = true
      pendingOpeningDelete.value = original
      editError.value = '删除结果未知，请核实原提交。'
    } else editError.value = documentError(cause)
  } finally {
    if (active && session.generation === generation) {
      saving.value = false
      deletingSource.value = false
    }
  }
}
const deleting = ref(false)
const vm = reactive(useVouListViewModel(definition))
const references = reactive(useReferenceOptionsViewModel())
onMounted(() => {
  void vm.initialize()
  if (!vm.searchable) return
  for (const field of definition.filters as readonly FilterField[])
    if (field.type === 'reference') void references.load(field.source)
})

onBeforeUnmount(() => {
  active = false
  attachments.reset()
  vm.dispose()
  references.dispose()
})
</script>
<template>
  <ManagementPageFrame :title="definition.title" data-testid="vou-list-page">
    <template #actions
      ><v-btn
        :prepend-icon="actionIcons.create"
        v-if="editorAvailable && vm.can('submit-new')"
        :disabled="saving || uncertain || intermediaryScriptUnknown"
        color="primary"
        @click="create"
        >新建</v-btn
      ></template
    >
    <template #alerts>
      <v-alert v-if="intermediaryScriptUnknown" type="warning">
        脚本保存结果未知，关闭表单不会解除锁定。
        <v-btn
          v-if="vm.can('script-get')"
          :prepend-icon="actionIcons.resolve"
          :disabled="saving"
          @click="loadIntermediaryScript"
          >核实脚本保存</v-btn
        >
      </v-alert>
      <v-alert v-if="uncertain" type="warning"
        >提交结果未知，普通查询或关闭表单不会解除锁定。<v-btn
          :prepend-icon="actionIcons.resolve"
          v-if="canVerifySubmission"
          :loading="saving"
          @click="verifySubmission"
          >核实原提交</v-btn
        ></v-alert
      >
      <v-alert
        v-if="vm.feedback && !vm.selected && !vm.requestedAction"
        type="info"
        closable
        close-label="关闭提示"
        class="mb-4"
        @click:close="vm.dismissFeedback"
        >{{ vm.feedback }}</v-alert
      >
      <v-alert
        v-if="
          definition.vouType !== 'opening' &&
          !userCreatableVouEntities.includes(definition.vouType)
        "
        type="info"
        >此类型由系统生成，不支持人工新建。</v-alert
      >
      <v-alert v-if="!editorAvailable" type="info" class="mb-4"
        >专用单据编辑器尚未实施；已提交内容只读，可打开详情及执行已支持的审批。</v-alert
      >
      <v-alert v-if="!vm.searchable" type="info" class="mb-4"
        >当前账号没有查询权限，仅显示已授权操作。</v-alert
      >
      <v-alert v-if="vm.queryError" type="error" class="mb-4">{{
        vm.queryError
      }}</v-alert>
    </template>
    <template #filters>
      <DynamicForm
        :fields="definition.filters"
        :model-value="vm.filterInput"
        :disabled="!vm.searchable"
        :reference-options="references.options"
        @update:model-value="vm.filterInput = $event"
        @search="vm.submitSearch"
      />
      <v-progress-linear
        v-if="references.loading"
        indeterminate
        aria-label="引用选项加载中"
      />
      <v-alert v-if="references.error" type="error">{{
        references.error
      }}</v-alert>
    </template>
    <DynamicCols
      identity-key="documentId"
      :fields="definition.columns"
      :items="vm.items"
      :loading="vm.loading"
    >
      <template #actions="{ item }"
        ><RowActions
          :actions="vm.rowActions(item)"
          :data-testid="`vou-row-${item.documentId}`"
          @action="vm.open(item)"
      /></template>
    </DynamicCols>
    <template #footer>
      <ListPagination
        :pagination="{
          mode: 'total',
          page: vm.page,
          pageSize: vm.pageSize,
          total: vm.total,
        }"
        :disabled="vm.loading || !vm.searchable"
        @page="vm.goToPage"
      />
    </template>
  </ManagementPageFrame>
  <v-dialog
    :model-value="Boolean(vm.selected || vm.detailLoading || vm.detailError)"
    max-width="1000"
    :persistent="Boolean(vm.selected && vm.pending.has(vm.selected.documentId))"
    @update:model-value="!$event && vm.close()"
  >
    <v-card
      :title="vm.selected?.documentNo ?? '单据详情'"
      data-testid="vou-detail"
    >
      <v-card-text>
        <v-progress-linear v-if="vm.detailLoading" indeterminate />
        <v-alert
          v-if="vm.feedback && !vm.requestedAction"
          type="info"
          closable
          close-label="关闭提示"
          class="mb-4"
          @click:close="vm.dismissFeedback"
          >{{ vm.feedback }}</v-alert
        >
        <v-alert v-if="vm.detailError" type="error">{{
          vm.detailError
        }}</v-alert>
        <template v-if="vm.selected">
          <p>已提交内容只读；修改需复制到临时表单后重新提交。</p>
          <p>
            审批状态：{{
              approvalStatusPresentation[vm.selected.status].label
            }}
            · 修订：{{ vm.selected.revision }}
          </p>
          <p>
            提交时间：{{ vm.selected.submittedAt }} · 提交人标识：{{
              vm.selected.submittedBy
            }}
          </p>
          <p v-if="vm.selected.approvedAt">
            批准时间：{{ vm.selected.approvedAt }} · 批准人标识：{{
              vm.selected.approvedBy
            }}
          </p>
          <p v-if="vm.selected.rejectedAt">
            驳回时间：{{ vm.selected.rejectedAt }} · 驳回人标识：{{
              vm.selected.rejectedBy
            }}
          </p>
          <p v-if="vm.selected.rejectionReason">
            驳回原因：{{ vm.selected.rejectionReason }}
          </p>
          <v-alert v-if="vm.unknown.has(vm.selected.documentId)" type="warning"
            >该单据操作结果未知，普通查询不会解除审批锁定。<v-btn
              :prepend-icon="actionIcons.resolve"
              v-if="vm.canVerify"
              @click="vm.verifyOutcome"
              >核实操作结果</v-btn
            ></v-alert
          >
          <DocumentSnapshot :document="vm.selected" />
        </template>
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <RowActions :actions="vm.reviewActions" @action="vm.requestReview" />
        <v-btn
          v-if="editorAvailable && vm.can('submit-new') && vm.selected"
          :disabled="
            vm.pending.has(vm.selected.documentId) ||
            vm.unknown.has(vm.selected.documentId)
          "
          :prepend-icon="actionIcons.clone"
          @click="cloneSelected"
          >复制到临时表单</v-btn
        >
        <v-btn
          :prepend-icon="actionIcons.delete"
          v-if="editorAvailable && vm.canDelete"
          color="error"
          @click="deleting = true"
          >删除开放提交</v-btn
        >
        <v-spacer /><v-btn
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
          :prepend-icon="actionIcons.cancel"
          @click="vm.close"
          >关闭</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="deleting" max-width="480" persistent>
    <v-card title="删除开放提交"
      ><v-card-text
        >确认删除此开放提交？已提交的审计记录会保留。修改内容可先复制到临时表单，再显式删除原提交。<v-alert
          v-if="vm.feedback"
          type="info"
          >{{ vm.feedback }}</v-alert
        ></v-card-text
      >
      <v-card-actions
        ><v-btn
          :prepend-icon="actionIcons.cancel"
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
          @click="deleting = false"
          >取消</v-btn
        ><v-btn
          :prepend-icon="actionIcons.delete"
          color="error"
          :disabled="!vm.canDelete"
          @click="vm.deleteSelected().then(() => (deleting = false))"
          >确定删除</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
  <v-dialog
    :model-value="Boolean(vm.requestedAction)"
    max-width="480"
    persistent
  >
    <v-card
      :title="
        vm.requestedAction
          ? `确认${approvalActionPresentation[vm.requestedAction].label}`
          : ''
      "
    >
      <v-card-text>
        <v-alert v-if="vm.feedback" type="error" class="mb-4">{{
          vm.feedback
        }}</v-alert>
        <p>确认对 {{ vm.selected?.documentNo }} 执行此操作？</p>
        <FieldInput
          usage="edit"
          :field="{
            key: 'reason',
            type: 'textarea',
            caption: '操作原因',
            maxLength: 1000,
          }"
          v-if="vm.needsReason"
          v-model="vm.reason"
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
        />
      </v-card-text>
      <v-card-actions>
        <v-btn
          :prepend-icon="actionIcons.cancel"
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
          @click="vm.cancelReview"
          >取消</v-btn
        >
        <v-btn
          color="primary"
          :loading="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
          :disabled="vm.needsReason && !vm.reason.trim()"
          :prepend-icon="
            vm.requestedAction
              ? actionIcons[vm.requestedAction]
              : actionIcons.confirm
          "
          @click="vm.confirmReview"
          >确定</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog
    :model-value="editorOpen"
    :persistent="saving"
    max-width="1100"
    @update:model-value="!$event && closeDraft()"
  >
    <v-card
      :title="openingDraft ? '编辑会计期初' : '新建单据'"
      :data-testid="openingDraft ? 'opening-editor' : 'document-editor'"
      ><v-card-text>
        <v-alert v-if="editError" type="error">{{ editError }}</v-alert>
        <v-alert v-if="openingSource" type="warning"
          >重新提交前必须显式删除原开放提交；批准的期初须先在原单据反批准。<v-btn
            :prepend-icon="actionIcons.delete"
            v-if="canDeleteSource"
            @click="deletingSource = true"
            >删除原开放提交</v-btn
          ></v-alert
        >
        <DocumentFields
          v-if="editor && editor.kind !== 'intermediary'"
          :key="identity.submissionId"
          :model-value="editor"
          :disabled="saving || uncertain || Boolean(openingSource)"
          @update:model-value="editor = $event"
          @pending="blockPending = $event"
        />
        <template v-if="intermediaryDraft">
          <IntermediaryInput
            v-model="intermediaryDraft"
            :disabled="saving || uncertain || intermediaryScriptUnknown"
            :script-configured="Boolean(savedIntermediaryScript)"
            :can-read-script="vm.can('script-get')"
            :can-source="vm.can('source')"
            @calculate="calculateIntermediary(false)"
          />
          <IntermediaryScript
            v-model="intermediaryScript"
            :disabled="saving || uncertain"
            :can-read-script="vm.can('script-get')"
            :can-save-script="vm.can('script-save')"
            :can-source="vm.can('source')"
            :tested="intermediaryScriptTested"
            :script-unknown="intermediaryScriptUnknown"
            @load-script="loadIntermediaryScript"
            @test-script="calculateIntermediary(true)"
            @save-script="saveIntermediaryScript"
          />
          <IntermediaryResult
            v-if="intermediaryDraft.calculation"
            :calculation="intermediaryDraft.calculation"
          />
        </template>
        <AttachmentBlock
          v-if="attachmentDraft"
          :key="identity.submissionId"
          caption="附件"
          :model-value="attachmentDraft.attachments"
          mode="edit"
          :disabled="saving || uncertain"
          @pending="attachmentPending = $event"
          @update:model-value="
            attachmentDraft.attachments = $event as OrderDraft['attachments']
          "
        /> </v-card-text
      ><v-card-actions
        ><v-btn
          :prepend-icon="actionIcons.cancel"
          :disabled="saving"
          @click="closeDraft"
          >取消</v-btn
        ><v-btn
          :prepend-icon="actionIcons.submit"
          :disabled="
            saving ||
            uncertain ||
            intermediaryScriptUnknown ||
            blockPending ||
            attachmentPending ||
            Boolean(openingSource)
          "
          :loading="saving"
          @click="submit"
          >{{
            openingDraft ? (zeroOpening ? '提交零期初' : '提交期初') : '提交'
          }}</v-btn
        ></v-card-actions
      ></v-card
    >
  </v-dialog>
  <v-dialog v-model="deletingSource" persistent max-width="480"
    ><v-card title="删除原开放提交"
      ><v-card-text
        >确认删除原开放提交？临时表单和原审计记录会保留。</v-card-text
      ><v-card-actions
        ><v-btn
          :prepend-icon="actionIcons.cancel"
          :disabled="saving"
          @click="deletingSource = false"
          >取消</v-btn
        ><v-btn
          :prepend-icon="actionIcons.delete"
          :disabled="!canDeleteSource"
          :loading="saving"
          @click="deleteOpeningSource"
          >确定删除</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
