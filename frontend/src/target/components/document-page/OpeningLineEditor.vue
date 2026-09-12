<script setup lang="ts">
import { ref } from 'vue'
import type { AccSubjectDimension } from '@zerp/model'
import type * as api from '../../api.ts'
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import {
  dimensions,
  dimensionSources,
  type OpeningDraft,
} from './opening-data.ts'
import { openingLineFields } from './opening-fields-definition.ts'
type Line = OpeningDraft['lines'][number]
const props = defineProps<{
  modelValue: Line
  bookId: string
  localOptions: Partial<Record<AccSubjectDimension, readonly EditOption[]>>
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Line] }>()
const subjects = ref<
  Awaited<ReturnType<typeof api.queryTargetSubjectOptions>>['items']
>([])
function adoptSubjects(items: readonly EditOption[]) {
  subjects.value = items.flatMap((item) =>
    item.snapshot ? [item.snapshot as (typeof subjects.value)[number]] : [],
  )
}
function update(value: Line) {
  if (!props.disabled) emit('update:modelValue', value)
}
function setSubject(id: string) {
  const value = { ...props.modelValue, subjectId: id, dimensions: {} } as Line
  const subject = subjects.value.find((row) => row.id === id)
  delete value.quantity
  if (subject?.inventoryQuantity) value.quantity = '0'
  for (const dimension of subject?.requiredDimensions ?? [])
    value.dimensions[dimension] = ''
  update(value)
}
</script>
<template>
  <div class="form-stack">
    <FormBlock
      :fields="openingLineFields(modelValue)"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="update($event)"
    />
    <ReferencePicker
      :source="{ kind: 'subject', bookId: bookId }"
      caption="科目"
      :model-value="modelValue.subjectId"
      :existing="[]"
      :multiple="false"
      :disabled="disabled || !bookId"
      @resolved="adoptSubjects"
      @update:model-value="setSubject(($event as string) ?? '')"
    />

    <ReferencePicker
      v-for="dimension in Object.keys(
        modelValue.dimensions,
      ) as AccSubjectDimension[]"
      :key="dimension"
      :source="{
        kind: 'vou-reference',
        entity: dimensionSources[dimension],
      }"
      :caption="dimensions[dimension]"
      :model-value="modelValue.dimensions[dimension] ?? null"
      :existing="[]"
      :multiple="false"
      :disabled="disabled"
      :local-options="localOptions[dimension] ?? []"
      @update:model-value="
        update({
          ...modelValue,
          dimensions: {
            ...modelValue.dimensions,
            [dimension]: ($event as string) ?? '',
          },
        })
      "
    />
  </div>
</template>
