<script setup lang="ts">
import { computed } from 'vue'

import type { FieldRange, FilterField, ReferenceOptions } from './types.ts'

const props = withDefaults(
  defineProps<{
    field: FilterField
    modelValue: unknown
    referenceOptions?: ReferenceOptions
    disabled?: boolean
  }>(),
  {
    referenceOptions: () => ({}),
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

const rangeValue = computed<FieldRange<unknown>>(() => {
  if (
    props.modelValue !== null &&
    typeof props.modelValue === 'object' &&
    !Array.isArray(props.modelValue)
  ) {
    const value = props.modelValue as Partial<FieldRange<unknown>>
    return { from: value.from ?? null, to: value.to ?? null }
  }
  return { from: null, to: null }
})

const selectItems = computed(() => {
  if (props.field.type === 'enum')
    return props.field.options.map((option) => ({
      title: option.caption,
      value: option.value,
    }))
  if (props.field.type === 'boolean')
    return [
      { title: '全部', value: null },
      { title: props.field.trueCaption ?? '是', value: true },
      { title: props.field.falseCaption ?? '否', value: false },
    ]
  if (props.field.type === 'reference')
    return (props.referenceOptions[props.field.source] ?? []).map((option) => ({
      title: option.name,
      value: option.id,
      props: option.disabled ? { disabled: true } : undefined,
    }))
  return []
})

const inputDisabled = computed(
  () =>
    props.disabled ||
    (props.field.type === 'reference' &&
      (!Object.prototype.hasOwnProperty.call(
        props.referenceOptions,
        props.field.source,
      ) ||
        !Array.isArray(props.referenceOptions[props.field.source]))),
)

function inputType(): string {
  return props.field.type === 'date' ? 'date' : 'text'
}

function inputMode(): 'text' | 'numeric' | 'decimal' {
  if (props.field.type === 'integer') return 'numeric'
  if (props.field.type === 'decimal') return 'decimal'
  return 'text'
}

function scalarValue(value: unknown): unknown {
  if (props.field.type !== 'integer') return value ?? ''
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return value
  if (/^-?\d+$/.test(String(value))) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return value
}

function updateRange(endpoint: 'from' | 'to', value: unknown): void {
  emit('update:modelValue', {
    ...rangeValue.value,
    [endpoint]: scalarValue(value) === '' ? null : scalarValue(value),
  })
}
</script>

<template>
  <div
    v-if="field.range === true"
    class="dynamic-field-range"
    :data-testid="`field-${field.key}`"
  >
    <v-text-field
      :model-value="rangeValue.from"
      :label="`${field.caption}起`"
      :type="inputType()"
      :inputmode="inputMode()"
      :disabled="inputDisabled"
      hide-details
      clearable
      variant="outlined"
      @update:model-value="updateRange('from', $event)"
    />
    <v-text-field
      :model-value="rangeValue.to"
      :label="`${field.caption}止`"
      :type="inputType()"
      :inputmode="inputMode()"
      :disabled="inputDisabled"
      hide-details
      clearable
      variant="outlined"
      @update:model-value="updateRange('to', $event)"
    />
  </div>
  <v-select
    v-else-if="
      field.type === 'boolean' ||
      field.type === 'enum' ||
      field.type === 'reference'
    "
    :model-value="modelValue"
    :data-testid="`field-${field.key}`"
    :label="field.caption"
    :items="selectItems"
    :disabled="inputDisabled"
    hide-details
    clearable
    variant="outlined"
    @update:model-value="
      emit('update:modelValue', $event ?? (field.type === 'enum' ? '' : null))
    "
  />
  <v-text-field
    v-else
    :model-value="modelValue"
    :data-testid="`field-${field.key}`"
    :label="field.caption"
    :type="inputType()"
    :inputmode="inputMode()"
    :disabled="inputDisabled"
    hide-details
    clearable
    variant="outlined"
    @update:model-value="emit('update:modelValue', scalarValue($event))"
  />
</template>

<style scoped>
.dynamic-field-range {
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 1fr));
  gap: 8px;
}

@media (max-width: 600px) {
  .dynamic-field-range {
    grid-template-columns: 1fr;
  }
}
</style>
