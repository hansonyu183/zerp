<script setup lang="ts">
import { computed } from 'vue'
import type { VoucherReference } from './types'

defineOptions({ name: 'VoucherReferenceAutocomplete' })

const props = withDefaults(
  defineProps<{
    modelValue: VoucherReference | null
    options: readonly VoucherReference[]
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
  'update:modelValue': [value: VoucherReference | null]
  search: [keyword: string]
}>()

const items = computed(() => {
  if (!props.modelValue) return props.options
  const selected = props.options.some(
    (item) =>
      item.objectId === props.modelValue?.objectId &&
      item.versionId === props.modelValue?.versionId,
  )
  return selected ? props.options : [props.modelValue, ...props.options]
})

function title(item: VoucherReference): string {
  return `${item.code} · ${item.name}`
}
</script>

<template>
  <v-autocomplete
    :clearable="clearable && !required"
    :density="table ? 'compact' : 'comfortable'"
    :disabled="disabled || Boolean(errorMessage)"
    :error-messages="errorMessage ? [errorMessage] : []"
    :item-title="title"
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
        :title="title(item)"
      />
    </template>
  </v-autocomplete>
</template>
