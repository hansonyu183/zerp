<script setup lang="ts">
import type { WflAuditEvent } from './types'

withDefaults(
  defineProps<{
    events: readonly WflAuditEvent[]
    loading?: boolean
    page: number
    pageSize: number
    total: number
    errorMessage?: string | null
  }>(),
  {
    loading: false,
    errorMessage: null,
  },
)

const emit = defineEmits<{
  'update:page': [page: number]
  reload: []
}>()

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value))
}
</script>

<template>
  <section>
    <div class="wfl-audit__toolbar">
      <h3>流程审计</h3>
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
          <v-card-title class="text-body-1">{{ event.eventType }}</v-card-title>
          <v-card-subtitle>
            {{ formatTime(event.occurredAt) }} · {{ event.actorId }}
          </v-card-subtitle>
          <v-card-text>
            <div v-if="event.documentNo">
              {{ event.stage || '流程' }} · {{ event.documentNo }}
              <span v-if="event.documentStatus">· {{ event.documentStatus }}</span>
            </div>
            <div>{{ event.fromStatus || '—' }} → {{ event.toStatus }}</div>
            <div v-if="event.reason" class="mt-2">原因：{{ event.reason }}</div>
            <div class="mt-2 text-caption">请求编号：{{ event.requestId }}</div>
            <v-expansion-panels
              v-if="event.summary"
              class="mt-3"
              variant="accordion"
            >
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
      text="当前没有可显示的流程审计"
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
.wfl-audit__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wfl-audit__toolbar h3 { margin: 0; }
pre { overflow-x: auto; white-space: pre-wrap; }
</style>
