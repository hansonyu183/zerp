<script setup lang="ts" generic="T extends object">
import { toRaw } from 'vue'
import FieldInput from './FieldInput.vue'
import ReferencePicker from './ReferencePicker.vue'
import SnapshotReference from './SnapshotReference.vue'
import type { EditOption } from './edit-fields.ts'
import type { FormFields } from './form-fields.ts'
const props = defineProps<{
  fields: FormFields<T>
  modelValue: T
  disabled: boolean
  existing?: Record<string, readonly EditOption[]>
  readonlyFields?: readonly string[]
}>()
const emit = defineEmits<{
  'update:modelValue': [value: T]
  references: [key: string, options: readonly EditOption[]]
  ready: [key: string, ready: boolean]
}>()
function update(key: string, value: unknown) {
  if (props.disabled || props.readonlyFields?.includes(key)) return
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
function reference(key: string, value: object | readonly object[] | null) {
  if (Array.isArray(value)) return
  const field = props.fields.find((field) => field.key === key)
  update(
    key,
    value ??
      (field?.type === 'snapshot-reference'
        ? structuredClone(toRaw(field.emptyValue ?? null))
        : null),
  )
}
function visible(field: FormFields<T>[number]) {
  if (!('visibleWhen' in field) || !field.visibleWhen) return true
  return (
    (props.modelValue as Record<string, unknown>)[field.visibleWhen.key] ===
    field.visibleWhen.value
  )
}
</script>
<template>
  <template v-for="field in fields" :key="field.key">
    <template v-if="visible(field)">
      <SnapshotReference
        v-if="field.type === 'snapshot-reference'"
        :source="field.source"
        :caption="field.caption"
        :model-value="modelValue[field.key as keyof T] as object | null"
        :disabled="disabled || Boolean(readonlyFields?.includes(field.key))"
        @update:model-value="reference(field.key, $event)"
      />
      <ReferencePicker
        v-else-if="
          field.type === 'reference' || field.type === 'multi-reference'
        "
        :key="`${field.key}:${field.source}`"
        :source="field.source"
        :caption="field.caption"
        :model-value="
          modelValue[field.key as keyof T] as string | string[] | null
        "
        :existing="existing?.[field.key] ?? []"
        :multiple="field.type === 'multi-reference'"
        :disabled="disabled || Boolean(readonlyFields?.includes(field.key))"
        @update:model-value="update(field.key, $event)"
        @resolved="emit('references', field.key, $event)"
        @ready="emit('ready', field.key, $event)"
      />
      <FieldInput
        v-else
        :field="field"
        usage="edit"
        :model-value="modelValue[field.key as keyof T]"
        :disabled="disabled || Boolean(readonlyFields?.includes(field.key))"
        @update:model-value="update(field.key, $event)"
      />
    </template>
  </template>
</template>
