<script setup lang="ts">
import { computed } from 'vue'
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
      {
        COMMISSION: '佣金',
        INTERMEDIARY: '居间费',
        EXTERNAL_PART_TIME: '外部兼职',
        CHANNEL_PARTNER: '渠道合作方',
      }[props.value] ?? props.value
    )
  }
  const captions = snapshotEnums[props.field ?? '']
  if (captions)
    return captions[String(props.value)] ?? '未知选项（单据数据错误）'
  return String(props.value)
})
</script>
<template>
  <div v-if="Array.isArray(value)" class="snapshot-values">
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
      <dt>{{ snapshotCaptions[key] ?? '未登记字段（单据数据错误）' }}</dt>
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
  color: rgb(var(--v-theme-on-surface-variant));
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
