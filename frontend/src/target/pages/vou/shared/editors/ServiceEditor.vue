<script setup lang="ts">
import type { VouPayload, VouVersionedReferenceInput } from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'
import BaseFields from './BaseFields.vue'
import ReferenceIdSelect from './ReferenceIdSelect.vue'
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
const empty = (): VouVersionedReferenceInput => ({
  objectId: '',
  approvalEntryId: '',
  selectionOrigin: 'CURRENT',
})
function setReference(
  field: 'counterparty' | 'employee',
  value?: VouVersionedReferenceInput,
) {
  if (field === 'counterparty' && 'counterparty' in props.payload)
    props.payload.counterparty = value ?? empty()
  if (field === 'employee' && 'employee' in props.payload)
    props.payload.employee = value ?? empty()
  emit('change')
}
function setCounterpartyType(value: string) {
  if (!('counterpartyType' in props.payload)) return
  if (value !== 'other-unit' && value !== 'sales-partner') return
  if (
    props.payload.counterpartyType !== value &&
    'counterparty' in props.payload
  )
    props.payload.counterparty = empty()
  props.payload.counterpartyType = value
  emit('change')
}
function counterpartyOptions(): readonly VouReferenceOption[] {
  if (!('counterpartyType' in props.payload)) return []
  const type = props.payload.counterpartyType
  return type ? (props.referenceOptions[type] ?? []) : []
}
</script>

<template>
  <div data-testid="vou-service-editor">
    <BaseFields
      :payload="payload"
      :editable="editable"
      @change="emit('change')"
    />
    <v-row>
      <v-col v-if="'counterpartyType' in payload" cols="12" md="4"
        ><v-select
          :model-value="payload.counterpartyType"
          label="合作方类型"
          :readonly="!editable"
          :items="[
            { title: '其他单位', value: 'other-unit' },
            { title: '销售合作方', value: 'sales-partner' },
          ]"
          variant="outlined"
          @update:model-value="setCounterpartyType($event)"
      /></v-col>
      <v-col v-if="'counterparty' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="合作方"
          required
          :disabled="!editable"
          :model-value="payload.counterparty"
          :options="counterpartyOptions()"
          @update:model-value="setReference('counterparty', $event)"
      /></v-col>
      <v-col v-if="'employee' in payload" cols="12" md="4"
        ><ReferenceSelect
          label="责任员工"
          required
          :disabled="!editable"
          :model-value="payload.employee"
          :options="referenceOptions.employee ?? []"
          @update:model-value="setReference('employee', $event)"
      /></v-col>
    </v-row>
    <v-card v-if="'serviceContract' in payload" variant="outlined">
      <v-card-title>服务合同条款</v-card-title>
      <v-card-text
        ><v-row
          ><v-col cols="12" md="4"
            ><v-text-field
              v-model="payload.serviceContract.applicableFrom"
              label="适用开始日"
              type="date"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="4"
            ><v-text-field
              v-model="payload.serviceContract.applicableTo"
              label="适用结束日"
              type="date"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="4"
            ><v-select
              v-model="payload.serviceContract.capabilities"
              label="服务能力"
              multiple
              :readonly="!editable"
              :items="[
                { title: '外部兼职销售', value: 'EXTERNAL_PART_TIME' },
                { title: '渠道合作方', value: 'CHANNEL_PARTNER' },
              ]"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12"
            ><v-textarea
              v-model="payload.serviceContract.terms"
              label="合同条款"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col></v-row
      ></v-card-text>
    </v-card>
    <v-card v-if="'serviceAcceptance' in payload" variant="outlined">
      <v-card-title>履约验收事实</v-card-title>
      <v-card-text
        ><v-row
          ><v-col cols="12" md="4"
            ><ReferenceIdSelect
              v-model="payload.serviceAcceptance.contractDocumentId"
              label="服务合同"
              required
              :disabled="!editable"
              :options="referenceOptions['service-contract'] ?? []"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="4"
            ><v-text-field
              v-model="payload.serviceAcceptance.serviceDate"
              label="服务日期"
              type="date"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="4"
            ><v-text-field
              v-model="payload.serviceAcceptance.acceptanceDate"
              label="验收日期"
              type="date"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="4"
            ><v-select
              v-model="payload.serviceAcceptance.settlementDirection"
              label="结算方向"
              :readonly="!editable"
              :items="[
                { title: '应付', value: 'PAYABLE' },
                { title: '应收', value: 'RECEIVABLE' },
              ]"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="4"
            ><v-textarea
              v-model="payload.serviceAcceptance.fulfillmentFact"
              label="履约事实"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col
          ><v-col cols="12" md="4"
            ><v-textarea
              v-model="payload.serviceAcceptance.acceptanceFact"
              label="验收事实"
              :readonly="!editable"
              variant="outlined"
              @update:model-value="emit('change')" /></v-col></v-row
      ></v-card-text>
    </v-card>
  </div>
</template>
