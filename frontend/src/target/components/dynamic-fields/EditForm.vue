<script setup lang="ts">
import FormBlock from './FormBlock.vue'
import type { EditField, EditValues, EditOption } from './edit-fields.ts'
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
</script>
<template>
  <v-form
    data-testid="direct-edit-form"
    @submit.prevent="!disabled && emit('submit')"
    @keydown.enter="$event.isComposing && $event.preventDefault()"
  >
    <FormBlock
      v-bind="props"
      @update:model-value="emit('update:modelValue', $event)"
      @references="(key, options) => emit('references', key, options)"
      @ready="(key, ready) => emit('ready', key, ready)"
    />
  </v-form>
</template>
