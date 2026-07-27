<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'CompactTableField' })

const props = withDefaults(defineProps<{
  modelValue: string
  rules?: readonly ((value: string) => true | string)[]
  label?: string
  inputmode?: 'decimal' | 'numeric' | 'text'
  maxlength?: number
  disabled?: boolean
}>(), {
  rules: () => [],
  label: undefined,
  inputmode: 'text',
  maxlength: undefined,
  disabled: false,
})

defineEmits<{ 'update:modelValue': [value: string] }>()

const errorMessage = computed(() => {
  for (const rule of props.rules) {
    const result = rule(props.modelValue ?? '')
    if (result !== true) return result
  }
  return ''
})
</script>

<template>
  <v-tooltip
    :disabled="!errorMessage"
    location="top"
    :text="errorMessage"
  >
    <template #activator="{ props: activatorProps }">
      <div
        v-bind="activatorProps"
        class="compact-table-field"
        :data-error-text="errorMessage || undefined"
      >
        <v-text-field
          :aria-invalid="errorMessage ? 'true' : 'false'"
          :append-inner-icon="errorMessage ? 'mdi-alert-circle-outline' : undefined"
          density="compact"
          :disabled="disabled"
          :error="Boolean(errorMessage)"
          hide-details
          :inputmode="inputmode"
          :label="label"
          :maxlength="maxlength"
          :model-value="modelValue"
          variant="underlined"
          @update:model-value="$emit('update:modelValue', $event ?? '')"
        />
        <span class="sr-only" aria-live="polite">{{ errorMessage }}</span>
      </div>
    </template>
  </v-tooltip>
</template>

<style scoped>
.compact-table-field {
  height: 40px;
  min-width: 120px;
}
.compact-table-field :deep(.v-input),
.compact-table-field :deep(.v-input__control),
.compact-table-field :deep(.v-field) {
  height: 40px;
  min-height: 40px;
}
.compact-table-field :deep(.v-field__input) {
  min-height: 40px;
  padding-block: 4px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
