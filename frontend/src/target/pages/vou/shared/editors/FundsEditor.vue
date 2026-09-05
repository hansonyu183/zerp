<script setup lang="ts">
import type {
  VouEntity,
  VouPayload,
  VouVersionedReferenceInput,
} from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'
import BaseFields from './BaseFields.vue'
import ReferenceSelect from './ReferenceSelect.vue'

const props = withDefaults(
  defineProps<{
    entity: VouEntity
    payload: VouPayload
    referenceOptions: Partial<Record<string, VouReferenceOption[]>>
    editable?: boolean
  }>(),
  { editable: true },
)
const emit = defineEmits<{ change: [] }>()

const empty = (): VouVersionedReferenceInput => ({
  objectId: '',
  approvalEntryId: '',
  selectionOrigin: 'CURRENT',
})
function versionedReference(
  value: unknown,
): VouVersionedReferenceInput | undefined {
  if (!value || typeof value !== 'object') return undefined
  const reference = value as Record<string, unknown>
  return typeof reference.objectId === 'string' &&
    typeof reference.approvalEntryId === 'string' &&
    (reference.selectionOrigin === 'CURRENT' ||
      reference.selectionOrigin === 'HISTORICAL')
    ? {
        objectId: reference.objectId,
        approvalEntryId: reference.approvalEntryId,
        selectionOrigin: reference.selectionOrigin,
      }
    : undefined
}
function setReference(field: string, value?: VouVersionedReferenceInput) {
  const next = value ?? empty()
  if (field === 'customer' && 'customer' in props.payload)
    props.payload.customer = next
  else if (field === 'supplier' && 'supplier' in props.payload)
    props.payload.supplier = next
  else if (field === 'operatingEntity' && 'operatingEntity' in props.payload)
    props.payload.operatingEntity = next
  else if (field === 'fundAccount' && 'fundAccount' in props.payload)
    props.payload.fundAccount = next
  else if (field === 'handler' && 'handler' in props.payload)
    props.payload.handler = next
  else if (field === 'employee' && 'employee' in props.payload)
    props.payload.employee = next
  else if (field === 'counterparty' && 'counterparty' in props.payload)
    props.payload.counterparty = value
  else if (field === 'counterparty' && 'sourceName' in props.payload)
    props.payload.counterparty = value
  emit('change')
}
function counterpartyOptions(): readonly VouReferenceOption[] {
  if (!('counterpartyType' in props.payload) || !props.payload.counterpartyType)
    return []
  return props.referenceOptions[props.payload.counterpartyType] ?? []
}
function addAllocation() {
  if (!('subunitAllocations' in props.payload)) return
  props.payload.subunitAllocations = [
    ...props.payload.subunitAllocations,
    { subunit: empty(), amount: '0.00' },
  ]
  emit('change')
}
function setAllocationSubunit(
  line: { subunit: VouVersionedReferenceInput },
  value?: VouVersionedReferenceInput,
) {
  line.subunit = value ?? empty()
  emit('change')
}
</script>

<template>
  <div data-testid="vou-funds-editor">
    <BaseFields
      :payload="payload"
      :editable="editable"
      @change="emit('change')"
    />
    <v-row>
      <v-col v-if="'customer' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="客户"
          required
          :disabled="!editable"
          :model-value="payload.customer"
          :options="referenceOptions.customer ?? []"
          @update:model-value="setReference('customer', $event)"
      /></v-col>
      <v-col v-if="'supplier' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="供应商"
          required
          :disabled="!editable"
          :model-value="versionedReference(payload.supplier)"
          :options="referenceOptions.supplier ?? []"
          @update:model-value="setReference('supplier', $event)"
      /></v-col>
      <v-col v-if="'employee' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="员工"
          required
          :disabled="!editable"
          :model-value="payload.employee"
          :options="referenceOptions.employee ?? []"
          @update:model-value="setReference('employee', $event)"
      /></v-col>
      <v-col v-if="'counterpartyType' in payload" cols="12" md="4"
        ><v-select
          v-model="payload.counterpartyType"
          label="往来单位类型"
          :readonly="!editable"
          :items="[
            { title: '客户子户', value: 'customer-subunit' },
            { title: '供应商', value: 'supplier' },
            { title: '其他单位', value: 'other-unit' },
            { title: '员工', value: 'employee' },
            { title: '销售合作方', value: 'sales-partner' },
          ]"
          variant="outlined"
          @update:model-value="emit('change')"
      /></v-col>
      <v-col
        v-if="'counterparty' in payload || entity === 'other-income'"
        cols="12"
        md="4"
        ><ReferenceSelect
          label="往来单位"
          :required="!('sourceName' in payload)"
          :disabled="!editable"
          :model-value="
            'counterparty' in payload ? payload.counterparty : undefined
          "
          :options="counterpartyOptions()"
          @update:model-value="setReference('counterparty', $event)"
      /></v-col>
      <v-col v-if="'operatingEntity' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="经营主体"
          required
          :disabled="!editable"
          :model-value="payload.operatingEntity"
          :options="referenceOptions['operating-entity'] ?? []"
          @update:model-value="setReference('operatingEntity', $event)"
      /></v-col>
      <v-col v-if="'fundAccount' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="资金账户"
          required
          :disabled="!editable"
          :model-value="payload.fundAccount"
          :options="referenceOptions['fund-account'] ?? []"
          @update:model-value="setReference('fundAccount', $event)"
      /></v-col>
      <v-col v-if="'handler' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="经办人"
          required
          :disabled="!editable"
          :model-value="payload.handler"
          :options="referenceOptions.employee ?? []"
          @update:model-value="setReference('handler', $event)"
      /></v-col>
      <v-col v-if="'sourceName' in payload" cols="12" md="4"
        ><v-text-field
          v-model="payload.sourceName"
          label="收入来源"
          :readonly="!editable"
          variant="outlined"
          @update:model-value="emit('change')"
      /></v-col>
      <v-col v-if="'amount' in payload" cols="12" md="4"
        ><v-text-field
          v-model="payload.amount"
          label="金额"
          prefix="¥"
          inputmode="decimal"
          :readonly="!editable"
          variant="outlined"
          @update:model-value="emit('change')"
      /></v-col>
    </v-row>
    <section v-if="'subunitAllocations' in payload">
      <div class="editor-heading">
        <h3>客户子户分配</h3>
        <v-btn v-if="editable" variant="tonal" @click="addAllocation"
          >添加分配</v-btn
        >
      </div>
      <v-table
        ><thead>
          <tr>
            <th>客户子户</th>
            <th>分配金额</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in payload.subunitAllocations" :key="index">
            <td>
              <ReferenceSelect
                label="客户子户"
                required
                :disabled="!editable"
                :model-value="line.subunit"
                :options="referenceOptions['customer-subunit'] ?? []"
                @update:model-value="setAllocationSubunit(line, $event)"
              />
            </td>
            <td>
              <v-text-field
                v-model="line.amount"
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
</style>
