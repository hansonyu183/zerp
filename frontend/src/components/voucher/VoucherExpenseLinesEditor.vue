<script setup lang="ts">
import { computed } from 'vue'
import type { VoucherExpenseLineDraft } from './types'
import { isMoney, sumMoney } from './decimal'
import CompactTableField from '@/components/common/CompactTableField.vue'

defineOptions({ name: 'VoucherExpenseLinesEditor' })

const props = withDefaults(defineProps<{
  modelValue: readonly VoucherExpenseLineDraft[]
  editable?: boolean
}>(), { editable: true })

const emit = defineEmits<{
  'update:modelValue': [value: VoucherExpenseLineDraft[]]
}>()

const total = computed(() => sumMoney(props.modelValue.map((line) => line.amount)))

function updateLine(
  index: number,
  changes: Partial<VoucherExpenseLineDraft>,
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
      category: '',
      description: '',
      amount: '',
      remark: '',
    },
  ])
}

function removeLine(index: number): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, lineIndex) => lineIndex !== index)
      .map((line) => ({ ...line })),
  )
}
</script>

<template>
  <section class="voucher-expense-lines">
    <div class="voucher-expense-lines__header">
      <div>
        <h3>费用明细</h3>
        <span>共 {{ modelValue.length }} 行，最多 200 行</span>
      </div>
      <v-btn
        v-if="editable"
        :disabled="modelValue.length >= 200"
        prepend-icon="mdi-plus"
        variant="tonal"
        @click="addLine"
      >
        添加费用
      </v-btn>
    </div>
    <div class="voucher-expense-lines__wrap">
      <v-table class="voucher-expense-lines__table">
        <thead>
          <tr>
            <th>#</th><th>类别</th><th>说明</th><th>金额</th><th>备注</th>
            <th v-if="editable" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in modelValue" :key="line.key">
            <td>{{ index + 1 }}</td>
            <td>
              <CompactTableField
                v-if="editable"
                :model-value="line.category"
                :rules="[
                  (v: string) => Boolean(v?.trim()) || '请输入费用类别。',
                  (v: string) => Array.from(v ?? '').length <= 100 || '不能超过 100 字。',
                ]"
                @update:model-value="updateLine(index, { category: $event })"
              />
              <span v-else>{{ line.category }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="editable"
                :model-value="line.description"
                :rules="[
                  (v: string) => Boolean(v?.trim()) || '请输入说明。',
                  (v: string) => Array.from(v ?? '').length <= 500 || '不能超过 500 字。',
                ]"
                @update:model-value="updateLine(index, { description: $event })"
              />
              <span v-else>{{ line.description }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="editable"
                inputmode="decimal"
                :model-value="line.amount"
                :rules="[
                  (v: string) => isMoney(v) ||
                    '请输入大于零且最多两位小数的金额。',
                ]"
                @update:model-value="updateLine(index, { amount: $event })"
              />
              <span v-else>{{ line.amount }}</span>
            </td>
            <td>
              <CompactTableField
                v-if="editable"
                :maxlength="1000"
                :model-value="line.remark"
                :rules="[(v: string) => Array.from(v ?? '').length <= 1000 || '备注不能超过 1000 字。']"
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
            <td :colspan="editable ? 6 : 5" class="text-center py-8">暂无费用明细</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" class="text-end font-weight-bold">合计</td>
            <td class="font-weight-bold">{{ total ?? '—' }}</td>
            <td :colspan="editable ? 2 : 1" />
          </tr>
        </tfoot>
      </v-table>
    </div>
  </section>
</template>

<style scoped>
.voucher-expense-lines__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.voucher-expense-lines__header h3 { margin: 0; }
.voucher-expense-lines__header span { color: rgb(var(--v-theme-on-surface-variant)); font-size: 12px; }
.voucher-expense-lines__wrap { overflow-x: auto; }
.voucher-expense-lines__table { min-width: 960px; }
.voucher-expense-lines__table :deep(.v-input) { min-width: 150px; }
</style>
