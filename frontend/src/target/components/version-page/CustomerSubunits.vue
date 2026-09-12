<script setup lang="ts">
import { computed } from 'vue'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import CustomerSubunitEditor from './CustomerSubunitEditor.vue'
import { newCustomerSubunit, type CustomerSnapshot } from './customer-data.ts'
import { customerDetails } from './snapshot-details.ts'
import { useTargetSession } from '../../session/vm.ts'
type Subunit = CustomerSnapshot['subunits'][number]
const props = defineProps<{
  modelValue: readonly Subunit[]
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Subunit[]]
  pending: [value: boolean]
}>()
const session = useTargetSession()
const readonly = computed(
  () => props.disabled || !session.can('/bob/customer/save-subunits'),
)
const fields = customerDetails.find((field) => field.key === 'subunits')!.fields
</script>
<template>
  <v-alert v-if="!session.can('/bob/customer/save-subunits')" type="info"
    >当前账号没有子单位维护权限，子单位资料只读。</v-alert
  >
  <CollectionBlock
    caption="客户子单位"
    :fields="fields"
    :summary-keys="['code', 'name', 'contactName', 'enabled']"
    :model-value="modelValue"
    mode="edit"
    :disabled="readonly"
    :minimum="1"
    :create="newCustomerSubunit"
    @update:model-value="emit('update:modelValue', $event)"
    @pending="emit('pending', $event)"
  >
    <template #editor="{ value, disabled: locked, update, pending }"
      ><CustomerSubunitEditor
        :model-value="value"
        :disabled="locked"
        @update:model-value="update"
        @pending="pending"
    /></template>
  </CollectionBlock>
</template>
