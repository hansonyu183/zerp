<script setup lang="ts">
import { formatMediumDateTime } from '@/utils/date'
import type { VoucherAuditEvent } from './types'

defineOptions({ name: 'VoucherAuditHistory' })

withDefaults(defineProps<{
  events: readonly VoucherAuditEvent[]
  loading?: boolean
  page: number
  pageSize: number
  total: number
  errorMessage?: string | null
}>(), {
  loading: false,
  errorMessage: null,
})

const emit = defineEmits<{
  'update:page': [page: number]
  reload: []
}>()

const eventText: Record<string, string> = {
  CREATED: '创建',
  SAVED: '保存',
  REVIEWED: '审核',
  UNREVIEWED: '反审核',
  APPROVED: '批准',
  UNAPPROVED: '反批准',
  EXECUTED: '执行',
  UNEXECUTED: '反执行',
  ATTACHMENT_INITIATED: '发起附件',
  ATTACHMENT_UPLOADED: '上传附件',
  ATTACHMENT_REMOVED: '移除附件',
}

</script>

<template>
  <section>
    <div class="voucher-audit__toolbar">
      <h3>审计记录</h3>
      <v-btn
        :loading="loading"
        prepend-icon="mdi-refresh"
        variant="text"
        @click="emit('reload')"
      >
        刷新
      </v-btn>
    </div>
    <v-alert v-if="errorMessage" class="mb-4" type="error" variant="tonal">
      {{ errorMessage }}
    </v-alert>
    <v-progress-linear v-if="loading" indeterminate />
    <v-timeline v-if="events.length" align="start" density="compact" side="end">
      <v-timeline-item
        v-for="event in events"
        :key="event.id"
        dot-color="primary"
        size="small"
      >
        <v-card variant="outlined">
          <v-card-title class="text-body-1">
            {{ eventText[event.eventType] ?? event.eventType }}
          </v-card-title>
          <v-card-subtitle>
            {{ formatMediumDateTime(event.occurredAt) }} · {{ event.actorId }}
          </v-card-subtitle>
          <v-card-text>
            <div>{{ event.fromStatus || '—' }} → {{ event.toStatus }}</div>
            <div v-if="event.reason" class="mt-2">原因：{{ event.reason }}</div>
            <div class="mt-2 text-caption">请求编号：{{ event.requestId }}</div>
            <v-expansion-panels v-if="event.summary" class="mt-3" variant="accordion">
              <v-expansion-panel title="变更摘要">
                <v-expansion-panel-text>
                  <pre>{{ JSON.stringify(event.summary, null, 2) }}</pre>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-card-text>
        </v-card>
      </v-timeline-item>
    </v-timeline>
    <v-empty-state
      v-else-if="!loading"
      icon="mdi-history"
      text="当前没有可显示的审计记录"
      title="暂无记录"
    />
    <v-pagination
      v-if="total > pageSize"
      class="mt-4"
      :length="Math.ceil(total / pageSize)"
      :model-value="page"
      @update:model-value="emit('update:page', $event)"
    />
  </section>
</template>

<style scoped>
.voucher-audit__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.voucher-audit__toolbar h3 { margin: 0; }
pre { overflow-x: auto; white-space: pre-wrap; }
</style>
