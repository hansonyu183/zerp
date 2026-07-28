<script setup lang="ts">
import { computed } from 'vue'
import type { LedgerReference } from './types'

defineOptions({ name: 'LedgerReferenceAutocomplete' })

const props = withDefaults(
  defineProps<{
    modelValue: LedgerReference | null
    options: readonly LedgerReference[]
    label: string
    loading?: boolean
    disabled?: boolean
    errorMessage?: string | null
    table?: boolean
  }>(),
  {
    loading: false,
    disabled: false,
    errorMessage: null,
    table: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: LedgerReference | null]
  search: [keyword: string]
}>()

const items = computed(() => {
  if (!props.modelValue) return props.options
  return props.options.some(
    (item) =>
      item.objectId === props.modelValue?.objectId &&
      item.versionId === props.modelValue?.versionId,
  )
    ? props.options
    : [props.modelValue, ...props.options]
})

function title(item: LedgerReference): string {
  return `${item.code} · ${item.name}`
}
</script>

<template>
  <v-autocomplete
    clearable
    :density="table ? 'compact' : 'comfortable'"
    :disabled="disabled"
    :error-messages="errorMessage ? [errorMessage] : []"
    :item-title="title"
    :items="items"
    :label="label"
    :loading="loading"
    :model-value="modelValue"
    :hide-details="table"
    no-filter
    return-object
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
