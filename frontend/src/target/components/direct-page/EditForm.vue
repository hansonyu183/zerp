<script setup lang="ts">
import type { EditField, EditValues, EditOption } from './definition.ts'
import ReferencePicker from './ReferencePicker.vue'
const props = defineProps<{
  fields: readonly EditField[]
  modelValue: EditValues
  disabled: boolean
  existing?: Record<string, readonly EditOption[]>
  readonlyFields?: readonly string[]
}>()
const emit = defineEmits<{
  'update:modelValue': [value: EditValues]
  submit: []
  references: [key: string, options: readonly EditOption[]]
  ready: [key: string, ready: boolean]
}>()
function update(field: EditField, value: unknown) {
  const next =
    field.type === 'integer'
      ? value === '' || value === null
        ? null
        : Number(value)
      : field.type === 'boolean'
        ? Boolean(value)
        : String(value ?? '')
  emit('update:modelValue', { ...props.modelValue, [field.key]: next })
}
</script>
<template>
  <v-form
    data-testid="direct-edit-form"
    @submit.prevent="emit('submit')"
    @keydown.enter="$event.isComposing && $event.preventDefault()"
  >
    <template v-for="field in fields" :key="field.key">
      <ReferencePicker
        v-if="field.type === 'reference' || field.type === 'multi-reference'"
        :source="field.source"
        :caption="field.caption"
        :model-value="modelValue[field.key] as string | string[] | null"
        :existing="existing?.[field.key] ?? []"
        :multiple="field.type === 'multi-reference'"
        :disabled="disabled || Boolean(readonlyFields?.includes(field.key))"
        @update:model-value="
          emit('update:modelValue', { ...modelValue, [field.key]: $event })
        "
        @resolved="emit('references', field.key, $event)"
        @ready="emit('ready', field.key, $event)"
      />
      <v-textarea
        v-else-if="field.type === 'textarea'"
        :label="field.caption"
        :model-value="modelValue[field.key]"
        :disabled="disabled || Boolean(readonlyFields?.includes(field.key))"
        @update:model-value="update(field, $event)"
      />
      <v-checkbox
        v-else-if="field.type === 'boolean'"
        :label="field.caption"
        :model-value="modelValue[field.key]"
        :disabled="disabled || Boolean(readonlyFields?.includes(field.key))"
        @update:model-value="update(field, $event)"
      />
      <v-select
        v-else-if="field.type === 'enum'"
        :label="field.caption"
        :model-value="modelValue[field.key]"
        :items="field.options"
        item-title="caption"
        item-value="value"
        :disabled="disabled || Boolean(readonlyFields?.includes(field.key))"
        @update:model-value="update(field, $event)"
      />
      <v-text-field
        v-else
        :label="field.caption"
        :model-value="modelValue[field.key]"
        :type="
          field.type === 'password'
            ? 'password'
            : field.type === 'date'
              ? 'date'
              : 'text'
        "
        :disabled="disabled || Boolean(readonlyFields?.includes(field.key))"
        @update:model-value="update(field, $event)"
      />
    </template>
  </v-form>
</template>
