<script setup lang="ts">
import { ref } from 'vue'
import type * as api from '../../api.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import { openingContainerFields } from './opening-fields-definition.ts'
import type { OpeningDraft } from './opening-data.ts'
type Container = OpeningDraft['containers'][number]
type Candidate = Awaited<
  ReturnType<typeof api.queryTargetVouOptions>
>['items'][number]
const props = defineProps<{ modelValue: Container; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Container] }>()
const references = ref<Candidate[]>([])
function update(value: Container) {
  if (!props.disabled) emit('update:modelValue', value)
}
function adoptOptions(items: readonly EditOption[]) {
  references.value = items.flatMap((item) =>
    item.snapshot ? [item.snapshot as Candidate] : [],
  )
}
function select(objectId: string) {
  if (!objectId) {
    update({
      ...props.modelValue,
      customer: {
        entity: 'customer',
        objectId: '',
        approvalEntryId: '',
        code: '',
        name: '',
      },
    })
    return
  }
  const row = references.value.find((row) => row.objectId === objectId)
  if (row?.entity === 'customer')
    update({
      ...props.modelValue,
      customer: {
        entity: 'customer',
        objectId,
        approvalEntryId: row.approvalEntryId,
        code: row.code,
        name: row.name,
      },
    })
}
</script>
<template>
  <div class="form-stack">
    <FormBlock
      :fields="openingContainerFields"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
    <ReferencePicker
      :source="{ kind: 'vou-reference', entity: 'customer' }"
      caption="客户"
      :model-value="modelValue.customer.objectId"
      :existing="
        modelValue.customer.objectId
          ? [
              {
                id: modelValue.customer.objectId,
                name: modelValue.customer.name,
                snapshot: modelValue.customer,
              },
            ]
          : []
      "
      :multiple="false"
      :disabled="disabled"
      @resolved="adoptOptions($event)"
      @update:model-value="select(($event as string) ?? '')"
    />
  </div>
</template>
