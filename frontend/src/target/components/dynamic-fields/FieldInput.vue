<script setup lang="ts" generic="Value">
import { computed } from 'vue'

import type { EditField } from './edit-fields.ts'
import type { FilterField } from './types.ts'

const props = withDefaults(
  defineProps<{
    field: (
      | Exclude<FilterField, { range: true } | { type: 'reference' }>
      | Exclude<EditField, { type: 'reference' | 'multi-reference' }>
      | {
          key: string
          type: 'choice'
          caption: string
          options: readonly {
            value: string | number | boolean | null
            caption: string
            disabled?: boolean
          }[]
          multiple?: boolean
          searchable?: boolean
        }
    ) & {
      maxLength?: number
      suffix?: string
      inputMode?: 'numeric' | 'decimal' | 'text'
    }
    usage?: 'filter' | 'edit'
    clearable?: boolean
    loading?: boolean
    errorMessages?: string
    remoteSearch?: boolean
    modelValue: Value
    disabled?: boolean
  }>(),
  {
    disabled: false,
    usage: 'filter',
    clearable: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: Value]
  search: [value: string]
}>()

function searchInput(event: Event) {
  if (event.target instanceof HTMLInputElement && !inputDisabled.value)
    emit('search', event.target.value)
}

function update(value: unknown) {
  if (!inputDisabled.value) emit('update:modelValue', value as Value)
}

const selectItems = computed(() => {
  if (props.field.type === 'enum' || props.field.type === 'choice')
    return props.field.options.map((option) => ({
      title: option.caption,
      value: option.value,
      props: { disabled: 'disabled' in option && Boolean(option.disabled) },
    }))
  if (props.field.type === 'boolean')
    return [
      { title: '全部', value: null },
      {
        title:
          ('trueCaption' in props.field
            ? props.field.trueCaption
            : undefined) ?? '是',
        value: true,
      },
      {
        title:
          ('falseCaption' in props.field
            ? props.field.falseCaption
            : undefined) ?? '否',
        value: false,
      },
    ]
  return []
})

const inputDisabled = computed(() => props.disabled)

function inputType(): string {
  return props.field.type === 'password'
    ? 'password'
    : props.field.type === 'date'
      ? 'date'
      : 'text'
}

function inputMode(): 'text' | 'numeric' | 'decimal' {
  if (props.field.inputMode) return props.field.inputMode
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
</script>

<template>
  <v-textarea
    :maxlength="field.maxLength"
    v-if="field.type === 'textarea'"
    :label="field.caption"
    :model-value="modelValue"
    :disabled="inputDisabled"
    @update:model-value="update($event ?? '')"
  />
  <v-checkbox
    v-else-if="field.type === 'boolean' && usage === 'edit'"
    :label="field.caption"
    :model-value="modelValue"
    :disabled="inputDisabled"
    @update:model-value="update(Boolean($event))"
  />
  <v-autocomplete
    v-else-if="field.type === 'choice' && field.searchable"
    :model-value="modelValue"
    :label="field.caption"
    :items="selectItems"
    :multiple="field.multiple"
    :chips="field.multiple"
    :disabled="inputDisabled"
    :loading="loading"
    :error-messages="errorMessages"
    :no-filter="remoteSearch"
    :clearable="clearable ?? usage === 'filter'"
    @update:model-value="update($event ?? (field.multiple ? [] : null))"
    @input="searchInput"
    @click:clear="emit('search', '')"
  />
  <v-select
    v-else-if="
      field.type === 'boolean' ||
      field.type === 'enum' ||
      field.type === 'choice'
    "
    :model-value="modelValue"
    :data-testid="`field-${field.key}`"
    :label="field.caption"
    :items="selectItems"
    :multiple="field.type === 'choice' && field.multiple"
    :disabled="inputDisabled"
    hide-details
    :clearable="clearable ?? usage === 'filter'"
    variant="outlined"
    @update:model-value="update($event ?? (field.type === 'enum' ? '' : null))"
  />
  <v-text-field
    v-else
    :model-value="modelValue"
    :data-testid="`field-${field.key}`"
    :label="field.caption"
    :type="inputType()"
    :inputmode="inputMode()"
    :maxlength="field.maxLength"
    :suffix="field.suffix"
    :disabled="inputDisabled"
    hide-details
    :clearable="clearable ?? usage === 'filter'"
    variant="outlined"
    @update:model-value="update(scalarValue($event))"
  />
</template>
