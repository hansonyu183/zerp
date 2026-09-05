<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import type { VouProductLineInput } from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'

export type ProductLineDraft = VouProductLineInput

const props = withDefaults(
  defineProps<{
    modelValue: readonly ProductLineDraft[]
    editable?: boolean
    productOptions?: readonly VouReferenceOption[]
    unitOptions?: readonly VouReferenceOption[]
    lineId: () => string
  }>(),
  {
    editable: true,
    productOptions: () => [],
    unitOptions: () => [],
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: ProductLineDraft[]]
}>()

const rows = shallowRef<ProductLineDraft[]>(
  props.modelValue.map((line) => ({ ...line })),
)
let lastEmitted: ProductLineDraft[] | null = null
watch(
  () => props.modelValue,
  (value) => {
    if (value !== lastEmitted) rows.value = value.map((line) => ({ ...line }))
    lastEmitted = null
  },
)

function commit(value: ProductLineDraft[]): void {
  rows.value = value
  lastEmitted = value
  emit('update:modelValue', value)
}

const total = computed(() =>
  rows.value.reduce(
    (sum, line) =>
      addMoney(sum, multiplyMoney(line.baseQuantity, line.unitPrice)),
    '0.00',
  ),
)

function updateLine(index: number, patch: Partial<ProductLineDraft>): void {
  commit(
    rows.value.map((line, current) =>
      current === index ? { ...line, ...patch } : { ...line },
    ),
  )
}

function addLine(): void {
  if (!props.editable || rows.value.length >= 200) return
  commit([
    ...rows.value.map((line) => ({ ...line })),
    {
      lineId: props.lineId(),
      product: { objectId: '' },
      enteredQuantity: '',
      enteredUnit: { objectId: '' },
      baseQuantity: '',
      unitPrice: '',
      settlementSurcharge: null,
      remark: '',
    },
  ])
}

function selectObject(
  index: number,
  field: 'product' | 'enteredUnit',
  objectId: string,
): void {
  updateLine(index, { [field]: { objectId } })
}

function removeLine(index: number): void {
  commit(
    rows.value
      .filter((_, current) => current !== index)
      .map((line) => ({ ...line })),
  )
}

function optionLabel(
  options: readonly VouReferenceOption[],
  objectId?: string,
): string {
  const option = options.find((candidate) => candidate.objectId === objectId)
  return option ? `${option.code} · ${option.name}` : '—'
}

function scaled(value: string, scale: number): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return (
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt((fraction + '0'.repeat(scale)).slice(0, scale))
  )
}

function multiplyMoney(quantity: string, price: string): string {
  const q = scaled(quantity, 6)
  const p = scaled(price, 2)
  if (q === null || p === null) return '0.00'
  const cents = (q * p + 500_000n) / 1_000_000n
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

function addMoney(left: string, right: string): string {
  const cents = (scaled(left, 2) ?? 0n) + (scaled(right, 2) ?? 0n)
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}
</script>

<template>
  <section class="product-lines" data-testid="vou-product-lines-editor">
    <div class="product-lines__heading">
      <div>
        <h3>产品明细</h3>
        <span>共 {{ rows.length }} 行，最多 200 行</span>
      </div>
      <button
        v-if="editable"
        type="button"
        class="product-lines__add"
        :disabled="rows.length >= 200"
        aria-label="添加产品行"
        @click="addLine"
      >
        添加产品行
      </button>
    </div>

    <div class="product-lines__table-wrap">
      <v-table class="product-lines__table">
        <thead>
          <tr>
            <th>#</th>
            <th>产品</th>
            <th>录入数量</th>
            <th>录入单位</th>
            <th>基础数量</th>
            <th>单价</th>
            <th>金额</th>
            <th>备注</th>
            <th v-if="editable">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in rows" :key="line.lineId">
            <td>{{ index + 1 }}</td>
            <td>
              <select
                v-if="editable"
                :value="line.product?.objectId ?? ''"
                aria-label="产品"
                @change="
                  selectObject(
                    index,
                    'product',
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="">请选择产品</option>
                <option
                  v-for="option in productOptions"
                  :key="option.objectId"
                  :value="option.objectId"
                >
                  {{ option.code }} · {{ option.name }}
                </option>
              </select>
              <span v-else>{{
                optionLabel(productOptions, line.product?.objectId)
              }}</span>
            </td>
            <td>
              <input
                v-if="editable"
                :value="line.enteredQuantity"
                inputmode="decimal"
                aria-label="录入数量"
                @input="
                  updateLine(index, {
                    enteredQuantity: ($event.target as HTMLInputElement).value,
                  })
                "
              />
              <span v-else>{{ line.enteredQuantity }}</span>
            </td>
            <td>
              <select
                v-if="editable"
                :value="line.enteredUnit?.objectId ?? ''"
                aria-label="录入单位"
                @change="
                  selectObject(
                    index,
                    'enteredUnit',
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="">请选择单位</option>
                <option
                  v-for="option in unitOptions"
                  :key="option.objectId"
                  :value="option.objectId"
                >
                  {{ option.code }} · {{ option.name }}
                </option>
              </select>
              <span v-else>{{
                optionLabel(unitOptions, line.enteredUnit?.objectId)
              }}</span>
            </td>
            <td>
              <input
                v-if="editable"
                :value="line.baseQuantity"
                inputmode="decimal"
                aria-label="基础数量"
                @input="
                  updateLine(index, {
                    baseQuantity: ($event.target as HTMLInputElement).value,
                  })
                "
              />
              <span v-else>{{ line.baseQuantity }}</span>
            </td>
            <td>
              <input
                v-if="editable"
                :value="line.unitPrice"
                inputmode="decimal"
                aria-label="单价"
                @input="
                  updateLine(index, {
                    unitPrice: ($event.target as HTMLInputElement).value,
                  })
                "
              />
              <span v-else>{{ line.unitPrice }}</span>
            </td>
            <td>{{ multiplyMoney(line.baseQuantity, line.unitPrice) }}</td>
            <td>
              <input
                v-if="editable"
                :value="line.remark ?? ''"
                maxlength="1000"
                aria-label="备注"
                @input="
                  updateLine(index, {
                    remark: ($event.target as HTMLInputElement).value,
                  })
                "
              />
              <span v-else>{{ line.remark || '—' }}</span>
            </td>
            <td v-if="editable">
              <button
                type="button"
                :aria-label="`删除第 ${index + 1} 行`"
                @click="removeLine(index)"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td :colspan="editable ? 9 : 8" class="text-center py-6">
              暂无产品明细
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" class="text-end font-weight-bold">合计</td>
            <td class="font-weight-bold">{{ total }}</td>
            <td :colspan="editable ? 2 : 1" />
          </tr>
        </tfoot>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.product-lines__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.product-lines__heading h3 {
  margin: 0;
}
.product-lines__heading span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.product-lines__add {
  border: 1px solid rgb(var(--v-theme-primary));
  border-radius: 6px;
  color: rgb(var(--v-theme-primary));
  padding: 7px 12px;
}
.product-lines__table-wrap {
  overflow-x: auto;
}
.product-lines__table {
  min-width: 1100px;
}
.product-lines input,
.product-lines select {
  width: 100%;
  min-width: 120px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 4px;
  padding: 8px;
}
</style>
