<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  VoucherProductLineDraft,
  VoucherReference,
  VoucherUnitSnapshot,
} from './types'
import {
  calculateBaseQuantityLineAmount,
  addMoney,
  isMoney,
  isQuantity,
  suggestedBaseQuantity,
  sumMoney,
} from './decimal'
import VoucherReferenceAutocomplete from '@/components/common/ReferenceAutocomplete.vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
import { formatReferenceLabel } from '@/utils/reference-label'
import {
  FormulaEditorDialog,
  type ProductFormulaDraft,
} from '@/components/formula'

defineOptions({ name: 'VoucherProductLinesEditor' })

const props = withDefaults(
  defineProps<{
    modelValue: readonly VoucherProductLineDraft[]
    editable?: boolean
    productOptions?: readonly VoucherReference[]
    productLoading?: boolean
    productError?: string | null
    purchasePriceRequired?: boolean
    settlementSurchargeEnabled?: boolean
    deliverySpecificationEnabled?: boolean
    formulaEnabled?: boolean
  }>(),
  {
    editable: true,
    productOptions: () => [],
    productLoading: false,
    productError: null,
    purchasePriceRequired: false,
    settlementSurchargeEnabled: false,
    deliverySpecificationEnabled: false,
    formulaEnabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: VoucherProductLineDraft[]]
  'product-search': [keyword: string]
  'product-change': [index: number, value: VoucherReference | null]
}>()

const formulaIndex = ref<number | null>(null)
const formulaOpen = computed({
  get: () => formulaIndex.value !== null,
  set: (value: boolean) => {
    if (!value) formulaIndex.value = null
  },
})
const formulaLine = computed(() =>
  formulaIndex.value === null
    ? null
    : (props.modelValue[formulaIndex.value] ?? null),
)
const formulaEditable = computed(() =>
  Boolean(
    props.editable &&
    formulaLine.value?.product &&
    (formulaLine.value.product.behaviorProfile === 'STANDARD_FINISHED' ||
      formulaLine.value.product.behaviorProfile === 'CUSTOM_FINISHED'),
  ),
)

const duplicateProducts = computed(() => {
  const seen = new Set<string>()
  for (const line of props.modelValue) {
    if (!line.product) continue
    const key = `${line.product.objectId}/${line.product.approvalEntryId}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
})

const total = computed(() =>
  sumMoney(
    props.modelValue.map(
      (line) =>
        calculateBaseQuantityLineAmount(
          line.baseQuantity,
          addMoney(line.unitPrice, line.settlementSurcharge) ?? '',
          pricingFactor(line.product),
        ) ?? '',
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
      enteredQuantity: '',
      enteredUnit: null,
      baseQuantity: '',
      unitPrice: '',
      settlementSurcharge: '',
      purchaseUnitPrice: '',
      deliverySpecificationType: 'PACKAGED',
      remark: '',
      formula: null,
    },
  ])
}

function changeProduct(index: number, value: VoucherReference | null): void {
  const enteredUnit =
    value?.unitConversions?.find(
      (conversion) => conversion.unit.objectId === value.defaultInputUnitId,
    )?.unit ?? null
  updateLine(index, {
    product: value,
    enteredUnit,
    enteredQuantity: '',
    baseQuantity: '',
    formula: null,
    formulaError: '',
    formulaLoading: false,
  })
  emit('product-change', index, value)
}

function pricingFactor(product: VoucherReference | null): string {
  return (
    product?.unitConversions?.find(
      (conversion) => conversion.unit.objectId === product.pricingUnitId,
    )?.factor ?? ''
  )
}

function updateEnteredQuantity(index: number, value: string): void {
  const line = props.modelValue[index]
  if (!line) return
  updateLine(index, {
    enteredQuantity: value,
    baseQuantity: suggestedQuantity(value, line.product, line.enteredUnit),
  })
}

function changeEnteredUnit(index: number, objectId: string | null): void {
  const line = props.modelValue[index]
  if (!line?.product) return
  const enteredUnit =
    line.product.unitConversions?.find(
      (conversion) => conversion.unit.objectId === objectId,
    )?.unit ?? null
  updateLine(index, {
    enteredUnit,
    baseQuantity: suggestedQuantity(
      line.enteredQuantity,
      line.product,
      enteredUnit,
    ),
  })
}

function suggestedQuantity(
  enteredQuantity: string,
  product: VoucherReference | null,
  unit: VoucherUnitSnapshot | null,
): string {
  const factor = product?.unitConversions?.find(
    (conversion) => conversion.unit.objectId === unit?.objectId,
  )?.factor
  return factor ? (suggestedBaseQuantity(enteredQuantity, factor) ?? '') : ''
}

function unitLabel(unit: VoucherUnitSnapshot): string {
  return unit.symbol || unit.name || unit.code || unit.objectId
}

function openFormula(index: number): void {
  const line = props.modelValue[index]
  if (!line?.product || line.product.behaviorProfile === 'PACKAGING') return
  formulaIndex.value = index
}

function saveFormula(value: ProductFormulaDraft): void {
  if (formulaIndex.value === null) return
  updateLine(formulaIndex.value, {
    formula: value,
    formulaError: '',
  })
}

function removeLine(index: number): void {
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

    <AppSnackbar
      :message="duplicateProducts ? '同一产品不能重复添加。' : null"
    />

    <div class="voucher-lines__table-wrap responsive-table-wrap">
      <v-table
        class="voucher-lines__table responsive-table responsive-table--form"
      >
        <thead>
          <tr>
            <th>#</th>
            <th class="voucher-lines__reference">产品</th>
            <th v-if="deliverySpecificationEnabled">交付规格</th>
            <th>录入数量</th>
            <th>录入单位</th>
            <th>Base Quantity</th>
            <th>{{ settlementSurchargeEnabled ? '基础售价' : '单价' }}</th>
            <th v-if="settlementSurchargeEnabled">结算加价/kg</th>
            <th v-if="purchasePriceRequired">采购价</th>
            <th>金额</th>
            <th>备注</th>
            <th v-if="formulaEnabled">配方</th>
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
                @update:model-value="changeProduct(index, $event)"
              />
              <span v-else>
                {{ line.product ? formatReferenceLabel(line.product) : '—' }}
              </span>
            </td>
            <td v-if="deliverySpecificationEnabled" data-label="交付规格">
              <v-select
                v-if="editable"
                density="compact"
                hide-details
                :items="[
                  { title: '包装交付', value: 'PACKAGED' },
                  { title: '散装液体', value: 'BULK_LIQUID' },
                ]"
                :model-value="line.deliverySpecificationType"
                variant="outlined"
                @update:model-value="
                  updateLine(index, { deliverySpecificationType: $event })
                "
              />
              <span v-else>{{
                line.deliverySpecificationType === 'BULK_LIQUID'
                  ? '散装液体'
                  : '包装交付'
              }}</span>
            </td>
            <td data-label="录入数量">
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.enteredQuantity"
                :rules="[
                  (v: string) =>
                    isQuantity(v) || '请输入大于零且最多六位小数的数量。',
                ]"
                @update:model-value="updateEnteredQuantity(index, $event)"
              />
              <span v-else>{{ line.enteredQuantity }}</span>
            </td>
            <td data-label="录入单位">
              <v-select
                v-if="editable"
                density="compact"
                :disabled="!line.product"
                hide-details
                :items="line.product?.unitConversions ?? []"
                item-title="unit.name"
                item-value="unit.objectId"
                :model-value="line.enteredUnit?.objectId ?? null"
                variant="outlined"
                @update:model-value="changeEnteredUnit(index, $event)"
              >
                <template #selection="{ item }">
                  {{ unitLabel(item.unit) }}
                </template>
                <template #item="{ props: itemProps, item }">
                  <v-list-item
                    v-bind="itemProps"
                    :title="unitLabel(item.unit)"
                  />
                </template>
              </v-select>
              <span v-else>{{
                line.enteredUnit ? unitLabel(line.enteredUnit) : '—'
              }}</span>
            </td>
            <td data-label="Base Quantity">
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.baseQuantity"
                :rules="[
                  (v: string) =>
                    isQuantity(v) ||
                    '请输入大于零且最多六位小数的 Base Quantity。',
                ]"
                @update:model-value="
                  updateLine(index, { baseQuantity: $event })
                "
              />
              <span v-else>{{ line.baseQuantity }}</span>
            </td>
            <td :data-label="settlementSurchargeEnabled ? '基础售价' : '单价'">
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.unitPrice"
                :rules="[
                  (v: string) =>
                    isMoney(v, true) || '请输入不小于零且最多两位小数的单价。',
                ]"
                @update:model-value="
                  updateLine(index, { unitPrice: $event, priceDirty: true })
                "
              />
              <span v-else>{{ line.unitPrice }}</span>
              <small
                v-if="line.referenceUnitPrice !== undefined"
                class="voucher-lines__reference-price"
              >
                参考 {{ line.referenceUnitPrice
                }}<template v-if="line.referenceDocumentNo">
                  · {{ line.referenceDocumentNo }}</template
                >
                <template v-else> · 无来源</template>
              </small>
            </td>
            <td v-if="settlementSurchargeEnabled" data-label="结算加价/kg">
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.settlementSurcharge"
                placeholder="按结算方式"
                :rules="[
                  (v: string) =>
                    !v ||
                    isMoney(v, true) ||
                    '请输入非负且最多两位小数的加价。',
                ]"
                @update:model-value="
                  updateLine(index, { settlementSurcharge: $event })
                "
              />
              <span v-else>{{ line.settlementSurcharge || '0.00' }}</span>
            </td>
            <td v-if="purchasePriceRequired" data-label="采购价">
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.purchaseUnitPrice"
                :rules="[
                  (v: string) =>
                    isMoney(v) || '请输入大于零且最多两位小数的采购单价。',
                ]"
                @update:model-value="
                  updateLine(index, { purchaseUnitPrice: $event })
                "
              />
              <span v-else>{{ line.purchaseUnitPrice }}</span>
            </td>
            <td class="text-end" data-label="金额">
              {{
                calculateBaseQuantityLineAmount(
                  line.baseQuantity,
                  addMoney(line.unitPrice, line.settlementSurcharge) ?? '',
                  pricingFactor(line.product),
                ) ?? '—'
              }}
            </td>
            <td data-label="备注">
              <CompactTableField
                v-if="editable"
                :maxlength="1000"
                :model-value="line.remark"
                :rules="[
                  (v: string) =>
                    Array.from(v ?? '').length <= 1000 ||
                    '备注不能超过 1000 字。',
                ]"
                @update:model-value="updateLine(index, { remark: $event })"
              />
              <span v-else>{{ line.remark || '—' }}</span>
            </td>
            <td v-if="formulaEnabled" data-label="配方">
              <span v-if="line.product?.behaviorProfile === 'PACKAGING'"
                >—</span
              >
              <v-btn
                v-else-if="line.product"
                :color="line.formulaError ? 'error' : undefined"
                :loading="line.formulaLoading"
                size="small"
                :variant="line.formulaError ? 'tonal' : 'text'"
                @click="openFormula(index)"
              >
                {{
                  line.formulaError
                    ? '待填写'
                    : line.formula
                      ? editable
                        ? '编辑'
                        : '查看'
                      : '待填写'
                }}
              </v-btn>
              <span v-else>—</span>
            </td>
            <td
              v-if="editable"
              class="responsive-table__actions"
              data-label="操作"
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
          <tr
            v-if="modelValue.length === 0"
            class="responsive-table__empty-row"
          >
            <td
              :colspan="
                8 +
                (purchasePriceRequired ? 1 : 0) +
                (settlementSurchargeEnabled ? 1 : 0) +
                (deliverySpecificationEnabled ? 1 : 0) +
                (formulaEnabled ? 1 : 0) +
                (editable ? 1 : 0)
              "
              class="text-center py-8"
            >
              暂无产品明细
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td
              :colspan="
                6 +
                (purchasePriceRequired ? 1 : 0) +
                (settlementSurchargeEnabled ? 1 : 0) +
                (deliverySpecificationEnabled ? 1 : 0)
              "
              class="text-end font-weight-bold"
              data-label=""
            >
              合计
            </td>
            <td class="text-end font-weight-bold" data-label="金额">
              {{ total ?? '—' }}
            </td>
            <td
              :colspan="1 + (formulaEnabled ? 1 : 0) + (editable ? 1 : 0)"
              data-label=""
            />
          </tr>
        </tfoot>
      </v-table>
    </div>
  </section>

  <FormulaEditorDialog
    v-if="formulaLine?.product"
    v-model:open="formulaOpen"
    :editable="formulaEditable"
    :model-value="formulaLine.formula"
    :product="formulaLine.product"
    :source-document-no="formulaLine.formula?.sourceDocumentNo"
    :source-type="formulaLine.formula?.sourceType"
    @save="saveFormula"
  />
</template>

<style scoped>
.voucher-lines__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.voucher-lines__header h3 {
  margin: 0;
}
.voucher-lines__header span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.voucher-lines__table-wrap {
  overflow-x: auto;
}
.voucher-lines__table {
  min-width: 1080px;
}
.voucher-lines__reference {
  min-width: 280px;
}
.voucher-lines__table :deep(.v-input) {
  min-width: 140px;
}
.voucher-lines__reference-price {
  display: block;
  margin-top: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 11px;
}
</style>
