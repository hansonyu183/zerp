<script setup lang="ts">
import { shallowRef, computed, toRaw } from 'vue'
import type { TargetReferenceEntity, queryTargetVouOptions } from '../../api.ts'
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
export type VouCandidate = Awaited<
  ReturnType<typeof queryTargetVouOptions>
>['items'][number]
const props = defineProps<{
  entity: TargetReferenceEntity
  caption: string
  modelValue: VouCandidate | null
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: VouCandidate | null]
}>()
const options = shallowRef<readonly EditOption[]>([])
const existing = computed(() =>
  props.modelValue
    ? [
        {
          id: props.modelValue.objectId,
          name: `${props.modelValue.code} · ${props.modelValue.name}`,
          snapshot: props.modelValue,
        },
      ]
    : [],
)
function select(id: string | string[] | null) {
  if (props.disabled || Array.isArray(id)) return
  const item = options.value.find((item) => item.id === id && !item.disabled)
  if (id && !item?.snapshot) return
  emit(
    'update:modelValue',
    item?.snapshot
      ? (structuredClone(toRaw(item.snapshot)) as VouCandidate)
      : null,
  )
}
</script>
<template>
  <ReferencePicker
    :source="{ kind: 'vou-reference', entity }"
    :caption="caption"
    :model-value="modelValue?.objectId ?? null"
    :existing="existing"
    :multiple="false"
    :disabled="disabled"
    @resolved="options = $event"
    @update:model-value="select"
  />
</template>
