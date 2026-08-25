<script setup lang="ts" generic="T extends ReferenceOption">
import { computed } from 'vue'
import { formatReferenceLabel } from '@/utils/reference-label'

export interface ReferenceOption {
  objectId: string
  approvalEntryId: string
  entity?: string
  code: string
  name: string
}

defineOptions({ name: 'ReferenceAutocomplete' })

const props = withDefaults(
  defineProps<{
    modelValue: T | null
    options: readonly T[]
    label: string
    loading?: boolean
    disabled?: boolean
    required?: boolean
    clearable?: boolean
    errorMessage?: string | null
    table?: boolean
  }>(),
  {
    loading: false,
    disabled: false,
    required: false,
    clearable: true,
    errorMessage: null,
    table: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: T | null]
  search: [keyword: string]
}>()

const items = computed(() => {
  if (!props.modelValue) return props.options
  const selected = props.options.some(
    (item) =>
      item.objectId === props.modelValue?.objectId &&
      item.approvalEntryId === props.modelValue?.approvalEntryId,
  )
  return selected ? props.options : [props.modelValue, ...props.options]
})
</script>

<template>
  <v-autocomplete
    :clearable="clearable && !required"
    :density="table ? 'compact' : 'comfortable'"
    :disabled="disabled"
    :error-messages="errorMessage ? [errorMessage] : []"
    :item-title="formatReferenceLabel"
    :items="items"
    :label="label"
    :loading="loading"
    :model-value="modelValue"
    :hide-details="table"
    no-filter
    return-object
    :rules="
      required ? [(value: unknown) => Boolean(value) || `请选择${label}。`] : []
    "
    :variant="table ? 'underlined' : 'outlined'"
    @update:model-value="emit('update:modelValue', $event ?? null)"
    @update:search="emit('search', $event ?? '')"
  >
    <template #item="{ props: itemProps, item }">
      <v-list-item
        v-bind="itemProps"
        :subtitle="item.entity"
        :title="formatReferenceLabel(item)"
      />
    </template>
  </v-autocomplete>
</template>
