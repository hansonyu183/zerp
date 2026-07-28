<script setup lang="ts">
import { computed } from 'vue'
import {
  calculateLineAmount,
  isMoney,
  isQuantity,
  sumMoney,
  VoucherReferenceAutocomplete,
} from '@/components/voucher'
import type {
  IntermediaryOrderLineDraft,
  IntermediaryProductReference,
} from './types'
import CompactTableField from '@/components/common/CompactTableField.vue'

const props = withDefaults(defineProps<{
  modelValue: readonly IntermediaryOrderLineDraft[]
  editable?: boolean
  productOptions?: readonly IntermediaryProductReference[]
  productLoading?: boolean
  productError?: string | null
}>(), {
  editable: true,
  productOptions: () => [],
  productLoading: false,
  productError: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: IntermediaryOrderLineDraft[]]
  'product-search': [keyword: string]
}>()

const total = computed(() =>
  sumMoney(
    props.modelValue.map((line) =>
      calculateLineAmount(line.orderedQuantity, line.unitPrice) ?? '',
    ),
  ),
)

const duplicate = computed(() => {
  const ids = props.modelValue
    .filter((line) => line.product)
    .map((line) => `${line.product!.objectId}/${line.product!.versionId}`)
  return new Set(ids).size !== ids.length
})

function update(
  index: number,
  changes: Partial<IntermediaryOrderLineDraft>,
): void {
  emit(
    'update:modelValue',
    props.modelValue.map((line, lineIndex) =>
      lineIndex === index ? { ...line, ...changes } : { ...line },
    ),
  )
}

function selectProduct(
  index: number,
  product: IntermediaryProductReference | null,
): void {
  update(index, {
    product,
    containerType: product?.containerType ?? 'NONE',
    quantityPerContainer: product?.quantityPerContainer ?? '',
  })
}

function changeContainerType(index: number, value: unknown): void {
  const containerType =
    value === 'SOLVENT' || value === 'RESIN' ? value : 'NONE'
  update(index, {
    containerType,
    ...(containerType === 'NONE' ? { quantityPerContainer: '' } : {}),
  })
}

function add(): void {
  if (!props.editable || props.modelValue.length >= 200) return
  emit('update:modelValue', [
    ...props.modelValue.map((line) => ({ ...line })),
    {
      key: crypto.randomUUID(),
      product: null,
      orderedQuantity: '',
      unitPrice: '',
      containerType: 'NONE',
      quantityPerContainer: '',
      remark: '',
    },
  ])
}

function remove(index: number): void {
  if (!props.editable) return
  emit(
    'update:modelValue',
    props.modelValue
      .filter((_, lineIndex) => lineIndex !== index)
      .map((line) => ({ ...line })),
  )
}
</script>

<template>
  <section>
    <div class="intermediary-lines__header">
      <div>
        <h3>居间订单明细</h3>
        <span>包装设置来自产品主数据快照，本单草稿可覆盖</span>
      </div>
      <v-btn
        v-if="editable"
        :disabled="modelValue.length >= 200"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="add"
      >
        添加产品
      </v-btn>
    </div>
    <v-alert
      v-if="duplicate"
      class="mb-3"
      density="compact"
      type="error"
      variant="tonal"
    >
      同一产品不能重复添加。
    </v-alert>
    <div class="intermediary-lines__wrap">
      <v-table class="intermediary-lines__table">
        <thead>
          <tr>
            <th>#</th><th>产品</th><th>订购</th><th>售价</th>
            <th>包装</th><th>桶量</th><th>金额</th><th>备注</th>
            <th v-if="editable" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in modelValue" :key="line.key">
            <td>{{ index + 1 }}</td>
            <td>
              <VoucherReferenceAutocomplete
                v-if="editable"
                :error-message="productError"
                label="产品"
                :loading="productLoading"
                :model-value="line.product"
                :options="productOptions"
                required
                @search="emit('product-search', $event)"
                @update:model-value="selectProduct(index, $event as IntermediaryProductReference | null)"
              />
              <span v-else>{{ line.product ? `${line.product.code} · ${line.product.name}` : '—' }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="editable"
                :model-value="line.orderedQuantity"
                :rules="[(value: string) => isQuantity(value) || '数量格式不正确。']"
                @update:model-value="update(index, { orderedQuantity: $event })"
              />
              <span v-else>{{ line.orderedQuantity }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="editable"
                :model-value="line.unitPrice"
                :rules="[(value: string) => isMoney(value) || '单价格式不正确。']"
                @update:model-value="update(index, { unitPrice: $event })"
              />
              <span v-else>{{ line.unitPrice }}</span>
            </td>
            <td>
              <v-select
                v-if="editable"
                density="compact"
                hide-details
                :items="[
                  { title: '无桶包装', value: 'NONE' },
                  { title: '溶剂桶', value: 'SOLVENT' },
                  { title: '树脂桶', value: 'RESIN' },
                ]"
                :model-value="line.containerType"
                variant="outlined"
                @update:model-value="changeContainerType(index, $event)"
              />
              <span v-else>{{ { NONE: '无桶包装', SOLVENT: '溶剂桶', RESIN: '树脂桶' }[line.containerType] }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="editable && line.containerType !== 'NONE'"
                :model-value="line.quantityPerContainer"
                :rules="[(value: string) => isQuantity(value) || '每桶产品量格式不正确。']"
                @update:model-value="update(index, { quantityPerContainer: $event })"
              />
              <span v-else>{{ line.quantityPerContainer || '—' }}</span>
            </td>
            <td class="text-end">{{ calculateLineAmount(line.orderedQuantity, line.unitPrice) ?? '—' }}</td>
            <td>
              <CompactTableField
                v-if="editable"
                :maxlength="1000"
                :model-value="line.remark"
                :rules="[(value: string) => Array.from(value ?? '').length <= 1000 || '备注不能超过 1000 字。']"
                @update:model-value="update(index, { remark: $event })"
              />
              <span v-else>{{ line.remark || '—' }}</span>
            </td>
            <td v-if="editable">
              <v-btn
                :aria-label="`删除第 ${index + 1} 行`"
                color="error"
                icon="mdi-delete-outline"
                variant="text"
                @click="remove(index)"
              />
            </td>
          </tr>
          <tr v-if="modelValue.length === 0">
            <td :colspan="editable ? 9 : 8" class="text-center py-8">暂无产品明细</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" class="text-end font-weight-bold">销售金额合计</td>
            <td class="text-end font-weight-bold">{{ total ?? '—' }}</td>
            <td :colspan="editable ? 2 : 1" />
          </tr>
        </tfoot>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.intermediary-lines__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.intermediary-lines__header h3 { margin: 0; }
.intermediary-lines__header span { color: rgb(var(--v-theme-on-surface-variant)); font-size: 12px; }
.intermediary-lines__wrap { overflow-x: auto; }
.intermediary-lines__table { min-width: 1380px; }
.intermediary-lines__table :deep(.v-input) { min-width: 140px; }
.intermediary-lines__table td:nth-child(2) :deep(.v-input) { min-width: 260px; }
</style>
