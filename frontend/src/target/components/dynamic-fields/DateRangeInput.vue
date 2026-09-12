<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FieldRange } from './types.ts'
const props = defineProps<{
  caption: string
  modelValue: FieldRange<string>
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: FieldRange<string>] }>()
const open = ref(false)
const text = computed(() =>
  props.modelValue.from || props.modelValue.to
    ? `${props.modelValue.from ?? '不限'} 至 ${props.modelValue.to ?? '不限'}`
    : '',
)
function update(endpoint: 'from' | 'to', value: string | null) {
  if (!props.disabled)
    emit('update:modelValue', {
      ...props.modelValue,
      [endpoint]: value || null,
    })
}
function clear() {
  if (!props.disabled) emit('update:modelValue', { from: null, to: null })
}
function date(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
function format(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
const selected = computed(() => {
  const { from, to } = props.modelValue
  if (!from) return []
  return to ? [date(from), date(to)] : [date(from)]
})
function select(values: unknown) {
  if (props.disabled || !Array.isArray(values)) return
  const dates = values
    .filter((v): v is Date => v instanceof Date)
    .map(format)
    .sort()
  if (!dates.length && props.modelValue.from && !props.modelValue.to) {
    emit('update:modelValue', {
      from: props.modelValue.from,
      to: props.modelValue.from,
    })
    return
  }
  emit('update:modelValue', {
    from: dates[0] ?? null,
    to: dates.length > 1 ? dates.at(-1)! : null,
  })
}
</script>
<template>
  <div class="date-range-input">
    <v-menu
      v-model="open"
      :close-on-content-click="false"
      :disabled="disabled"
      max-width="380"
    >
      <template #activator="{ props: activator }">
        <v-text-field
          v-bind="activator"
          :label="caption"
          :model-value="text"
          :disabled="disabled"
          readonly
          clearable
          hide-details
          variant="outlined"
          prepend-inner-icon="mdi-calendar-range"
          @click:clear.stop="clear"
        />
      </template>
      <v-card class="pa-4">
        <div class="range-endpoints">
          <v-text-field
            :model-value="modelValue.from"
            label="开始日期"
            type="date"
            hide-details
            :disabled="disabled"
            @update:model-value="update('from', $event)"
          />
          <v-text-field
            :model-value="modelValue.to"
            label="结束日期"
            type="date"
            hide-details
            :disabled="disabled"
            @update:model-value="update('to', $event)"
          />
        </div>
        <v-date-picker
          :model-value="selected"
          multiple="range"
          hide-header
          show-adjacent-months
          :disabled="disabled"
          @update:model-value="select"
        />
        <v-card-actions
          ><v-btn @click="clear">清空</v-btn><v-spacer /><v-btn
            @click="open = false"
            >完成</v-btn
          ></v-card-actions
        >
      </v-card>
    </v-menu>
  </div>
</template>
<style scoped>
.date-range-input {
  min-width: 0;
}
.date-range-input :deep(input[readonly]) {
  font-size: 14px;
  letter-spacing: 0;
}
.range-endpoints {
  display: grid;
  gap: 16px;
}
:deep(.v-date-picker) {
  max-width: 100%;
}
</style>
