<script setup lang="ts">
import type {
  VoucherProductionMaterialDraft,
  VoucherProductionOutputDraft,
  VoucherReference,
  VoucherUnitSnapshot,
} from './types'
import CompactTableField from '@/components/common/CompactTableField.vue'
import VoucherReferenceAutocomplete from '@/components/common/ReferenceAutocomplete.vue'
import { suggestedBaseQuantity as calculateSuggestedBaseQuantity } from './decimal'
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

function conversionFactor(
  product: VoucherReference | null,
  unit: VoucherUnitSnapshot | null,
): string | null {
  if (!product || !unit) return null
  return (
    product.unitConversions?.find(
      (conversion) => conversion.unit.objectId === unit.objectId,
    )?.factor ?? null
  )
}

function suggestBaseQuantityFromEntry(
  product: VoucherReference | null,
  enteredQuantity: string,
  enteredUnit: VoucherUnitSnapshot | null,
): string | null {
  const factor = conversionFactor(product, enteredUnit)
  return factor ? calculateSuggestedBaseQuantity(enteredQuantity, factor) : null
}

function updateOutputEnteredQuantity(
  line: VoucherProductionOutputDraft,
  value: string | null,
): void {
  line.enteredQuantity = value ?? ''
  line.baseQuantity =
    suggestBaseQuantityFromEntry(
      line.product,
      line.enteredQuantity,
      line.enteredUnit,
    ) ?? line.baseQuantity
  emit('recalculate', line)
}

function updateOutputEnteredUnit(
  line: VoucherProductionOutputDraft,
  value: VoucherUnitSnapshot | null,
): void {
  line.enteredUnit = value
  line.baseQuantity =
    suggestBaseQuantityFromEntry(line.product, line.enteredQuantity, value) ??
    line.baseQuantity
  emit('recalculate', line)
}

function updateActualMaterial(
  material: VoucherProductionMaterialDraft,
  product: VoucherReference | null,
): void {
  material.actualMaterial = product
  material.actualEnteredUnit =
    product?.unitConversions?.find(
      (conversion) => conversion.unit.objectId === product.defaultInputUnitId,
    )?.unit ?? null
  material.actualEnteredQuantity = ''
}

function updateActualEnteredQuantity(
  material: VoucherProductionMaterialDraft,
  value: string | null,
): void {
  material.actualEnteredQuantity = value ?? ''
  material.actualBaseQuantity =
    suggestBaseQuantityFromEntry(
      material.actualMaterial,
      material.actualEnteredQuantity,
      material.actualEnteredUnit,
    ) ?? material.actualBaseQuantity
}

function updateActualEnteredUnit(
  material: VoucherProductionMaterialDraft,
  value: VoucherUnitSnapshot | null,
): void {
  material.actualEnteredUnit = value
  material.actualBaseQuantity =
    suggestBaseQuantityFromEntry(
      material.actualMaterial,
      material.actualEnteredQuantity,
      value,
    ) ?? material.actualBaseQuantity
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
            label="录入数量"
            :model-value="line.enteredQuantity"
            variant="outlined"
            @update:model-value="updateOutputEnteredQuantity(line, $event)"
          />
          <v-select
            :disabled="!editable || !line.product"
            item-title="unit.name"
            :items="line.product?.unitConversions ?? []"
            label="录入单位"
            :model-value="
              line.product?.unitConversions?.find(
                (conversion) =>
                  conversion.unit.objectId === line.enteredUnit?.objectId,
              ) ?? null
            "
            return-object
            variant="outlined"
            @update:model-value="
              updateOutputEnteredUnit(line, $event?.unit ?? null)
            "
          >
            <template #selection="{ item }">
              {{ item.unit.name
              }}{{ item.unit.symbol ? ` (${item.unit.symbol})` : '' }}
            </template>
            <template #item="{ item, props: itemProps }">
              <v-list-item
                v-bind="itemProps"
                :subtitle="`换算系数：${item.factor}`"
                :title="item.unit.name"
              />
            </template>
          </v-select>
          <v-text-field
            v-model="line.baseQuantity"
            :disabled="!editable"
            inputmode="decimal"
            label="入库 Base Quantity"
            variant="outlined"
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
            :model-value="line.formulaBaseQuantity"
            label="配方 Base Quantity"
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
              <th>配方 Base Quantity</th>
              <th>建议领料 Base Quantity</th>
              <th>实际材料</th>
              <th>实际录入数量</th>
              <th>实际录入单位</th>
              <th>实际领料 Base Quantity</th>
              <th>调整原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="material in line.materials" :key="material.key">
              <td data-label="配方材料">
                {{ formatReferenceLabel(material.formulaMaterial) }}
              </td>
              <td data-label="配方 Base Quantity">
                {{ material.formulaBaseQuantity }}
              </td>
              <td data-label="建议领料 Base Quantity">
                {{ material.suggestedBaseQuantity || '—' }}
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
                  @update:model-value="updateActualMaterial(material, $event)"
                />
              </td>
              <td data-label="实际录入数量">
                <CompactTableField
                  :disabled="!editable"
                  inputmode="decimal"
                  label="实际录入数量"
                  :model-value="material.actualEnteredQuantity"
                  @update:model-value="
                    updateActualEnteredQuantity(material, $event)
                  "
                />
              </td>
              <td data-label="实际录入单位">
                <v-select
                  :disabled="!editable || !material.actualMaterial"
                  item-title="unit.name"
                  :items="material.actualMaterial?.unitConversions ?? []"
                  label="实际录入单位"
                  :model-value="
                    material.actualMaterial?.unitConversions?.find(
                      (conversion) =>
                        conversion.unit.objectId ===
                        material.actualEnteredUnit?.objectId,
                    ) ?? null
                  "
                  return-object
                  variant="outlined"
                  @update:model-value="
                    updateActualEnteredUnit(material, $event?.unit ?? null)
                  "
                >
                  <template #selection="{ item }">
                    {{ item.unit.name
                    }}{{ item.unit.symbol ? ` (${item.unit.symbol})` : '' }}
                  </template>
                  <template #item="{ item, props: itemProps }">
                    <v-list-item
                      v-bind="itemProps"
                      :subtitle="`换算系数：${item.factor}`"
                      :title="item.unit.name"
                    />
                  </template>
                </v-select>
              </td>
              <td data-label="实际领料 Base Quantity">
                <CompactTableField
                  v-model="material.actualBaseQuantity"
                  :disabled="!editable"
                  inputmode="decimal"
                  label="实际领料 Base Quantity"
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
