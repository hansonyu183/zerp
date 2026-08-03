<script setup lang="ts">
import type { VoucherProductionOutputDraft, VoucherReference } from './types'
import CompactTableField from '@/components/common/CompactTableField.vue'
import VoucherReferenceAutocomplete from '@/components/common/ReferenceAutocomplete.vue'
import { formatReferenceLabel } from '@/utils/reference-label'

defineOptions({ name: 'VoucherProductionLinesEditor' })

const props = withDefaults(
  defineProps<{
    modelValue: VoucherProductionOutputDraft[]
    editable: boolean
    mode: 'order' | 'self'
    productOptions: readonly VoucherReference[]
    productLoading?: boolean
    productError?: string | null
    materialOptions: readonly VoucherReference[]
    materialLoading?: boolean
    materialError?: string | null
  }>(),
  {
    productLoading: false,
    productError: null,
    materialLoading: false,
    materialError: null,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: VoucherProductionOutputDraft[]]
  'add-line': []
  'product-search': [keyword: string]
  'product-change': [index: number, product: VoucherReference | null]
  'material-search': [keyword: string]
  recalculate: [line: VoucherProductionOutputDraft]
}>()

function removeLine(index: number): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, itemIndex) => itemIndex !== index),
  )
}

function updateOutputQuantity(
  line: VoucherProductionOutputDraft,
  value: string | null,
): void {
  line.outputQuantity = value ?? ''
  emit('recalculate', line)
}

function updateLossRate(
  line: VoucherProductionOutputDraft,
  value: string | null,
): void {
  line.lossRate = value ?? ''
  emit('recalculate', line)
}
</script>

<template>
  <section class="production-lines">
    <div class="production-lines__heading">
      <div>
        <h3>生产明细</h3>
        <p>损耗比例按成品行设置；建议用量自动计算，实际领料可调整。</p>
      </div>
      <v-btn
        v-if="editable && mode === 'self'"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="emit('add-line')"
      >
        添加成品
      </v-btn>
    </div>

    <v-alert v-if="modelValue.length === 0" type="info" variant="tonal">
      {{
        mode === 'order'
          ? '请选择销售订单，系统会带入其中可生产的成品和配方。'
          : '请添加至少一个标准成品。'
      }}
    </v-alert>

    <v-card
      v-for="(line, index) in modelValue"
      :key="line.key"
      class="mb-4"
      rounded="lg"
      variant="outlined"
    >
      <v-card-title class="production-lines__line-title">
        <span>成品 {{ index + 1 }}</span>
        <v-btn
          v-if="editable"
          aria-label="移除此成品"
          icon="mdi-delete-outline"
          size="small"
          variant="text"
          @click="removeLine(index)"
        />
      </v-card-title>
      <v-card-text>
        <div class="production-lines__output-grid">
          <VoucherReferenceAutocomplete
            :disabled="!editable || mode === 'order'"
            :error-message="line.formulaError || productError"
            label="成品"
            :loading="line.formulaLoading || productLoading"
            :model-value="line.product"
            :options="productOptions"
            required
            @search="emit('product-search', $event)"
            @update:model-value="emit('product-change', index, $event)"
          />
          <v-text-field
            :disabled="!editable"
            inputmode="decimal"
            label="入库数量"
            :model-value="line.outputQuantity"
            variant="outlined"
            @update:model-value="updateOutputQuantity(line, $event)"
          />
          <v-text-field
            :disabled="!editable"
            hint="0–100，支持 6 位小数"
            inputmode="decimal"
            label="损耗比例（%）"
            :model-value="line.lossRate"
            variant="outlined"
            @update:model-value="updateLossRate(line, $event)"
          />
          <v-text-field
            :model-value="line.formulaBaseOutputQuantity"
            label="配方基准产量"
            readonly
            variant="outlined"
          />
          <v-text-field
            v-model="line.remark"
            class="production-lines__remark"
            :disabled="!editable"
            label="成品备注"
            maxlength="1000"
            variant="outlined"
          />
        </div>

        <v-table
          class="production-lines__materials responsive-table responsive-table--form"
        >
          <thead>
            <tr>
              <th>配方材料</th>
              <th>配方用量</th>
              <th>建议领料</th>
              <th>实际材料</th>
              <th>实际领料</th>
              <th>调整原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="material in line.materials" :key="material.key">
              <td data-label="配方材料">
                {{ formatReferenceLabel(material.formulaMaterial) }}
              </td>
              <td data-label="配方用量">{{ material.formulaQuantity }}</td>
              <td data-label="建议领料">
                {{ material.suggestedQuantity || '—' }}
              </td>
              <td
                class="production-lines__material-reference"
                data-label="实际材料"
              >
                <VoucherReferenceAutocomplete
                  :disabled="!editable"
                  :error-message="materialError"
                  label="实际材料"
                  :loading="materialLoading"
                  :model-value="material.actualMaterial"
                  :options="materialOptions"
                  required
                  table
                  @search="emit('material-search', $event)"
                  @update:model-value="material.actualMaterial = $event"
                />
              </td>
              <td data-label="实际领料">
                <CompactTableField
                  v-model="material.actualQuantity"
                  :disabled="!editable"
                  inputmode="decimal"
                  label="实际领料"
                />
              </td>
              <td data-label="调整原因">
                <CompactTableField
                  v-model="material.adjustmentReason"
                  :disabled="!editable"
                  label="替换或数量调整时必填"
                  :maxlength="1000"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </section>
</template>

<style scoped>
.production-lines__heading {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}
.production-lines__heading h3,
.production-lines__heading p {
  margin: 0;
}
.production-lines__heading p {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.875rem;
  margin-top: 4px;
}
.production-lines__line-title {
  align-items: center;
  display: flex;
  justify-content: space-between;
}
.production-lines__output-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.production-lines__remark {
  grid-column: 1 / -1;
}
.production-lines__materials {
  overflow-x: auto;
}
.production-lines__materials :deep(table) {
  min-width: 1080px;
}
.production-lines__material-reference {
  min-width: 240px;
}
@media (max-width: 960px) {
  .production-lines__output-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
