<script setup lang="ts">
import { computed } from 'vue'
import type {
  VoucherProductLineDraft,
  VoucherReference,
} from './types'
import {
  calculateLineAmount,
  isMoney,
  isQuantity,
  sumMoney,
} from './decimal'
import VoucherReferenceAutocomplete from './VoucherReferenceAutocomplete.vue'

defineOptions({ name: 'VoucherProductLinesEditor' })

const props = withDefaults(defineProps<{
  modelValue: readonly VoucherProductLineDraft[]
  editable?: boolean
  productOptions?: readonly VoucherReference[]
  productLoading?: boolean
  productError?: string | null
}>(), {
  editable: true,
  productOptions: () => [],
  productLoading: false,
  productError: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: VoucherProductLineDraft[]]
  'product-search': [keyword: string]
}>()

const duplicateProducts = computed(() => {
  const seen = new Set<string>()
  for (const line of props.modelValue) {
    if (!line.product) continue
    const key = `${line.product.objectId}/${line.product.versionId}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
})

const total = computed(() =>
  sumMoney(
    props.modelValue.map((line) =>
      calculateLineAmount(line.orderedQuantity, line.unitPrice) ?? '',
    ),
  ),
)

function updateLine(
  index: number,
  changes: Partial<VoucherProductLineDraft>,
): void {
  emit(
    'update:modelValue',
    props.modelValue.map((line, lineIndex) =>
      lineIndex === index ? { ...line, ...changes } : { ...line },
    ),
  )
}

function addLine(): void {
  if (!props.editable || props.modelValue.length >= 200) return
  emit('update:modelValue', [
    ...props.modelValue.map((line) => ({ ...line })),
    {
      key: crypto.randomUUID(),
      product: null,
      orderedQuantity: '',
      unitPrice: '',
      remark: '',
    },
  ])
}

function removeLine(index: number): void {
  if (!props.editable) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, lineIndex) => lineIndex !== index)
      .map((line) => ({ ...line })),
  )
}
</script>

<template>
  <section class="voucher-lines">
    <div class="voucher-lines__header">
      <div>
        <h3>产品明细</h3>
        <span>共 {{ modelValue.length }} 行，最多 200 行</span>
      </div>
      <v-btn
        v-if="editable"
        :disabled="modelValue.length >= 200"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="addLine"
      >
        添加产品
      </v-btn>
    </div>

    <v-alert
      v-if="duplicateProducts"
      class="mb-3"
      density="compact"
      type="error"
      variant="tonal"
    >
      同一产品不能重复添加。
    </v-alert>

    <div class="voucher-lines__table-wrap">
      <v-table class="voucher-lines__table">
        <thead>
          <tr>
            <th>#</th>
            <th class="voucher-lines__reference">产品</th>
            <th>数量</th>
            <th>含税单价</th>
            <th>行金额</th>
            <th>备注</th>
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
                @update:model-value="updateLine(index, { product: $event })"
              />
              <span v-else>
                {{ line.product ? `${line.product.code} · ${line.product.name}` : '—' }}
              </span>
            </td>
            <td>
              <v-text-field
                v-if="editable"
                density="compact"
                hide-details="auto"
                inputmode="decimal"
                :model-value="line.orderedQuantity"
                :rules="[
                  (v: string) => isQuantity(v) ||
                    '请输入大于零且最多六位小数的数量。',
                ]"
                variant="outlined"
                @update:model-value="updateLine(index, { orderedQuantity: $event })"
              />
              <span v-else>{{ line.orderedQuantity }}</span>
            </td>
            <td>
              <v-text-field
                v-if="editable"
                density="compact"
                hide-details="auto"
                inputmode="decimal"
                :model-value="line.unitPrice"
                :rules="[
                  (v: string) => isMoney(v) ||
                    '请输入大于零且最多两位小数的单价。',
                ]"
                variant="outlined"
                @update:model-value="updateLine(index, { unitPrice: $event })"
              />
              <span v-else>{{ line.unitPrice }}</span>
            </td>
            <td class="text-end">
              {{ calculateLineAmount(line.orderedQuantity, line.unitPrice) ?? '—' }}
            </td>
            <td>
              <v-text-field
                v-if="editable"
                counter="1000"
                density="compact"
                hide-details="auto"
                :model-value="line.remark"
                :rules="[(v: string) => Array.from(v ?? '').length <= 1000 || '备注不能超过 1000 字。']"
                variant="outlined"
                @update:model-value="updateLine(index, { remark: $event })"
              />
              <span v-else>{{ line.remark || '—' }}</span>
            </td>
            <td v-if="editable">
              <v-btn
                :aria-label="`删除第 ${index + 1} 行`"
                color="error"
                icon="mdi-delete-outline"
                variant="text"
                @click="removeLine(index)"
              />
            </td>
          </tr>
          <tr v-if="modelValue.length === 0">
            <td :colspan="editable ? 7 : 6" class="text-center py-8">
              暂无产品明细
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td :colspan="editable ? 4 : 3" class="text-end font-weight-bold">
              合计
            </td>
            <td class="text-end font-weight-bold">{{ total ?? '—' }}</td>
            <td :colspan="editable ? 2 : 1" />
          </tr>
        </tfoot>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.voucher-lines__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.voucher-lines__header h3 { margin: 0; }
.voucher-lines__header span { color: rgb(var(--v-theme-on-surface-variant)); font-size: 12px; }
.voucher-lines__table-wrap { overflow-x: auto; }
.voucher-lines__table { min-width: 1080px; }
.voucher-lines__reference { min-width: 280px; }
.voucher-lines__table :deep(.v-input) { min-width: 140px; }
</style>
