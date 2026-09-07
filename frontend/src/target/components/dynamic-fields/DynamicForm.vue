<script setup lang="ts" generic="Filters extends object">
import { ref } from 'vue'

import FieldInput from './FieldInput.vue'
import type { FilterField, ReferenceOptions } from './types.ts'
import { normalizeFilters } from './values.ts'

const props = withDefaults(
  defineProps<{
    fields: readonly FilterField[]
    modelValue: Filters
    referenceOptions?: ReferenceOptions
    disabled?: boolean
  }>(),
  {
    referenceOptions: () => ({}),
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: Filters]
  search: [value: Filters]
}>()

const validationError = ref<string | null>(null)

function updateField(key: string, value: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function submit(): void {
  if (props.disabled) return
  try {
    const normalized = normalizeFilters(
      props.fields as unknown as readonly FilterField<Filters>[],
      props.modelValue,
    )
    validationError.value = null
    emit('update:modelValue', normalized)
    emit('search', normalized)
  } catch (cause) {
    validationError.value =
      cause instanceof Error && cause.message ? cause.message : '筛选值无效。'
  }
}

function onEnter(event: KeyboardEvent): void {
  if (!event.isComposing) return
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <v-form
    class="dynamic-form"
    @submit.prevent="submit"
    @keydown.enter="onEnter"
  >
    <v-alert v-if="validationError" data-testid="field-error" type="error">
      {{ validationError }}
    </v-alert>
    <FieldInput
      v-for="field in fields"
      :key="field.key"
      :field="field"
      :model-value="(modelValue as Record<string, unknown>)[field.key]"
      :reference-options="referenceOptions"
      :disabled="disabled"
      @update:model-value="updateField(field.key, $event)"
    />
    <v-btn
      data-testid="list-search"
      color="primary"
      type="submit"
      :disabled="disabled"
    >
      查询
    </v-btn>
  </v-form>
</template>

<style scoped>
.dynamic-form {
  display: flex;
  grid-column: 1 / -1;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  width: 100%;
}

.dynamic-form > :deep(*) {
  min-width: 180px;
  flex: 1 1 220px;
}

.dynamic-form > :deep(.v-btn) {
  min-width: auto;
  flex: 0 0 auto;
}

@media (max-width: 600px) {
  .dynamic-form > :deep(*) {
    width: 100%;
    flex-basis: 100%;
  }
}
</style>
