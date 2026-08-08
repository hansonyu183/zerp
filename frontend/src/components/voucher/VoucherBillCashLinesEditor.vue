<script setup lang="ts">
import type {
  BillCashLineDraft,
  BillReference,
} from '@/pages/vou/shared/bill/vm'
import ReferenceAutocomplete from '@/components/common/ReferenceAutocomplete.vue'
import CompactTableField from '@/components/common/CompactTableField.vue'
const props = defineProps<{
  modelValue: BillCashLineDraft[]
  editable: boolean
  maxLines?: number
  fundOptions?: BillReference[]
}>()
const emit = defineEmits<{
  'update:modelValue': [BillCashLineDraft[]]
  'fund-search': [string]
}>()
function update(index: number, value: Partial<BillCashLineDraft>) {
  emit(
    'update:modelValue',
    props.modelValue.map((line, i) =>
      i === index ? { ...line, ...value } : line,
    ),
  )
}
function add() {
  if (props.modelValue.length < (props.maxLines ?? 20))
    emit('update:modelValue', [
      ...props.modelValue,
      {
        key: crypto.randomUUID(),
        fundAccount: null,
        direction: 'IN',
        amountType: 'PRINCIPAL',
        amount: '',
        remark: '',
      },
    ])
}
function remove(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}
</script>
<template>
  <section class="voucher-bill-cash-lines">
    <div class="d-flex align-center justify-space-between mb-2">
      <h3>现金补款/找零</h3>
      <v-btn
        v-if="editable"
        :disabled="modelValue.length >= (maxLines ?? 20)"
        variant="tonal"
        @click="add"
        >添加现金行</v-btn
      >
    </div>
    <div class="responsive-table-wrap">
      <v-table class="responsive-table"
        ><thead>
          <tr>
            <th>资金账户</th>
            <th>方向</th>
            <th>金额类型</th>
            <th>金额</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in modelValue" :key="line.key">
            <td data-label="资金账户">
              <ReferenceAutocomplete
                :disabled="!editable"
                label="资金账户"
                table
                :model-value="line.fundAccount"
                :options="fundOptions ?? []"
                @search="emit('fund-search', $event)"
                @update:model-value="update(index, { fundAccount: $event })"
              />
            </td>
            <td data-label="方向">
              <v-select
                :disabled="!editable"
                hide-details
                :items="[
                  { title: '补款', value: 'IN' },
                  { title: '找零', value: 'OUT' },
                ]"
                :model-value="line.direction"
                variant="underlined"
                @update:model-value="update(index, { direction: $event })"
              />
            </td>
            <td data-label="金额类型">
              <v-select
                :disabled="!editable"
                hide-details
                :items="['PRINCIPAL', 'INTEREST', 'FEE', 'MARGIN', 'OTHER']"
                :model-value="line.amountType"
                variant="underlined"
                @update:model-value="update(index, { amountType: $event })"
              />
            </td>
            <td data-label="金额">
              <CompactTableField
                :disabled="!editable"
                inputmode="decimal"
                :model-value="line.amount"
                @update:model-value="update(index, { amount: $event })"
              />
            </td>
            <td data-label="备注">
              <CompactTableField
                :disabled="!editable"
                :model-value="line.remark"
                @update:model-value="update(index, { remark: $event })"
              />
            </td>
            <td class="responsive-table__actions" data-label="操作">
              <v-btn
                v-if="editable"
                aria-label="删除现金行"
                color="error"
                icon="mdi-delete-outline"
                variant="text"
                @click="remove(index)"
              />
            </td>
          </tr></tbody
      ></v-table>
    </div>
  </section>
</template>
