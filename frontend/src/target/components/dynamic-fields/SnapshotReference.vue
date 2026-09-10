<script setup lang="ts" generic="T extends object">
import { computed, shallowRef, toRaw } from 'vue'
import ReferencePicker from './ReferencePicker.vue'
import type { EditOption, EditReferenceSource } from './edit-fields.ts'
const props = defineProps<{
  source: EditReferenceSource
  caption: string
  modelValue: T | readonly T[] | null
  disabled: boolean
  multiple?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T | T[] | null] }>()
const options = shallowRef<readonly EditOption[]>([])
function identity(value: object): string {
  const record = value as Record<string, unknown>
  return String(record.id ?? record.objectId ?? '')
}
const adopted = computed(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as T[])
    : props.modelValue
      ? [props.modelValue as T]
      : [],
)
const existing = computed(() =>
  adopted.value
    .filter((item) => identity(item))
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        id: identity(item),
        name: `${record.code ?? ''} · ${record.name ?? ''}`,
        snapshot: item,
      }
    }),
)
const selected = computed(() =>
  props.multiple
    ? adopted.value.map(identity)
    : props.modelValue
      ? identity(props.modelValue)
      : null,
)
function select(value: string | string[] | null) {
  const ids = Array.isArray(value) ? value : value ? [value] : []
  const snapshots = ids.flatMap((id) => {
    // Keep exact adopted snapshots until the user explicitly selects a different association.
    const previous = adopted.value.find((item) => identity(item) === id)
    const next =
      previous ??
      options.value.find((item) => item.id === id && !item.disabled)?.snapshot
    return next ? [structuredClone(toRaw(next)) as T] : []
  })
  emit('update:modelValue', props.multiple ? snapshots : (snapshots[0] ?? null))
}
</script>
<template>
  <ReferencePicker
    :key="source"
    :source="source"
    :caption="caption"
    :model-value="selected"
    :existing="existing"
    :multiple="Boolean(multiple)"
    :disabled="disabled"
    @resolved="options = $event"
    @update:model-value="select"
  />
</template>
