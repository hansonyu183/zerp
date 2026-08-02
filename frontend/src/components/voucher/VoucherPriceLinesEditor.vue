<script setup lang="ts">
import type { VoucherPriceLineDraft, VoucherReference } from './types'
import { isMoney } from './decimal'
import VoucherReferenceAutocomplete from './VoucherReferenceAutocomplete.vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
import { formatReferenceLabel } from '@/utils/reference-label'

const props = withDefaults(
  defineProps<{
    modelValue: readonly VoucherPriceLineDraft[]
    editable?: boolean
    productOptions?: readonly VoucherReference[]
    productLoading?: boolean
    productError?: string | null
  }>(),
  {
    editable: true,
    productOptions: () => [],
    productLoading: false,
    productError: null,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: VoucherPriceLineDraft[]]
  'product-search': [keyword: string]
}>()

function updateLine(index: number, changes: Partial<VoucherPriceLineDraft>) {
  emit(
    'update:modelValue',
    props.modelValue.map((line, i) =>
      i === index ? { ...line, ...changes } : { ...line },
    ),
  )
}
function addLine() {
  if (!props.editable || props.modelValue.length >= 200) return
  emit('update:modelValue', [
    ...props.modelValue.map((line) => ({ ...line })),
    {
      key: crypto.randomUUID(),
      product: null,
      unitPrice: '',
      remark: '',
    },
  ])
}
function removeLine(index: number) {
  if (!props.editable) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index).map((line) => ({ ...line })),
  )
}
</script>

<template>
  <section class="price-lines">
    <div class="price-lines__header">
      <div>
        <h3>价格明细</h3>
        <span>共 {{ modelValue.length }} 行，最多 200 行</span>
      </div>
      <v-btn
        v-if="editable"
        :disabled="modelValue.length >= 200"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="addLine"
        >添加产品</v-btn
      >
    </div>
    <div class="responsive-table-wrap">
      <v-table
        class="responsive-table responsive-table--form price-lines__table"
      >
        <thead>
          <tr>
            <th>#</th>
            <th>产品</th>
            <th>单价</th>
            <th>备注</th>
            <th v-if="editable" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in modelValue" :key="line.key">
            <td data-label="行">{{ index + 1 }}</td>
            <td data-label="产品">
              <VoucherReferenceAutocomplete
                v-if="editable"
                :error-message="productError"
                label="产品"
                :loading="productLoading"
                :model-value="line.product"
                :options="productOptions"
                required
                table
                @search="emit('product-search', $event)"
                @update:model-value="updateLine(index, { product: $event })"
              />
              <span v-else>{{
                line.product ? formatReferenceLabel(line.product) : '—'
              }}</span>
            </td>
            <td data-label="单价">
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.unitPrice"
                :rules="[
                  (v: string) =>
                    isMoney(v, true) || '请输入非负且最多两位小数的单价。',
                ]"
                @update:model-value="updateLine(index, { unitPrice: $event })"
              />
              <span v-else>{{ line.unitPrice }}</span>
            </td>
            <td data-label="备注">
              <CompactTableField
                v-if="editable"
                :model-value="line.remark"
                @update:model-value="updateLine(index, { remark: $event })"
              /><span v-else>{{ line.remark || '—' }}</span>
            </td>
            <td
              v-if="editable"
              data-label="操作"
              class="responsive-table__actions"
            >
              <v-btn
                :aria-label="`删除第 ${index + 1} 行`"
                color="error"
                icon="mdi-delete-outline"
                variant="text"
                @click="removeLine(index)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.price-lines__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.price-lines__header h3 {
  margin: 0;
}
.price-lines__header span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.price-lines__table {
  min-width: 760px;
}
</style>
