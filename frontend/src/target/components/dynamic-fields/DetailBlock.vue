<script setup lang="ts" generic="T extends object">
import { computed } from 'vue'
import { cloneDraft } from './clone-draft.ts'
import FormBlock from './FormBlock.vue'
import CollectionBlock from './CollectionBlock.vue'
import { formDetails } from './form-details.ts'
import type { DetailDefinition } from './form-fields.ts'
const props = defineProps<{
  definition: DetailDefinition<T>
  modelValue: readonly T[]
  mode: 'edit' | 'read'
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T[]] }>()
const details = computed(() => formDetails(props.definition.fields))
function create(): T {
  return cloneDraft(props.definition.empty)
}
</script>
<template>
  <CollectionBlock
    :caption="definition.caption"
    :fields="details"
    :model-value="modelValue"
    :mode="mode"
    :disabled="disabled"
    :create="create"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #editor="{ value, disabled: locked, update }"
      ><!-- @vue-generic {T} -->
      <FormBlock
        :fields="definition.fields"
        :model-value="value"
        :disabled="locked"
        @update:model-value="update"
    /></template>
  </CollectionBlock>
</template>
