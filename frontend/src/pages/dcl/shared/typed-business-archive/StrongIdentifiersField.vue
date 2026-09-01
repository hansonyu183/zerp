<script setup lang="ts">
import { computed } from 'vue'
import type { components } from '@/api/generated/schema'

type BusinessIdentifier = components['schemas']['BusinessIdentifier']

const props = defineProps<{
  modelValue: unknown
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: BusinessIdentifier[]]
}>()

const identifierTypes = [
  { title: '身份证件号', value: 'PERSON_ID' },
  { title: '统一社会信用代码', value: 'UNIFIED_SOCIAL_CREDIT_CODE' },
  { title: '税号', value: 'TAX_NUMBER' },
] as const

const identifiers = computed(() => props.modelValue as BusinessIdentifier[])

function update(index: number, value: Partial<BusinessIdentifier>): void {
  emit(
    'update:modelValue',
    identifiers.value.map((identifier, currentIndex) =>
      currentIndex === index ? { ...identifier, ...value } : identifier,
    ),
  )
}

function add(): void {
  if (identifiers.value.length >= 10) return
  emit('update:modelValue', [
    ...identifiers.value,
    { type: 'UNIFIED_SOCIAL_CREDIT_CODE', value: '' },
  ])
}

function remove(index: number): void {
  emit(
    'update:modelValue',
    identifiers.value.filter((_, currentIndex) => currentIndex !== index),
  )
}
</script>

<template>
  <div class="strong-identifiers-field">
    <div class="d-flex align-center mb-2">
      <div class="text-subtitle-2">强标识</div>
      <v-spacer />
      <v-btn
        size="small"
        :disabled="disabled || identifiers.length >= 10"
        @click="add"
      >
        新增强标识
      </v-btn>
    </div>
    <div
      v-for="(identifier, index) in identifiers"
      :key="index"
      class="strong-identifiers-field__row"
    >
      <v-select
        :disabled="disabled"
        :items="identifierTypes"
        label="强标识类型"
        :model-value="identifier.type"
        @update:model-value="update(index, { type: $event })"
      />
      <v-text-field
        :disabled="disabled"
        label="强标识值"
        :model-value="identifier.value"
        @update:model-value="update(index, { value: $event })"
      />
      <v-btn
        icon="mdi-delete-outline"
        :disabled="disabled"
        variant="text"
        @click="remove(index)"
      />
    </div>
  </div>
</template>

<style scoped>
.strong-identifiers-field__row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 2fr) auto;
  gap: 12px;
  align-items: start;
}
</style>
