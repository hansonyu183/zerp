<script setup lang="ts">
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import ProductFactLineEditor from './ProductFactLineEditor.vue'
import { resolveProductFact } from './product-fact-resolution.ts'
import type { DetailFields } from '../details/detail-fields.ts'
import { actionIcons } from '../../presentation/action-icons.ts'
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { ulid } from 'ulid'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import VouReference, { type VouCandidate } from './VouReference.vue'
import type {
  ProductFactsDraft,
  ProductFactLine,
} from './product-facts-data.ts'
import { queryTargetInventoryBookBalance } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
const props = defineProps<{
  modelValue: ProductFactsDraft
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: ProductFactsDraft]
  pending: [value: boolean]
}>()
const session = useTargetSession(),
  generation = session.generation
let active = true
const requests = new Map<string, symbol>(),
  pending = new Set<string>(),
  error = ref('')
const owns = () => active && session.generation === generation
const preview = ref<Awaited<
    ReturnType<typeof queryTargetInventoryBookBalance>
  > | null>(null),
  previewLoading = ref(false)
let previewRequest = 0
watch(
  [
    () => props.modelValue.warehouse?.objectId,
    () => props.modelValue.businessDate,
  ],
  () => {
    previewRequest++
    preview.value = null
    previewLoading.value = false
  },
)
async function loadPreview(page = 1) {
  if (
    props.disabled ||
    !session.can('/vou/inventory-count/book-balance') ||
    !session.csrfToken ||
    !props.modelValue.warehouse
  )
    return
  const request = ++previewRequest
  previewLoading.value = true
  try {
    const result = await queryTargetInventoryBookBalance(session.csrfToken, {
      warehouseId: props.modelValue.warehouse.objectId,
      businessDate: props.modelValue.businessDate,
      page,
      pageSize: 20,
    })
    if (
      owns() &&
      request === previewRequest &&
      session.can('/vou/inventory-count/book-balance')
    )
      preview.value = result
  } catch (cause) {
    if (owns() && request === previewRequest)
      error.value =
        cause instanceof Error ? cause.message : '账面商品读取失败。'
  } finally {
    if (owns() && request === previewRequest) previewLoading.value = false
  }
}
async function addPreview(
  row: NonNullable<typeof preview.value>['items'][number],
) {
  if (
    props.disabled ||
    props.modelValue.lines.some(
      (line) => line.product?.objectId === row.product.objectId,
    )
  )
    return
  const id = ulid()
  update({
    lines: [
      ...props.modelValue.lines,
      {
        id,
        product: null,
        current: null,
        unitId: '',
        enteredQuantity: '',
        baseQuantity: '',
        unitPrice: '',
        remark: '',
      },
    ],
  })
  await nextTick()
  if (owns() && !props.disabled)
    await product(id, { entity: 'product', ...row.product })
}
function update(patch: Partial<ProductFactsDraft>) {
  if (!props.disabled && owns())
    emit('update:modelValue', { ...props.modelValue, ...patch })
}
function line(id: string, patch: Partial<ProductFactLine>) {
  update({
    lines: props.modelValue.lines.map((row) =>
      row.id === id ? { ...row, ...patch } : row,
    ),
  })
}
async function product(
  id: string,
  choice: VouCandidate | null,
  retained?: ProductFactLine,
) {
  if (props.disabled) return
  const request = Symbol()
  requests.set(id, request)
  pending.delete(id)
  line(id, { product: choice, current: null, unitId: '' })
  emit('pending', pending.size > 0)
  if (!choice || props.modelValue.entity !== 'inventory-count') return
  pending.add(id)
  emit('pending', true)
  try {
    const current = await resolveProductFact(choice)
    if (!owns() || requests.get(id) !== request) return
    line(id, {
      product: {
        entity: 'product',
        objectId: current.objectId,
        approvalEntryId: current.sourceApprovalEntryId,
        code: current.code,
        name: current.data.name,
      },
      current,
      unitId: retained?.unitId ?? current.data.defaultInputUnit.id,
    })
  } catch (cause) {
    if (owns() && requests.get(id) === request)
      error.value = cause instanceof Error ? cause.message : '产品读取失败。'
  } finally {
    if (owns() && requests.get(id) === request) {
      pending.delete(id)
      emit('pending', pending.size > 0)
    }
  }
}
onMounted(() => {
  for (const row of props.modelValue.lines)
    if (row.product && props.modelValue.entity === 'inventory-count')
      void product(row.id, row.product, row)
})
onBeforeUnmount(() => {
  active = false
  requests.clear()
  pending.clear()
  emit('pending', false)
})
function replaceLines(lines: ProductFactLine[]) {
  for (const row of props.modelValue.lines)
    if (!lines.some((line) => line.id === row.id)) {
      requests.delete(row.id)
      pending.delete(row.id)
    }
  emit('pending', pending.size > 0)
  update({ lines })
}
function editorPending(value: boolean) {
  if (value) pending.add('editor')
  else pending.delete('editor')
  emit('pending', pending.size > 0)
}
const lineFields = [
  {
    key: 'product',
    type: 'group',
    caption: '产品',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'enteredQuantity', type: 'text', caption: '实盘数量' },
  { key: 'baseQuantity', type: 'text', caption: '基准数量' },
  { key: 'unitPrice', type: 'text', caption: '单价' },
] as const satisfies DetailFields<ProductFactLine>
</script>
<template>
  <v-alert v-if="error" type="error">{{ error }}</v-alert>
  <FormBlock
    :fields="[
      {
        key: 'businessDate',
        type: 'date',
        caption: '业务日期',
        required: true,
      },
      ...(modelValue.entity !== 'inventory-count'
        ? [
            {
              key: 'currency' as const,
              type: 'text' as const,
              caption: '币种',
              required: true,
            },
          ]
        : []),
      { key: 'remark', type: 'textarea', caption: '备注' },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <VouReference
    v-if="modelValue.entity === 'purchase-inquiry'"
    entity="supplier"
    caption="供应商"
    :model-value="modelValue.supplier"
    :disabled="disabled"
    @update:model-value="
      update({ supplier: $event, selectionOrigin: 'CURRENT' })
    "
  />
  <VouReference
    v-else-if="modelValue.entity === 'inventory-count'"
    entity="warehouse"
    caption="仓库"
    :model-value="modelValue.warehouse"
    :disabled="disabled"
    @update:model-value="update({ warehouse: $event })"
  />
  <section
    v-if="
      modelValue.entity === 'inventory-count' &&
      session.can('/vou/inventory-count/book-balance')
    "
    aria-label="账面商品预览"
  >
    <v-btn
      :disabled="disabled || previewLoading || !modelValue.warehouse"
      :prepend-icon="actionIcons.view"
      @click="loadPreview()"
      >查看账面商品</v-btn
    >
    <p>账面数量仅供参考，请填写实际盘点数量。</p>
    <div v-for="row in preview?.items ?? []" :key="row.product.objectId">
      <span
        >{{ row.product.code }} · {{ row.product.name }}：{{
          row.bookQuantity
        }}</span
      >
      <v-btn
        :prepend-icon="actionIcons.add"
        :disabled="
          disabled ||
          modelValue.lines.some(
            (line) => line.product?.objectId === row.product.objectId,
          )
        "
        @click="addPreview(row)"
        >加入盘点：{{ row.product.name }}</v-btn
      >
    </div>
    <template v-if="preview">
      <v-btn
        :disabled="disabled || previewLoading || preview.page <= 1"
        :prepend-icon="actionIcons.previous"
        @click="loadPreview(preview.page - 1)"
        >账面上一页</v-btn
      >
      <v-btn
        :disabled="
          disabled || previewLoading || preview.page * 20 >= preview.total
        "
        :prepend-icon="actionIcons.next"
        @click="loadPreview(preview.page + 1)"
        >账面下一页</v-btn
      >
    </template>
  </section>
  <CollectionBlock
    caption="商品行"
    :fields="lineFields"
    :model-value="modelValue.lines"
    mode="edit"
    :disabled="disabled"
    :create="
      () => ({
        id: ulid(),
        product: null,
        current: null,
        unitId: '',
        enteredQuantity: '',
        baseQuantity: '',
        unitPrice: '',
        remark: '',
      })
    "
    @update:model-value="replaceLines"
    @pending="editorPending"
  >
    <template
      #editor="{
        value,
        disabled: locked,
        update: updateLine,
        pending: pendingLine,
      }"
      ><ProductFactLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        :disabled="locked"
        @update:model-value="updateLine"
        @pending="pendingLine"
    /></template>
    <template #viewer="{ value }"
      ><ProductFactLineEditor
        :model-value="value"
        :entity="modelValue.entity"
        disabled
    /></template>
  </CollectionBlock>
</template>
