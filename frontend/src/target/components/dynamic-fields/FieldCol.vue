<script setup lang="ts">
import { computed } from 'vue'

import { FieldContractError } from './contract.ts'
import { formatDecimal } from './decimal.ts'
import type { DataField, ReferenceSummary } from './types.ts'
import { assertFieldValue } from './values.ts'

const props = defineProps<{
  field: DataField
  value: unknown
}>()

const displayValue = computed(() => {
  const field = props.field
  const value = props.value
  if (value === null || value === undefined || value === '') {
    assertFieldValue(field, value)
    return value === '' && field.type === 'text'
      ? (field.emptyCaption ?? '—')
      : '—'
  }
  assertFieldValue(field, value)
  switch (field.type) {
    case 'decimal':
      return formatDecimal(value as string, field.scale)
    case 'boolean':
      return value ? (field.trueCaption ?? '是') : (field.falseCaption ?? '否')
    case 'enum': {
      const option = field.options.find((entry) => entry.value === value)
      if (!option)
        throw new FieldContractError(`字段 ${field.key} 包含未知 enum value`)
      return option.caption
    }
    case 'reference':
      return (value as ReferenceSummary).name
    case 'integer':
      return String(value)
    case 'date':
    case 'text':
      return value as string
  }
  throw new FieldContractError(
    `未知字段类型 ${String((field as DataField).type)}`,
  )
})
</script>

<template>
  <span :data-testid="`field-col-${field.key}`">{{ displayValue }}</span>
</template>
