<script setup lang="ts">
import type { VouSourceLineCandidate } from '@zerp/model'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue?: string
    sourceDocumentId?: string
    options?: readonly VouSourceLineCandidate[]
    required?: boolean
    disabled?: boolean
  }>(),
  {
    modelValue: '',
    sourceDocumentId: '',
    options: () => [],
    required: false,
    disabled: false,
  },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  select: [value: VouSourceLineCandidate | undefined]
}>()

function candidateKey(candidate: VouSourceLineCandidate): string {
  return `${candidate.sourceDocumentId}:${candidate.sourceLineId}`
}
function selectedKey(): string {
  const selected = props.options.find(
    (candidate) =>
      candidate.sourceLineId === props.modelValue &&
      (!props.sourceDocumentId ||
        candidate.sourceDocumentId === props.sourceDocumentId),
  )
  return selected ? candidateKey(selected) : ''
}
function update(key: string): void {
  const candidate = props.options.find((option) => candidateKey(option) === key)
  emit('update:modelValue', candidate?.sourceLineId ?? '')
  emit('select', candidate)
}
</script>

<template>
  <label class="source-line-select">
    <span>{{ label }}<strong v-if="required"> *</strong></span>
    <select
      :disabled="disabled"
      :required="required"
      :value="selectedKey()"
      @change="update(($event.target as HTMLSelectElement).value)"
    >
      <option value="">请选择{{ label }}</option>
      <option
        v-for="option in options"
        :key="`${option.sourceDocumentId}:${option.sourceLineId}`"
        :value="candidateKey(option)"
      >
        {{ option.sourceDocumentNo }} · {{ option.businessDate }} ·
        {{ option.product.code }} {{ option.product.name }} · 可用
        {{ option.availableBaseQuantity }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.source-line-select {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.source-line-select span {
  color: rgb(var(--v-theme-on-surface-variant));
}
.source-line-select strong {
  color: rgb(var(--v-theme-error));
}
.source-line-select select {
  min-height: 42px;
  min-width: 260px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  padding: 8px;
}
</style>
