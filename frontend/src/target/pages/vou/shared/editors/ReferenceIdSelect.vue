<script setup lang="ts">
import type { VouReferenceOption } from '../vm.ts'

withDefaults(
  defineProps<{
    label: string
    modelValue?: string
    options?: readonly VouReferenceOption[]
    required?: boolean
    disabled?: boolean
  }>(),
  { modelValue: '', options: () => [], required: false, disabled: false },
)
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="reference-id-select">
    <span>{{ label }}<strong v-if="required"> *</strong></span>
    <select
      :disabled="disabled"
      :required="required"
      :value="modelValue"
      @change="
        $emit('update:modelValue', ($event.target as HTMLSelectElement).value)
      "
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
.reference-id-select {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.reference-id-select span {
  color: rgb(var(--v-theme-on-surface-variant));
}
.reference-id-select strong {
  color: rgb(var(--v-theme-error));
}
.reference-id-select select {
  min-height: 42px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  padding: 8px;
}
</style>
