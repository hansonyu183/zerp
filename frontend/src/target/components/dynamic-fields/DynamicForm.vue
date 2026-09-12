<script setup lang="ts" generic="Filters extends object">
import { actionIcons } from '../../presentation/action-icons.ts'
import { computed, ref } from 'vue'
import FilterInput from './FilterInput.vue'

import type { FieldRange, FilterField } from './types.ts'
import { normalizeFilters } from './values.ts'

const props = withDefaults(
  defineProps<{
    fields: readonly FilterField[]
    modelValue: Filters
    disabled?: boolean
  }>(),
  {
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: Filters]
  search: [value: Filters]
}>()

const validationError = ref<string | null>(null)
const expanded = ref(false)
const hiddenCount = computed(
  () =>
    props.fields.slice(2).filter((field) => {
      const value = (props.modelValue as Record<string, unknown>)[field.key]
      const filled = (v: unknown) => v !== null && v !== undefined && v !== ''
      return field.range
        ? filled(rangeValue(field.key).from) || filled(rangeValue(field.key).to)
        : filled(value)
    }).length,
)

function updateField(key: string, value: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function rangeValue(key: string): FieldRange<unknown> {
  const value = (props.modelValue as Record<string, unknown>)[key]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const range = value as Partial<FieldRange<unknown>>
    return { from: range.from ?? null, to: range.to ?? null }
  }
  return { from: null, to: null }
}
function submit(): void {
  if (props.disabled) return
  try {
    const normalized = normalizeFilters(
      props.fields as unknown as readonly FilterField<Filters>[],
      props.modelValue,
    )
    validationError.value = null
    emit('update:modelValue', normalized)
    emit('search', normalized)
  } catch (cause) {
    validationError.value =
      cause instanceof Error && cause.message ? cause.message : '筛选值无效。'
  }
}

function onEnter(event: KeyboardEvent): void {
  if (!event.isComposing) return
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <v-form
    class="dynamic-form"
    @submit.prevent="submit"
    @keydown.enter="onEnter"
  >
    <v-alert v-if="validationError" data-testid="field-error" type="error">
      {{ validationError }}
    </v-alert>
    <div
      v-for="field in fields.slice(0, 2)"
      :key="field.key"
      class="filter-control"
    >
      <FilterInput
        :field="field"
        :model-value="(modelValue as Record<string, unknown>)[field.key]"
        :disabled="disabled"
        @update:model-value="updateField(field.key, $event)"
      />
    </div>
    <v-btn
      v-if="fields.length > 2"
      variant="text"
      :aria-expanded="expanded"
      :append-icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
      data-testid="more-filters"
      @click="expanded = !expanded"
      >{{ expanded ? '收起条件' : '更多条件'
      }}{{ hiddenCount ? `（${hiddenCount}）` : '' }}</v-btn
    >
    <v-btn
      :prepend-icon="actionIcons.search"
      data-testid="list-search"
      color="primary"
      type="submit"
      :disabled="disabled"
    >
      查询
    </v-btn>
    <div v-if="fields.length > 2" v-show="expanded" class="extra-filters">
      <div
        v-for="field in fields.slice(2)"
        :key="field.key"
        class="filter-control"
      >
        <FilterInput
          :field="field"
          :model-value="(modelValue as Record<string, unknown>)[field.key]"
          :disabled="disabled"
          @update:model-value="updateField(field.key, $event)"
        />
      </div>
    </div>
  </v-form>
</template>

<style scoped>
.dynamic-form {
  display: flex;
  grid-column: 1 / -1;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  width: 100%;
}
.filter-control {
  min-width: 0;
  flex: 1 1 220px;
}
.extra-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  flex: 1 1 100%;
  width: 100%;
}
@media (max-width: 599px) {
  .filter-control {
    flex-basis: 100%;
  }
}
</style>
