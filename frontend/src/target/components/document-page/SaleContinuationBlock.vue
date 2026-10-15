<script setup lang="ts">
import { computed, ref, toRaw } from 'vue'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import VouReference, { type VouCandidate } from './VouReference.vue'
import type { SaleContinuationDraft } from './sale-continuation-data.ts'
const props = defineProps<{
  modelValue: SaleContinuationDraft
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: SaleContinuationDraft]
}>()
function base(field: 'businessDate' | 'remark', value: string) {
  if (props.disabled) return
  const next = structuredClone(toRaw(props.modelValue))
  next.payload[field] = value
  emit('update:modelValue', next)
}
function sourceQuantity(index: number, value: string) {
  const draft = props.modelValue
  if (props.disabled || draft.entity !== 'sale-outbound') return
  emit('update:modelValue', {
    ...draft,
    payload: {
      ...draft.payload,
      sourceLines: draft.payload.sourceLines.map((line, i) =>
        i === index ? { ...line, baseQuantity: value } : line,
      ),
    },
  })
}
function signedQuantity(
  index: number,
  field: 'signedBaseQuantity' | 'rejectedBaseQuantity',
  value: string,
) {
  const draft = props.modelValue
  if (props.disabled || draft.entity !== 'sale-signoff') return
  emit('update:modelValue', {
    ...draft,
    payload: {
      ...draft.payload,
      signoffLines: draft.payload.signoffLines.map((line, i) =>
        i === index ? { ...line, [field]: value } : line,
      ),
    },
  })
}
function containers(
  field:
    | 'expectedSolventContainers'
    | 'expectedResinContainers'
    | 'returnedSolventContainers'
    | 'returnedResinContainers',
  value: unknown,
) {
  const draft = props.modelValue
  if (props.disabled || draft.entity !== 'sale-signoff') return
  const quantity =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN
  emit('update:modelValue', {
    ...draft,
    payload: { ...draft.payload, [field]: quantity },
  })
}
const selectedCarrier = ref<VouCandidate | null>(null)
const selectedVehicle = ref<VouCandidate | null>(null)
const carrier = computed(() => {
  const draft = props.modelValue
  return draft.entity === 'sale-delivery' &&
    draft.payload.carrier?.objectId === selectedCarrier.value?.objectId
    ? selectedCarrier.value
    : null
})
const vehicle = computed(() => {
  const draft = props.modelValue
  return draft.entity === 'sale-delivery' &&
    draft.payload.vehicle?.objectId === selectedVehicle.value?.objectId
    ? selectedVehicle.value
    : null
})
function transport(field: 'carrier' | 'vehicle', value: VouCandidate | null) {
  const draft = props.modelValue
  if (props.disabled || draft.entity !== 'sale-delivery') return
  const payload = { ...draft.payload }
  if (field === 'vehicle') {
    selectedVehicle.value = value
    if (value) payload.vehicle = { objectId: value.objectId }
    else delete payload.vehicle
  } else {
    selectedCarrier.value = value
    if (value?.entity === 'other-unit' && value.approvalEntryId)
      payload.carrier = {
        objectId: value.objectId,
        approvalEntryId: value.approvalEntryId,
        selectionOrigin: 'CURRENT',
      }
    else delete payload.carrier
  }
  emit('update:modelValue', { ...draft, payload })
}
const containerFields = [
  ['expectedSolventContainers', '本次应回溶剂桶'],
  ['expectedResinContainers', '本次应回树脂桶'],
  ['returnedSolventContainers', '本次实回溶剂桶'],
  ['returnedResinContainers', '本次实回树脂桶'],
] as const
</script>
<template>
  <section data-testid="prior-sale-continuation-draft">
    <p>
      来源单号：{{ modelValue.sourceDocumentNo }} · 币种：{{
        modelValue.payload.currency
      }}
    </p>
    <p>客户：{{ modelValue.customerName || '来源客户资料未齐' }}</p>
    <p>
      核对本次实际办理数量后提交，由其他操作人审批。此前履行不会随本次办理重新发生。
    </p>
    <FieldInput
      usage="edit"
      :field="{ key: 'businessDate', type: 'date', caption: '业务日期' }"
      :model-value="modelValue.payload.businessDate"
      :disabled="disabled"
      @update:model-value="base('businessDate', $event)"
    />
    <FieldInput
      usage="edit"
      :field="{
        key: 'remark',
        type: 'textarea',
        caption: '备注',
        maxLength: 1000,
      }"
      :model-value="modelValue.payload.remark ?? ''"
      :disabled="disabled"
      @update:model-value="base('remark', $event)"
    />
    <div v-for="(line, index) in modelValue.lines" :key="line.sourceLineId">
      <h3>
        {{ line.productCode }} {{ line.productName || `来源行${index + 1}` }}
      </h3>
      <p>可办理基准数量：{{ line.availableBaseQuantity }}</p>
      <FieldInput
        usage="edit"
        v-if="modelValue.entity !== 'sale-signoff'"
        :field="{
          key: 'baseQuantity',
          type: 'decimal',
          scale: 6,
          min: '0',
          caption: '本次基准数量',
        }"
        :model-value="modelValue.payload.sourceLines[index]?.baseQuantity ?? ''"
        :disabled="disabled || modelValue.entity === 'sale-delivery'"
        @update:model-value="sourceQuantity(index, $event)"
      />
      <template v-else>
        <FieldInput
          usage="edit"
          :field="{
            key: 'signedBaseQuantity',
            type: 'decimal',
            scale: 6,
            min: '0',
            caption: '本次签收基准数量',
          }"
          :model-value="
            modelValue.payload.signoffLines[index]?.signedBaseQuantity ?? ''
          "
          :disabled="disabled"
          @update:model-value="
            signedQuantity(index, 'signedBaseQuantity', $event)
          "
        />
        <FieldInput
          usage="edit"
          :field="{
            key: 'rejectedBaseQuantity',
            type: 'decimal',
            scale: 6,
            min: '0',
            caption: '本次拒收基准数量',
          }"
          :model-value="
            modelValue.payload.signoffLines[index]?.rejectedBaseQuantity ?? ''
          "
          :disabled="disabled"
          @update:model-value="
            signedQuantity(index, 'rejectedBaseQuantity', $event)
          "
        />
      </template>
    </div>
    <template v-if="modelValue.entity === 'sale-delivery'">
      <VouReference
        entity="other-unit"
        caption="承运归属"
        :model-value="carrier"
        :disabled="disabled"
        @update:model-value="transport('carrier', $event)"
      />
      <VouReference
        entity="vehicle"
        caption="车辆"
        :model-value="vehicle"
        :disabled="disabled"
        @update:model-value="transport('vehicle', $event)"
      />
    </template>
    <template v-if="modelValue.entity === 'sale-signoff'">
      <FieldInput
        usage="edit"
        v-for="[key, label] in containerFields"
        :key="key"
        :field="{
          key,
          type: 'integer',
          min: 0,
          max: 2147483647,
          caption: label,
        }"
        :model-value="modelValue.payload[key]"
        :disabled="disabled"
        @update:model-value="containers(key, $event)"
      />
      <FieldInput
        usage="edit"
        :field="{
          key: 'containerDifferenceReason',
          type: 'textarea',
          caption: '桶差异说明',
          maxLength: 1000,
        }"
        :model-value="modelValue.payload.containerDifferenceReason ?? ''"
        :disabled="disabled"
        @update:model-value="
          !disabled &&
          emit('update:modelValue', {
            ...modelValue,
            payload: {
              ...modelValue.payload,
              containerDifferenceReason: $event,
            },
          })
        "
      />
    </template>
  </section>
</template>
