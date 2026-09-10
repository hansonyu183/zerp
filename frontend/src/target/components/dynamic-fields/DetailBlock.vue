<script setup lang="ts" generic="T extends object">
import { actionIcons } from '../../presentation/action-icons.ts'
import { toRaw } from 'vue'
import FormBlock from './FormBlock.vue'
import DetailsBlock from '../details/DetailsBlock.vue'
import type { EditField } from './edit-fields.ts'
import type { DetailDefinition } from './form-fields.ts'
const props = defineProps<{
  definition: DetailDefinition<T>
  modelValue: readonly T[]
  mode: 'edit' | 'read'
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T[]] }>()
function update(index: number, value: T) {
  emit(
    'update:modelValue',
    props.modelValue.map((item, i) => (i === index ? value : item)),
  )
}
function add() {
  if (!props.disabled)
    emit('update:modelValue', [
      ...props.modelValue,
      structuredClone(toRaw(props.definition.empty)),
    ])
}
function remove(index: number) {
  if (!props.disabled)
    emit(
      'update:modelValue',
      props.modelValue.filter((_, i) => i !== index),
    )
}
</script>
<template>
  <section class="detail-block" :aria-label="definition.caption">
    <h3>{{ definition.caption }}</h3>
    <v-card
      v-for="(row, index) in modelValue"
      :key="index"
      variant="outlined"
      class="my-2 pa-3"
      :title="`${definition.caption}第 ${index + 1} 行`"
      ><FormBlock
        v-if="mode === 'edit'"
        :fields="definition.fields"
        :model-value="row"
        :disabled="Boolean(disabled)"
        @update:model-value="update(index, $event)"
      /><DetailsBlock
        v-else
        :fields="definition.fields as readonly EditField[]"
        :value="row as Record<string, unknown>"
      /><v-btn
        :prepend-icon="actionIcons.remove"
        v-if="mode === 'edit'"
        :disabled="disabled"
        @click="remove(index)"
        >移除{{ definition.caption }}第 {{ index + 1 }} 行</v-btn
      ></v-card
    ><v-btn
      :prepend-icon="actionIcons.add"
      v-if="mode === 'edit'"
      :disabled="disabled"
      @click="add"
      >添加{{ definition.caption }}</v-btn
    >
  </section>
</template>
<style scoped>
.detail-block {
  min-width: 0;
}
</style>
