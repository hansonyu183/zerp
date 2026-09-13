<script setup lang="ts">
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import type { DetailField } from '../details/detail-fields.ts'
import { dimensions } from './opening-data.ts'
import type { AccSubjectDimension } from '@zerp/model'
import { computed } from 'vue'
import { intermediaryCategoryLabels } from './intermediary-data.ts'
import { snapshotCaptions, snapshotEnums } from './snapshot-presentation.ts'
const props = defineProps<{ value: unknown; field?: string }>()
const entries = computed(() => {
  if (
    !props.value ||
    typeof props.value !== 'object' ||
    Array.isArray(props.value)
  )
    return null
  return Object.entries(props.value).filter(([key]) => key !== 'attachments')
})
const rows = computed(() =>
  Array.isArray(props.value) &&
  props.value.every(
    (item) => item && typeof item === 'object' && !Array.isArray(item),
  )
    ? (props.value as Record<string, unknown>[])
    : null,
)
const columns = computed<readonly DetailField[]>(() => {
  const keys = [
    ...new Set((rows.value ?? []).flatMap((row) => Object.keys(row))),
  ]
    .filter(
      (key) =>
        key !== 'attachments' &&
        (rows.value ?? []).every(
          (row) => row[key] == null || typeof row[key] !== 'object',
        ),
    )
    .slice(0, 4)
  return keys.map((key) => {
    const title = caption(key)
    const labels =
      snapshotEnums[key] ??
      (key === 'category' ? intermediaryCategoryLabels : undefined)
    if (labels)
      return {
        key,
        caption: title,
        type: 'enum',
        options: Object.entries(labels).map(([value, caption]) => ({
          value,
          caption,
        })),
      }
    return {
      key,
      caption: title,
      type: (rows.value ?? []).some((row) => typeof row[key] === 'boolean')
        ? 'boolean'
        : 'text',
    }
  })
})
function caption(key: string) {
  return (
    (props.field === 'dimensions'
      ? dimensions[key as AccSubjectDimension]
      : key === 'dimensions'
        ? '辅助核算'
        : snapshotCaptions[key]) ?? '未登记字段（单据数据错误）'
  )
}
const scalar = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '')
    return '—'
  if (typeof props.value === 'boolean') return props.value ? '是' : '否'
  if (props.field === 'currency')
    return /^[A-Z]{3}$/.test(String(props.value))
      ? (new Intl.DisplayNames(['zh-CN'], {
          type: 'currency',
          fallback: 'none',
        }).of(String(props.value)) ?? '未识别币种')
      : '币种格式错误'
  if (props.field === 'category' && typeof props.value === 'string') {
    return (
      intermediaryCategoryLabels[
        props.value as keyof typeof intermediaryCategoryLabels
      ] ?? props.value
    )
  }
  const captions = snapshotEnums[props.field ?? '']
  if (captions)
    return captions[String(props.value)] ?? '未知选项（单据数据错误）'
  return String(props.value)
})
</script>
<template>
  <CollectionBlock
    v-if="rows"
    :caption="snapshotCaptions[field ?? ''] ?? '明细'"
    :fields="columns"
    :model-value="rows"
    mode="read"
  >
    <template #summary="{ value: row, field: column }"
      ><SnapshotValue :value="row[column.key]" :field="column.key"
    /></template>
    <template #viewer="{ value: row }"
      ><SnapshotValue :value="row" :field="field"
    /></template>
  </CollectionBlock>
  <div v-else-if="Array.isArray(value)" class="snapshot-values">
    <span v-if="!value.length">—</span>
    <article v-for="(item, index) in value" :key="index" class="my-3">
      <span v-if="typeof item === 'object'" class="text-caption"
        >第 {{ index + 1 }} 项</span
      >
      <SnapshotValue :value="item" :field="field" />
    </article>
  </div>
  <dl v-else-if="entries" class="snapshot-values">
    <template v-for="[key, item] in entries" :key="key">
      <dt>{{ caption(key) }}</dt>
      <dd><SnapshotValue :value="item" :field="key" /></dd>
    </template>
  </dl>
  <span v-else class="snapshot-text">{{ scalar }}</span>
</template>
<style scoped>
.snapshot-values {
  overflow-wrap: anywhere;
  min-width: 0;
}
dl {
  margin: 8px 0;
  padding-left: 12px;
  border-left: 2px solid rgb(var(--v-theme-outline-variant));
}
dt {
  color: rgb(var(--v-theme-muted));
  font-size: 0.85rem;
}
dd {
  margin: 0 0 8px;
}
.snapshot-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
