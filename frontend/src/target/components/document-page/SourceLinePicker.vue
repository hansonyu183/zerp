<script setup lang="ts">
import { shallowRef, toRaw } from 'vue'
import type {
  VouSourceLineCandidate,
  VouSourceLineTargetEntity,
} from '@zerp/model'
import ReferencePicker from '../direct-page/ReferencePicker.vue'
import type { EditOption } from '../direct-page/definition.ts'
export type SourceLineChoice = Pick<
  VouSourceLineCandidate,
  'sourceDocumentId' | 'sourceLineId' | 'rootEntity' | 'rootDocumentId'
> & { sourceDocumentNo?: string; product?: VouSourceLineCandidate['product'] }
const props = defineProps<{
  entity: VouSourceLineTargetEntity
  modelValue: SourceLineChoice | null
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: SourceLineChoice | null]
}>()
const options = shallowRef<readonly EditOption[]>([])
function select(value: string | string[] | null) {
  if (props.disabled || Array.isArray(value)) return
  const choice = options.value.find(
    (item) => item.id === value && !item.disabled,
  )
  if (value && !choice?.snapshot) return
  emit(
    'update:modelValue',
    choice
      ? (structuredClone(toRaw(choice.snapshot)) as VouSourceLineCandidate)
      : null,
  )
}
</script>
<template>
  <ReferencePicker
    :source="{ kind: 'vou-source-line', entity }"
    caption="来源行"
    :model-value="
      modelValue
        ? `${modelValue.sourceDocumentId}:${modelValue.sourceLineId}`
        : null
    "
    :existing="
      modelValue
        ? [
            {
              id: `${modelValue.sourceDocumentId}:${modelValue.sourceLineId}`,
              name: modelValue.product
                ? `${modelValue.sourceDocumentNo} · ${modelValue.product.name}`
                : '已采用来源行',
              snapshot: modelValue,
            },
          ]
        : []
    "
    :multiple="false"
    :disabled="disabled"
    @resolved="options = $event"
    @update:model-value="select"
  />
</template>
