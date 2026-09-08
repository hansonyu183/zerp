<script setup lang="ts">
import { approvalStatusPresentation } from '@zerp/model'
import {
  archiveAuditActionPresentation,
  type ArchiveAuditEvent,
} from './metadata.ts'
import type { VersionSubmission } from './definition.ts'
defineProps<{
  versions: readonly Pick<
    VersionSubmission<unknown>,
    'subjectId' | 'submissionId' | 'versionNo' | 'status' | 'submittedAt'
  >[]
  audits: readonly ArchiveAuditEvent[]
  selectedId: string | null
}>()
const emit = defineEmits<{
  select: [submission: { subjectId: string; submissionId: string }]
}>()
function auditLabel(action: string) {
  return (
    archiveAuditActionPresentation[
      action as keyof typeof archiveAuditActionPresentation
    ] ?? '未知动作'
  )
}
</script>
<template>
  <section class="history-block" aria-label="版本与审核">
    <h3>版本与审核</h3>
    <v-table v-if="versions.length"
      ><thead>
        <tr>
          <th>版本</th>
          <th>状态</th>
          <th>提交时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="version in versions" :key="version.submissionId">
          <td>{{ version.versionNo ?? '待分配' }}</td>
          <td>{{ approvalStatusPresentation[version.status].label }}</td>
          <td>{{ version.submittedAt || '—' }}</td>
          <td>
            <v-btn
              :disabled="selectedId === version.submissionId"
              @click="
                emit('select', {
                  subjectId: version.subjectId,
                  submissionId: version.submissionId,
                })
              "
              >查看版本 {{ version.versionNo ?? '待分配' }}</v-btn
            >
          </td>
        </tr>
      </tbody></v-table
    >
    <v-table v-if="audits.length"
      ><thead>
        <tr>
          <th>动作</th>
          <th>操作人</th>
          <th>时间</th>
          <th>原因</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="event in audits" :key="event.id">
          <td>{{ auditLabel(event.action) }}</td>
          <td>{{ event.actorId }}</td>
          <td>{{ event.createdAt }}</td>
          <td>{{ event.reason ?? '—' }}</td>
        </tr>
      </tbody></v-table
    >
  </section>
</template>
<style scoped>
.history-block {
  min-width: 0;
  overflow-x: auto;
}
</style>
