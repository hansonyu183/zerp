<script setup lang="ts" generic="T extends object">
import { emptyUnit } from './product-data.ts'
import EditForm from '../direct-page/EditForm.vue'
import SnapshotReference from './SnapshotReference.vue'
import type { EditField, EditValues } from '../direct-page/definition.ts'
import type { FormFields } from './form-fields.ts'
const props = defineProps<{
  fields: FormFields<T>
  modelValue: T
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
function update(value: EditValues) {
  emit('update:modelValue', { ...props.modelValue, ...value })
}
function reference(key: keyof T, value: object | readonly object[] | null) {
  if (Array.isArray(value)) return
  const field = props.fields.find((field) => field.key === key)
  if (!value && field?.type === 'snapshot-reference' && field.required) {
    value =
      field.source === 'product-units'
        ? emptyUnit()
        : field.source === 'formula-materials'
          ? { objectId: '', approvalEntryId: '', code: '', name: '' }
          : { id: '', code: '', name: '' }
  }
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>
<template>
  <template v-for="field in fields" :key="field.key"
    ><SnapshotReference
      v-if="field.type === 'snapshot-reference'"
      :source="field.source"
      :caption="field.caption"
      :model-value="modelValue[field.key as keyof T] as object | null"
      :disabled="disabled"
      @update:model-value="reference(field.key as keyof T, $event)" /><EditForm
      v-else
      :fields="[field] as readonly EditField[]"
      :model-value="modelValue as EditValues"
      :disabled="disabled"
      @update:model-value="update"
  /></template>
</template>
