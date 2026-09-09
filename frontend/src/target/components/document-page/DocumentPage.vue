<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  provide,
  computed,
} from 'vue'
import {
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
import AttachmentBlock from '../version-page/AttachmentBlock.vue'
import {
  createAttachments,
  attachmentScope,
} from '../version-page/attachments.ts'
import OpeningBlock from './OpeningBlock.vue'
import OpeningSnapshot from './OpeningSnapshot.vue'
import { emptyOpening, type OpeningDraft } from './opening-data.ts'
import { documentError } from './errors.ts'
import OrderBlock from './OrderBlock.vue'
import {
  emptyOrder,
  orderPayload,
  cloneOrder,
  type OrderDraft,
} from './order-data.ts'
import OrderSnapshot from './OrderSnapshot.vue'
import SnapshotValue from './SnapshotValue.vue'
import AssetBlock from './AssetBlock.vue'
import BillBlock from './BillBlock.vue'
import {
  billEntities,
  emptyBill,
  billPayload,
  cloneBill,
  type BillEntity,
  type BillDraft,
} from './bill-data.ts'
import {
  assetEntities,
  emptyAsset,
  assetPayload,
  cloneAsset,
  type AssetDraft,
  type AssetEntity,
} from './asset-data.ts'
import FinancialBlock from './FinancialBlock.vue'
import {
  financialEntities,
  emptyFinancial,
  financialPayload,
  cloneFinancial,
  type FinancialDraft,
  type FinancialEntity,
} from './financial-data.ts'
import ProductionBlock from './ProductionBlock.vue'
import {
  cloneProduction,
  emptyProduction,
  productionPayload,
  type ProductionDraft,
  type ProductionEntity,
} from './production-data.ts'
import ProductFactsBlock from './ProductFactsBlock.vue'
import {
  cloneProductFacts,
  emptyProductFacts,
  productFactsPayload,
  type ProductFactsDraft,
  type ProductFactsEntity,
} from './product-facts-data.ts'
import FulfillmentBlock from './FulfillmentBlock.vue'
import {
  cloneFulfillment,
  emptyFulfillment,
  fulfillmentPayload,
  type FulfillmentDraft,
  type FulfillmentEntity,
} from './fulfillment-data.ts'
const props = defineProps<{ definition: DocumentDefinition }>()
const definition =
  props.definition.vouType === 'opening'
    ? openingPage
    : vouPages[props.definition.vouType]
const productionEntities = ['order-production', 'self-production']
const productFactsEntities = ['purchase-inquiry', 'inventory-count']
const fulfillmentEntities = [
  'purchase-inbound',
  'sale-return',
  'purchase-return',
]
const editorAvailable = [
  'sale-order',
  'purchase-order',
  'opening',
  ...fulfillmentEntities,
  ...productFactsEntities,
  ...productionEntities,
  ...financialEntities,
  ...assetEntities,
  ...billEntities,
].includes(definition.vouType)
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
type EditorDraft =
  | { kind: 'bill'; value: BillDraft }
  | { kind: 'asset'; value: AssetDraft }
  | { kind: 'financial'; value: FinancialDraft }
  | { kind: 'order'; value: OrderDraft }
  | { kind: 'fulfillment'; value: FulfillmentDraft }
  | { kind: 'product-facts'; value: ProductFactsDraft }
  | { kind: 'production'; value: ProductionDraft }
  | { kind: 'opening'; value: OpeningDraft }
const editor = ref<EditorDraft | null>(null)
function editorModel<K extends EditorDraft['kind']>(kind: K) {
  type Value = Extract<EditorDraft, { kind: K }>['value']
  return computed<Value | null>({
    get: () =>
      editor.value?.kind === kind ? (editor.value.value as Value) : null,
    set: (value) => {
      if (value) editor.value = { kind, value } as EditorDraft
      else if (editor.value?.kind === kind) editor.value = null
    },
  })
}
const billDraft = editorModel('bill')
const assetDraft = editorModel('asset')
const financialDraft = editorModel('financial')
const draft = editorModel('order')
const fulfillmentDraft = editorModel('fulfillment')
const productFactsDraft = editorModel('product-facts')
const productionDraft = editorModel('production')
const openingDraft = editorModel('opening')
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
function create() {
  if (
    !vm.can('submit-new') ||
    saving.value ||
    uncertain.value ||
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
  if (definition.vouType === 'opening') openingDraft.value = emptyOpening()
  else if ((billEntities as readonly string[]).includes(definition.vouType))
    billDraft.value = emptyBill(definition.vouType as BillEntity)
  else if ((assetEntities as readonly string[]).includes(definition.vouType))
    assetDraft.value = emptyAsset(definition.vouType as AssetEntity)
  else if (
    (financialEntities as readonly string[]).includes(definition.vouType)
  )
    financialDraft.value = emptyFinancial(definition.vouType as FinancialEntity)
  else if (productionEntities.includes(definition.vouType))
    productionDraft.value = emptyProduction(
      definition.vouType as ProductionEntity,
    )
  else if (productFactsEntities.includes(definition.vouType))
    productFactsDraft.value = emptyProductFacts(
      definition.vouType as ProductFactsEntity,
    )
  else if (fulfillmentEntities.includes(definition.vouType))
    fulfillmentDraft.value = emptyFulfillment(
      definition.vouType as FulfillmentEntity,
    )
  else draft.value = emptyOrder(definition.vouType as api.TargetOrderEntity)
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
  if (!original || saving.value || uncertain.value) return
  create()
  if (original.entity === 'opening') {
    openingDraft.value = JSON.parse(
      JSON.stringify(original.payload),
    ) as OpeningDraft
    openingSource.value = original
  } else if ((billEntities as readonly string[]).includes(original.entity)) {
    billDraft.value = cloneBill(
      original.entity as BillEntity,
      original.payload as import('@zerp/model').VouPayloadFor<BillEntity>,
      ulid,
    )
    editError.value = original.payload.attachments.length
      ? '附件不随复制继承，请重新上传需要的文件。'
      : ''
  } else if ((assetEntities as readonly string[]).includes(original.entity)) {
    const payload =
      original.payload as import('@zerp/model').VouPayloadFor<AssetEntity>
    const count =
      'assetAcquisitionLines' in payload
        ? payload.assetAcquisitionLines.length
        : 'assetSaleLines' in payload
          ? payload.assetSaleLines.length
          : payload.assetLiquidationLines.length
    assetDraft.value = cloneAsset(
      original.entity as AssetEntity,
      payload,
      Array.from({ length: count }, () => ulid()),
    )
    editError.value = original.payload.attachments.length
      ? '附件不随复制继承，请重新上传需要的文件。'
      : ''
  } else if (
    (financialEntities as readonly string[]).includes(original.entity)
  ) {
    const payload =
      original.payload as import('@zerp/model').VouPayloadFor<FinancialEntity>
    const count =
      'expenseLines' in payload
        ? payload.expenseLines.length
        : 'subunitAllocations' in payload
          ? payload.subunitAllocations.length
          : 0
    financialDraft.value = cloneFinancial(
      original.entity as FinancialEntity,
      payload,
      Array.from({ length: count }, () => ulid()),
    )
    editError.value = original.payload.attachments.length
      ? '附件不随复制继承，请重新上传需要的文件。'
      : ''
  } else if (
    (original.entity === 'order-production' ||
      original.entity === 'self-production') &&
    'productionLines' in original.payload
  ) {
    productionDraft.value = cloneProduction(
      original.entity,
      original.payload,
      original.payload.productionLines.map(() => ulid()),
    )
    editError.value = original.payload.attachments.length
      ? '附件不随复制继承，请重新上传需要的文件。'
      : ''
  } else if (
    (original.entity === 'purchase-inquiry' ||
      original.entity === 'inventory-count') &&
    ('priceLines' in original.payload ||
      'inventoryCountLines' in original.payload)
  ) {
    const payload =
      original.payload as import('@zerp/model').VouPayloadFor<ProductFactsEntity>
    const lines =
      'priceLines' in payload ? payload.priceLines : payload.inventoryCountLines
    productFactsDraft.value = cloneProductFacts(
      original.entity,
      payload,
      lines.map(() => ulid()),
    )
    editError.value = original.payload.attachments.length
      ? '附件不随复制继承，请重新上传需要的文件。'
      : ''
  } else if (
    (original.entity === 'purchase-inbound' ||
      original.entity === 'sale-return' ||
      original.entity === 'purchase-return') &&
    'warehouse' in original.payload &&
    ('sourceLines' in original.payload || 'returnLines' in original.payload)
  ) {
    const lines =
      'sourceLines' in original.payload
        ? original.payload.sourceLines
        : original.payload.returnLines
    fulfillmentDraft.value = cloneFulfillment(
      original.entity,
      original.payload,
      lines.map(() => ulid()),
    )
    editError.value = original.payload.attachments.length
      ? '附件不随复制继承，请重新上传需要的文件。'
      : ''
  } else if (
    (original.entity === 'sale-order' ||
      original.entity === 'purchase-order') &&
    'productLines' in original.payload &&
    ('customerSubunit' in original.payload || 'supplier' in original.payload)
  ) {
    draft.value = cloneOrder(
      original.entity,
      original.payload,
      original.payload.productLines.map(() => ulid()),
    )
    editError.value = original.payload.attachments.length
      ? '附件不随复制继承，请重新上传需要的文件。'
      : ''
  }
  vm.close()
}
async function submit() {
  if (
    !editorOpen.value ||
    saving.value ||
    uncertain.value ||
    blockPending.value ||
    attachmentPending.value ||
    openingSource.value ||
    !vm.can('submit-new') ||
    !session.csrfToken
  )
    return
  editError.value = ''
  let command:
    | {
        kind: 'order'
        entity: api.TargetOrderEntity
        input: api.TargetOrderInput<api.TargetOrderEntity>
      }
    | { kind: 'opening'; input: api.TargetOpeningInput }
    | {
        kind: 'bill'
        entity: BillEntity
        input: api.TargetVoucherInput<BillEntity>
      }
    | {
        kind: 'asset'
        entity: AssetEntity
        input: api.TargetVoucherInput<AssetEntity>
      }
    | {
        kind: 'financial'
        entity: FinancialEntity
        input: api.TargetVoucherInput<FinancialEntity>
      }
    | {
        kind: 'production'
        entity: ProductionEntity
        input: api.TargetVoucherInput<ProductionEntity>
      }
    | {
        kind: 'product-facts'
        entity: ProductFactsEntity
        input: api.TargetVoucherInput<ProductFactsEntity>
      }
    | {
        kind: 'fulfillment'
        entity: FulfillmentEntity
        input: api.TargetVoucherInput<FulfillmentEntity>
      }
  try {
    if (openingDraft.value) {
      if (!openingDraft.value.bookId) throw new Error('请选择账簿。')
      identity.documentId = openingDraft.value.bookId
      command = {
        kind: 'opening',
        input: {
          ...(JSON.parse(JSON.stringify(openingDraft.value)) as OpeningDraft),
          submissionId: identity.submissionId,
          idempotencyKey: identity.idempotencyKey,
        },
      }
    } else if (billDraft.value)
      command = {
        kind: 'bill',
        entity: billDraft.value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: billPayload(billDraft.value),
        },
      }
    else if (assetDraft.value)
      command = {
        kind: 'asset',
        entity: assetDraft.value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: assetPayload(assetDraft.value),
        },
      }
    else if (financialDraft.value)
      command = {
        kind: 'financial',
        entity: financialDraft.value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: financialPayload(financialDraft.value),
        },
      }
    else if (productionDraft.value)
      command = {
        kind: 'production',
        entity: productionDraft.value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: productionPayload(productionDraft.value),
        },
      }
    else if (productFactsDraft.value)
      command = {
        kind: 'product-facts',
        entity: productFactsDraft.value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: productFactsPayload(productFactsDraft.value),
        },
      }
    else if (fulfillmentDraft.value)
      command = {
        kind: 'fulfillment',
        entity: fulfillmentDraft.value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: fulfillmentPayload(
            JSON.parse(
              JSON.stringify(fulfillmentDraft.value),
            ) as FulfillmentDraft,
          ),
        },
      }
    else if (draft.value)
      command = {
        kind: 'order',
        entity: draft.value.entity,
        input: {
          ...identity,
          expectedRevision: null,
          payload: orderPayload(
            JSON.parse(JSON.stringify(draft.value)) as OrderDraft,
          ),
        },
      }
    else return
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
        v-if="editorAvailable && vm.can('submit-new')"
        :disabled="saving || uncertain"
        color="primary"
        @click="create"
        >新建</v-btn
      ></template
    >
    <template #alerts>
      <v-alert v-if="uncertain" type="warning"
        >提交结果未知，普通查询或关闭表单不会解除锁定。<v-btn
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
      <span>共 {{ vm.total }} 项</span>
      <v-pagination
        v-if="vm.searchable && vm.total > vm.pageSize"
        :model-value="vm.page"
        :length="Math.ceil(vm.total / vm.pageSize)"
        @update:model-value="vm.goToPage"
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
              v-if="vm.canVerify"
              @click="vm.verifyOutcome"
              >核实操作结果</v-btn
            ></v-alert
          >
          <OpeningSnapshot
            v-if="vm.selected.entity === 'opening'"
            :document="vm.selected"
          />
          <OrderSnapshot
            v-else-if="
              definition.vouType === 'sale-order' ||
              definition.vouType === 'purchase-order'
            "
            :payload="vm.selected.payload"
          />
          <section v-else data-testid="vou-catalog-snapshot">
            <SnapshotValue :value="vm.selected.payload" />
          </section>
          <AttachmentBlock
            v-if="vm.selected.entity !== 'opening'"
            caption="附件"
            :model-value="vm.selected.payload.attachments"
            mode="read"
            :source="{
              source: 'voucher',
              entity: vm.selected.entity,
              documentId: vm.selected.documentId,
              submissionId: vm.selected.submissionId,
            }"
          />
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
          @click="cloneSelected"
          >复制到临时表单</v-btn
        >
        <v-btn
          v-if="editorAvailable && vm.canDelete"
          color="error"
          @click="deleting = true"
          >删除开放提交</v-btn
        >
        <v-spacer /><v-btn
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
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
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
          @click="deleting = false"
          >取消</v-btn
        ><v-btn
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
        <v-textarea
          v-if="vm.needsReason"
          v-model="vm.reason"
          label="操作原因"
          maxlength="1000"
          :disabled="
            Boolean(vm.selected && vm.pending.has(vm.selected.documentId))
          "
        />
      </v-card-text>
      <v-card-actions>
        <v-btn
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
            v-if="canDeleteSource"
            @click="deletingSource = true"
            >删除原开放提交</v-btn
          ></v-alert
        >
        <OpeningBlock
          v-if="openingDraft"
          :key="identity.submissionId"
          v-model="openingDraft"
          :disabled="saving || uncertain || Boolean(openingSource)"
        />
        <BillBlock
          v-if="billDraft"
          v-model="billDraft"
          :disabled="saving || uncertain"
        />
        <AssetBlock
          v-if="assetDraft"
          v-model="assetDraft"
          :disabled="saving || uncertain"
        />
        <FinancialBlock
          v-if="financialDraft"
          v-model="financialDraft"
          :disabled="saving || uncertain"
        />
        <ProductionBlock
          v-if="productionDraft"
          v-model="productionDraft"
          :disabled="saving || uncertain"
          @pending="blockPending = $event"
        />
        <ProductFactsBlock
          v-if="productFactsDraft"
          v-model="productFactsDraft"
          :disabled="saving || uncertain"
          @pending="blockPending = $event"
        />
        <FulfillmentBlock
          v-if="fulfillmentDraft"
          v-model="fulfillmentDraft"
          :disabled="saving || uncertain"
        />
        <OrderBlock
          v-if="draft"
          v-model="draft"
          :disabled="saving || uncertain"
          @pending="blockPending = $event"
        />
        <AttachmentBlock
          v-if="attachmentDraft"
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
        ><v-btn :disabled="saving" @click="closeDraft">取消</v-btn
        ><v-btn
          :disabled="
            saving ||
            uncertain ||
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
        ><v-btn :disabled="saving" @click="deletingSource = false">取消</v-btn
        ><v-btn
          :disabled="!canDeleteSource"
          :loading="saving"
          @click="deleteOpeningSource"
          >确定删除</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
