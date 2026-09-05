<script setup lang="ts">
import type { VouPayload, VouVersionedReferenceInput } from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'
import BaseFields from './BaseFields.vue'
import ReferenceSelect from './ReferenceSelect.vue'

const props = withDefaults(
  defineProps<{
    payload: VouPayload
    referenceOptions: Partial<Record<string, VouReferenceOption[]>>
    editable?: boolean
  }>(),
  { editable: true },
)
const emit = defineEmits<{ change: [] }>()
function employee(value?: VouVersionedReferenceInput) {
  if (!('employee' in props.payload)) return
  props.payload.employee = value ?? {
    objectId: '',
    approvalEntryId: '',
    selectionOrigin: 'CURRENT',
  }
  emit('change')
}
function addLine() {
  if (!('expenseLines' in props.payload)) return
  props.payload.expenseLines = [
    ...props.payload.expenseLines,
    { category: '', description: '', amount: '0.00', remark: '' },
  ]
  emit('change')
}
</script>

<template>
  <div data-testid="vou-expense-editor">
    <BaseFields
      :payload="payload"
      :editable="editable"
      @change="emit('change')"
    />
    <v-row
      ><v-col cols="12" md="4"
        ><ReferenceSelect
          v-if="'employee' in payload"
          label="员工"
          required
          :disabled="!editable"
          :model-value="payload.employee"
          :options="referenceOptions.employee ?? []"
          @update:model-value="employee" /></v-col
    ></v-row>
    <section v-if="'expenseLines' in payload">
      <div class="editor-heading">
        <div>
          <h3>费用明细</h3>
          <span>按费用类别逐项登记用途与金额</span>
        </div>
        <v-btn v-if="editable" variant="tonal" @click="addLine"
          >添加费用行</v-btn
        >
      </div>
      <v-table
        ><thead>
          <tr>
            <th>费用类别</th>
            <th>说明</th>
            <th>金额</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.expenseLines" :key="index">
            <td>
              <v-text-field
                v-model="line.category"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.description"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.amount"
                prefix="¥"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.remark"
                :readonly="!editable"
                hide-details
                @update:model-value="emit('change')"
              />
            </td>
          </tr></tbody
      ></v-table>
    </section>
  </div>
</template>

<style scoped>
.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0;
}
.editor-heading h3 {
  margin: 0;
}
.editor-heading span {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
