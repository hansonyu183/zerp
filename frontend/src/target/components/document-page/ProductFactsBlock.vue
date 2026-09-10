<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { ulid } from 'ulid'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import VouReference, { type VouCandidate } from './VouReference.vue'
import type {
  ProductFactsDraft,
  ProductFactLine,
} from './product-facts-data.ts'
import { getTargetProduct, queryTargetInventoryBookBalance } from '../../api.ts'
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
function remove(id: string) {
  requests.delete(id)
  pending.delete(id)
  emit('pending', pending.size > 0)
  update({ lines: props.modelValue.lines.filter((row) => row.id !== id) })
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
  if (!session.csrfToken || !session.can('/bob/product/get')) {
    error.value = '没有产品读取权限，无法采用产品单位。'
    return
  }
  pending.add(id)
  emit('pending', true)
  try {
    const current = await getTargetProduct(session.csrfToken, choice.objectId)
    if (
      !owns() ||
      requests.get(id) !== request ||
      !session.can('/bob/product/get')
    )
      return
    if (!current.enabled) throw new Error('产品已停用，请重新选择。')
    line(id, {
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
        @click="loadPreview(preview.page - 1)"
        >账面上一页</v-btn
      >
      <v-btn
        :disabled="
          disabled || previewLoading || preview.page * 20 >= preview.total
        "
        @click="loadPreview(preview.page + 1)"
        >账面下一页</v-btn
      >
    </template>
  </section>
  <section aria-label="商品明细">
    <v-card v-for="row in modelValue.lines" :key="row.id" class="pa-3 my-2">
      <VouReference
        entity="product"
        caption="产品"
        :model-value="row.product"
        :disabled="disabled"
        @update:model-value="product(row.id, $event)"
      />
      <FormBlock
        v-if="modelValue.entity !== 'inventory-count'"
        :fields="[
          {
            key: 'unitPrice',
            type: 'decimal',
            scale: 2,
            caption: '单价',
            required: true,
          },
        ]"
        :model-value="row"
        :disabled="disabled"
        @update:model-value="line(row.id, $event)"
      />
      <FormBlock
        v-else
        :fields="[
          {
            key: 'enteredQuantity',
            type: 'decimal',
            scale: 6,
            caption: '实盘数量',
            required: true,
          },
          {
            key: 'unitId',
            type: 'enum',
            caption: '录入单位',
            required: true,
            options:
              row.current?.data.unitConversions.map((item) => ({
                value: item.unit.id,
                caption: item.unit.name,
              })) ?? [],
          },
          {
            key: 'baseQuantity',
            type: 'decimal',
            scale: 6,
            caption: '基准数量',
            required: true,
          },
        ]"
        :model-value="row"
        :disabled="disabled"
        @update:model-value="line(row.id, $event)"
      />
      <FormBlock
        :fields="[{ key: 'remark', type: 'text', caption: '行备注' }]"
        :model-value="row"
        :disabled="disabled"
        @update:model-value="line(row.id, $event)"
      />
      <v-btn
        :prepend-icon="actionIcons.remove"
        :disabled="disabled"
        @click="remove(row.id)"
        >移除商品行</v-btn
      >
    </v-card>
    <v-btn
      :prepend-icon="actionIcons.add"
      :disabled="disabled"
      @click="
        update({
          lines: [
            ...modelValue.lines,
            {
              id: ulid(),
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
      "
      >添加商品行</v-btn
    >
  </section>
</template>
