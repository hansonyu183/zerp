<script setup lang="ts">
import type { DetailField, AttachmentSource } from './detail-fields.ts'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import AttachmentBlock from '../attachments/AttachmentBlock.vue'
import type { AttachmentMetadata } from '@zerp/model'
const props = defineProps<{
  field: DetailField
  value: unknown
  compact?: boolean
  source?: AttachmentSource
}>()
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function display(): string {
  if (props.value === null || props.value === undefined || props.value === '')
    return '—'
  if (props.field.type === 'boolean') return props.value ? '是' : '否'
  if (props.field.type === 'enum')
    return (
      props.field.options.find((item) => item.value === props.value)?.caption ??
      '未知值'
    )
  if (props.field.type === 'enum-list')
    return (
      (Array.isArray(props.value) ? props.value : [])
        .map((value) =>
          props.field.type === 'enum-list'
            ? (props.field.options.find((item) => item.value === value)
                ?.caption ?? '未知值')
            : '',
        )
        .join('、') || '无'
    )
  return String(props.value)
}
</script>
<template>
  <AttachmentBlock
    v-if="field.type === 'attachments'"
    :caption="field.caption"
    :model-value="(value ?? []) as readonly AttachmentMetadata[]"
    mode="read"
    :source="source"
  /><CollectionBlock
    v-else-if="field.type === 'rows'"
    :caption="field.caption"
    :fields="field.fields"
    :model-value="
      (Array.isArray(value) ? value : []) as Record<string, unknown>[]
    "
    mode="read"
    :source="source"
  />
  <dl v-else-if="field.type === 'group' && value">
    <template
      v-for="child in compact
        ? field.fields
            .filter(
              (child) => !['group', 'rows', 'attachments'].includes(child.type),
            )
            .slice(0, 2)
        : field.fields"
      :key="child.key"
      ><dt>{{ child.caption }}</dt>
      <dd>
        <DetailValue
          :field="child"
          :value="record(value)[child.key]"
          :source="source"
        /></dd
    ></template>
  </dl>
  <span v-else>{{ display() }}</span>
</template>
<style scoped>
dl {
  margin: 0;
}
dt {
  font-weight: 500;
}
dd {
  margin: 0 0 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
