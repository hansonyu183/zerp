<script setup lang="ts">
import { shallowRef, watch } from 'vue'

import type { VouPriceLineInput } from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'

export type PriceLineDraft = VouPriceLineInput

const props = withDefaults(
  defineProps<{
    modelValue: readonly PriceLineDraft[]
    editable?: boolean
    productOptions?: readonly VouReferenceOption[]
  }>(),
  { editable: true, productOptions: () => [] },
)

const emit = defineEmits<{
  'update:modelValue': [value: PriceLineDraft[]]
}>()

const rows = shallowRef<PriceLineDraft[]>(
  props.modelValue.map((line) => ({ ...line })),
)
let lastEmitted: PriceLineDraft[] | null = null
watch(
  () => props.modelValue,
  (value) => {
    if (value !== lastEmitted) rows.value = value.map((line) => ({ ...line }))
    lastEmitted = null
  },
)

function commit(value: PriceLineDraft[]): void {
  rows.value = value
  lastEmitted = value
  emit('update:modelValue', value)
}

function updateLine(index: number, patch: Partial<PriceLineDraft>): void {
  commit(
    rows.value.map((line, current) =>
      current === index ? { ...line, ...patch } : { ...line },
    ),
  )
}

function selectProduct(index: number, approvalEntryId: string): void {
  const option = props.productOptions.find(
    (candidate) => candidate.approvalEntryId === approvalEntryId,
  )
  updateLine(index, {
    product: option?.approvalEntryId
      ? {
          objectId: option.objectId,
          approvalEntryId: option.approvalEntryId,
          selectionOrigin: 'CURRENT',
        }
      : { objectId: '', approvalEntryId: '', selectionOrigin: 'CURRENT' },
  })
}

function addLine(): void {
  if (!props.editable || rows.value.length >= 200) return
  commit([
    ...rows.value.map((line) => ({ ...line })),
    {
      product: {
        objectId: '',
        approvalEntryId: '',
        selectionOrigin: 'CURRENT',
      },
      unitPrice: '',
      remark: '',
    },
  ])
}

function removeLine(index: number): void {
  commit(
    rows.value
      .filter((_, current) => current !== index)
      .map((line) => ({ ...line })),
  )
}

function productLabel(line: PriceLineDraft): string {
  const option = props.productOptions.find(
    (candidate) => candidate.approvalEntryId === line.product?.approvalEntryId,
  )
  return option ? `${option.code} · ${option.name}` : '—'
}
</script>

<template>
  <section class="line-editor" data-testid="vou-price-lines-editor">
    <div class="line-editor__heading">
      <div>
        <h3>定价明细</h3>
        <span>逐项维护产品价格，共 {{ rows.length }} 行</span>
      </div>
      <button
        v-if="editable"
        type="button"
        class="line-editor__add"
        :disabled="rows.length >= 200"
        aria-label="添加定价行"
        @click="addLine"
      >
        添加定价行
      </button>
    </div>

    <div class="line-editor__table-wrap">
      <v-table class="line-editor__table">
        <thead>
          <tr>
            <th>#</th>
            <th>产品</th>
            <th>单价</th>
            <th>备注</th>
            <th v-if="editable">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in rows" :key="index">
            <td>{{ index + 1 }}</td>
            <td>
              <select
                v-if="editable"
                :value="line.product?.approvalEntryId ?? ''"
                aria-label="产品"
                @change="
                  selectProduct(
                    index,
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="">请选择产品</option>
                <option
                  v-for="option in productOptions"
                  :key="option.approvalEntryId ?? option.objectId"
                  :value="option.approvalEntryId"
                  :disabled="!option.approvalEntryId"
                >
                  {{ option.code }} · {{ option.name }}
                </option>
              </select>
              <span v-else>{{ productLabel(line) }}</span>
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
            <td :colspan="editable ? 5 : 4" class="text-center py-6">
              暂无定价明细
            </td>
          </tr>
        </tbody>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.line-editor__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.line-editor__heading h3 {
  margin: 0;
}
.line-editor__heading span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.line-editor__add {
  border: 1px solid rgb(var(--v-theme-primary));
  border-radius: 6px;
  color: rgb(var(--v-theme-primary));
  padding: 7px 12px;
}
.line-editor__table-wrap {
  overflow-x: auto;
}
.line-editor__table {
  min-width: 720px;
}
.line-editor input,
.line-editor select {
  width: 100%;
  min-width: 140px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 4px;
  padding: 8px;
}
</style>
