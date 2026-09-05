<script setup lang="ts">
import type { VouVersionedReferenceInput } from '@zerp/model'

import type { VouReferenceOption } from '../vm.ts'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue?: VouVersionedReferenceInput | null
    options?: readonly VouReferenceOption[]
    required?: boolean
    disabled?: boolean
  }>(),
  { modelValue: null, options: () => [], required: false, disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: VouVersionedReferenceInput | undefined]
}>()

function update(approvalEntryId: string): void {
  const option = props.options.find(
    (candidate) => candidate.approvalEntryId === approvalEntryId,
  )
  emit(
    'update:modelValue',
    option?.approvalEntryId
      ? {
          objectId: option.objectId,
          approvalEntryId: option.approvalEntryId,
          selectionOrigin: 'CURRENT',
        }
      : undefined,
  )
}
</script>

<template>
  <label class="reference-select">
    <span>{{ label }}<strong v-if="required"> *</strong></span>
    <select
      :disabled="disabled"
      :required="required"
      :value="modelValue?.approvalEntryId ?? ''"
      @change="update(($event.target as HTMLSelectElement).value)"
    >
      <option value="">请选择{{ label }}</option>
      <option
        v-for="option in options"
        :key="option.approvalEntryId ?? option.objectId"
        :disabled="!option.approvalEntryId"
        :value="option.approvalEntryId"
      >
        {{ option.code }} · {{ option.name }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.reference-select {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.reference-select span {
  color: rgb(var(--v-theme-on-surface-variant));
}
.reference-select strong {
  color: rgb(var(--v-theme-error));
}
.reference-select select {
  min-height: 42px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  padding: 8px;
}
</style>
