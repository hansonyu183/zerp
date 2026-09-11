<script setup lang="ts">
import FormBlock from '../dynamic-fields/FormBlock.vue'
import VouReference from './VouReference.vue'
import {
  servicePartyOptions,
  serviceDirectionOptions,
  serviceCapabilityOptions,
  type ServiceDraft,
} from './service-data.ts'
const props = defineProps<{ modelValue: ServiceDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: ServiceDraft] }>()
function update(patch: Partial<ServiceDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...patch })
}
</script>
<template>
  <FormBlock
    :fields="[
      {
        key: 'businessDate',
        type: 'date',
        caption: '业务日期',
        required: true,
      },
      { key: 'currency', type: 'text', caption: '币种', required: true },
      { key: 'remark', type: 'textarea', caption: '备注' },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <VouReference
    entity="employee"
    caption="经办员工"
    :model-value="modelValue.employee"
    :disabled="disabled"
    @update:model-value="update({ employee: $event })"
  />
  <template v-if="modelValue.entity === 'service-contract'">
    <FormBlock
      :fields="[
        {
          key: 'counterpartyType',
          type: 'enum',
          caption: '相对方类型',
          required: true,
          options: servicePartyOptions,
        },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
    <VouReference
      :key="modelValue.counterpartyType"
      :entity="modelValue.counterpartyType"
      caption="相对方"
      :model-value="modelValue.counterparty"
      :disabled="disabled"
      @update:model-value="update({ counterparty: $event, origin: 'CURRENT' })"
    />
    <fieldset
      v-if="modelValue.counterpartyType === 'sales-partner'"
      :disabled="disabled"
    >
      <legend>合作能力</legend>
      <label v-for="option in serviceCapabilityOptions" :key="option.value"
        ><input
          type="checkbox"
          :checked="modelValue.capabilities.includes(option.value)"
          @change="
            update({
              capabilities: modelValue.capabilities.includes(option.value)
                ? modelValue.capabilities.filter(
                    (value) => value !== option.value,
                  )
                : [...modelValue.capabilities, option.value],
            })
          "
        />{{ option.caption }}</label
      >
    </fieldset>
    <FormBlock
      :fields="[
        { key: 'applicableFrom', type: 'date', caption: '适用开始日期' },
        { key: 'applicableTo', type: 'date', caption: '适用结束日期' },
        { key: 'terms', type: 'textarea', caption: '合同条款' },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
  </template>
  <template v-else>
    <VouReference
      entity="service-contract"
      caption="服务合同"
      :model-value="modelValue.contract"
      :disabled="disabled"
      @update:model-value="update({ contract: $event })"
    />
    <FormBlock
      :fields="[
        {
          key: 'serviceDate',
          type: 'date',
          caption: '履约日期',
          required: true,
        },
        {
          key: 'acceptanceDate',
          type: 'date',
          caption: '验收日期',
          required: true,
        },
        {
          key: 'settlementDirection',
          type: 'enum',
          caption: '结算方向',
          required: true,
          options: serviceDirectionOptions,
        },
        {
          key: 'amount',
          type: 'decimal',
          scale: 2,
          caption: '结算金额',
          required: true,
        },
        { key: 'fulfillmentFact', type: 'textarea', caption: '履约事实' },
        { key: 'acceptanceFact', type: 'textarea', caption: '验收事实' },
      ]"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update"
    />
  </template>
</template>
