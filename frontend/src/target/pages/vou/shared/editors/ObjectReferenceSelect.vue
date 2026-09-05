<script setup lang="ts">
import type { VouObjectReferenceInput } from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue?: VouObjectReferenceInput | null
    options?: readonly VouReferenceOption[]
    required?: boolean
    disabled?: boolean
  }>(),
  { modelValue: null, options: () => [], required: false, disabled: false },
)
const emit = defineEmits<{
  'update:modelValue': [value: VouObjectReferenceInput | undefined]
}>()

function update(objectId: string): void {
  emit('update:modelValue', objectId ? { objectId } : undefined)
}
</script>

<template>
  <label class="object-reference-select">
    <span>{{ label }}<strong v-if="required"> *</strong></span>
    <select
      :disabled="disabled"
      :required="required"
      :value="modelValue?.objectId ?? ''"
      @change="update(($event.target as HTMLSelectElement).value)"
    >
      <option value="">请选择{{ label }}</option>
      <option
        v-for="option in options"
        :key="option.objectId"
        :value="option.objectId"
      >
        {{ option.code }} · {{ option.name }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.object-reference-select {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.object-reference-select span {
  color: rgb(var(--v-theme-on-surface-variant));
}
.object-reference-select strong {
  color: rgb(var(--v-theme-error));
}
.object-reference-select select {
  min-height: 42px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  padding: 8px;
}
</style>
