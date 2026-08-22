<script setup lang="ts">
import type {
  VoucherInventoryCountLineDraft,
  VoucherReference,
  VoucherUnitSnapshot,
} from './types'
import { isQuantity, parseFixed, suggestedBaseQuantity } from './decimal'
import VoucherReferenceAutocomplete from '@/components/common/ReferenceAutocomplete.vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
import { formatReferenceLabel } from '@/utils/reference-label'

const props = withDefaults(
  defineProps<{
    modelValue: readonly VoucherInventoryCountLineDraft[]
    editable?: boolean
    loading?: boolean
    canLoadBalance?: boolean
    productOptions?: readonly VoucherReference[]
    productLoading?: boolean
    productError?: string | null
  }>(),
  {
    editable: true,
    loading: false,
    canLoadBalance: false,
    productOptions: () => [],
    productLoading: false,
    productError: null,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: VoucherInventoryCountLineDraft[]]
  'product-search': [keyword: string]
  'load-balance': []
}>()

function updateLine(
  index: number,
  changes: Partial<VoucherInventoryCountLineDraft>,
) {
  emit(
    'update:modelValue',
    props.modelValue.map((line, current) =>
      current === index ? { ...line, ...changes } : { ...line },
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
      enteredQuantity: '',
      enteredUnit: null,
      baseQuantity: '',
      remark: '',
    },
  ])
}

function removeLine(index: number) {
  if (!props.editable) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, current) => current !== index),
  )
}

function formatMicros(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 1_000_000n
  const fraction = String(absolute % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

function previewDifference(line: VoucherInventoryCountLineDraft): string {
  if (line.differenceBaseQuantity !== undefined)
    return line.differenceBaseQuantity
  if (line.bookBaseQuantity === undefined) return '—'
  const actual = parseFixed(line.baseQuantity, 6, true)
  const book = parseFixed(line.bookBaseQuantity, 6, true)
  return actual === null || book === null ? '—' : formatMicros(actual - book)
}

function changeProduct(index: number, product: VoucherReference | null): void {
  const enteredUnit =
    product?.unitConversions?.find(
      (conversion) => conversion.unit.objectId === product.defaultInputUnitId,
    )?.unit ?? null
  updateLine(index, {
    product,
    enteredUnit,
    enteredQuantity: '',
    baseQuantity: '',
  })
}

function updateEnteredQuantity(index: number, enteredQuantity: string): void {
  const line = props.modelValue[index]
  updateLine(index, {
    enteredQuantity,
    baseQuantity: suggestion(
      enteredQuantity,
      line?.product ?? null,
      line?.enteredUnit ?? null,
    ),
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
    baseQuantity: suggestion(line.enteredQuantity, line.product, enteredUnit),
  })
}

function suggestion(
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
</script>

<template>
  <section class="inventory-count-lines">
    <div class="inventory-count-lines__header">
      <div>
        <h3>盘点明细</h3>
        <span>共 {{ modelValue.length }} 行，最多 200 行</span>
      </div>
      <div v-if="editable" class="inventory-count-lines__actions">
        <v-btn
          :disabled="!canLoadBalance || loading"
          :loading="loading"
          prepend-icon="mdi-database-arrow-down-outline"
          variant="tonal"
          @click="emit('load-balance')"
        >
          加载非零库存
        </v-btn>
        <v-btn
          :disabled="modelValue.length >= 200"
          prepend-icon="mdi-plus"
          variant="tonal"
          @click="addLine"
        >
          添加产品
        </v-btn>
      </div>
    </div>
    <v-alert class="mb-3" density="compact" type="info" variant="tonal">
      草稿账面数量仅供录入参考；批准盘点时，系统会在事务内重新计算并固定差异。
    </v-alert>
    <div class="responsive-table-wrap">
      <v-table
        class="responsive-table responsive-table--form inventory-count-lines__table"
      >
        <thead>
          <tr>
            <th>#</th>
            <th>产品</th>
            <th>录入单位</th>
            <th>账面 Base Quantity</th>
            <th>录入数量</th>
            <th>实际 Base Quantity</th>
            <th>差异</th>
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
                @update:model-value="changeProduct(index, $event)"
              />
              <span v-else>{{
                line.product ? formatReferenceLabel(line.product) : '—'
              }}</span>
            </td>
            <td data-label="录入单位">
              <v-select
                v-if="editable"
                density="compact"
                :disabled="!line.product"
                hide-details
                :items="line.product?.unitConversions ?? []"
                item-value="unit.objectId"
                :model-value="line.enteredUnit?.objectId ?? null"
                variant="outlined"
                @update:model-value="changeEnteredUnit(index, $event)"
              >
                <template #selection="{ item }">{{
                  unitLabel(item.unit)
                }}</template>
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
            <td data-label="账面 Base Quantity">
              {{ line.bookBaseQuantity ?? '—' }}
            </td>
            <td data-label="录入数量">
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.enteredQuantity"
                :rules="[
                  (value: string) =>
                    isQuantity(value, true) ||
                    '请输入非负且最多六位小数的实盘数量。',
                ]"
                @update:model-value="updateEnteredQuantity(index, $event)"
              />
              <span v-else>{{ line.enteredQuantity }}</span>
            </td>
            <td data-label="实际 Base Quantity">
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.baseQuantity"
                :rules="[
                  (value: string) =>
                    isQuantity(value, true) ||
                    '请输入非负且最多六位小数的实际 Base Quantity。',
                ]"
                @update:model-value="
                  updateLine(index, { baseQuantity: $event })
                "
              />
              <span v-else>{{ line.baseQuantity }}</span>
            </td>
            <td data-label="差异">{{ previewDifference(line) }}</td>
            <td data-label="备注">
              <CompactTableField
                v-if="editable"
                :model-value="line.remark"
                @update:model-value="updateLine(index, { remark: $event })"
              />
              <span v-else>{{ line.remark || '—' }}</span>
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
        </tbody>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.inventory-count-lines__header,
.inventory-count-lines__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.inventory-count-lines__header {
  margin-bottom: 14px;
}
.inventory-count-lines__header h3 {
  margin: 0;
}
.inventory-count-lines__header span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.inventory-count-lines__table {
  min-width: 960px;
}
@media (max-width: 700px) {
  .inventory-count-lines__header,
  .inventory-count-lines__actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
