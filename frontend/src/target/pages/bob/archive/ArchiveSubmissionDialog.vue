<script setup lang="ts" generic="Submission extends ArchiveSubmission">
import type { ProductData, CustomerData } from '@zerp/model'
import CustomerSnapshotView from '../customer/CustomerSnapshot.vue'
import ProductSnapshotView from '../product/ProductSnapshot.vue'
import { approvalStatusPresentation } from '@zerp/model'
import { computed, onUnmounted, ref, toRaw, type UnwrapRef } from 'vue'

import IdentityArchiveSnapshotView from './IdentityArchiveSnapshot.vue'
import {
  archiveAuditActionPresentation,
  type ArchiveReviewAction,
  type ArchiveSubmission,
  type ArchiveSubmissionLifecycle,
  type IdentityArchiveSnapshot as IdentityArchiveSnapshotData,
} from './lifecycle.ts'

const props = defineProps<{
  title: string
  lifecycle: UnwrapRef<ArchiveSubmissionLifecycle<Submission>>
  onClone?: (snapshot: Submission['snapshot']) => void
}>()

const reason = ref('')
const searchKeyword = ref('')
const confirmDelete = ref(false)
const pageCount = computed(() =>
  Math.max(1, Math.ceil(props.lifecycle.total / props.lifecycle.pageSize)),
)
const requiresReason = computed(
  () =>
    props.lifecycle.canAction('reject') ||
    props.lifecycle.canAction('unapprove'),
)
const snapshot = computed(
  () =>
    props.lifecycle.selected?.snapshot as
      IdentityArchiveSnapshotData | undefined,
)
const previousCustomerSnapshot = computed(() => {
  const selected = props.lifecycle.selected
  if (selected?.entity !== 'customer') return undefined
  return [...props.lifecycle.versions]
    .filter((item) => item.versionNo < selected.versionNo)
    .sort((a, b) => b.versionNo - a.versionNo)[0]?.snapshot as
    CustomerData | undefined
})
const auditLabel = (action: string) =>
  action in archiveAuditActionPresentation
    ? archiveAuditActionPresentation[
        action as keyof typeof archiveAuditActionPresentation
      ]
    : '未知动作'
const act = async (action: ArchiveReviewAction) => {
  await props.lifecycle.review(action, reason.value)
  reason.value = ''
  confirmDelete.value = false
}
const close = () => {
  reason.value = ''
  searchKeyword.value = ''
  confirmDelete.value = false
  props.lifecycle.close()
}
const cloneSelected = () => {
  const selected = props.lifecycle.selected
  if (!selected || !props.onClone) return
  props.onClone(structuredClone(toRaw(selected.snapshot)))
  close()
}

onUnmounted(() => props.lifecycle.dispose())
</script>

<template>
  <v-dialog
    :model-value="lifecycle.open"
    persistent
    max-width="1080"
    @update:model-value="$event || close()"
  >
    <v-card :title="`${title}提交记录`">
      <v-card-text>
        <v-alert v-if="lifecycle.error" type="error" class="mb-3">
          {{ lifecycle.error }}
        </v-alert>
        <v-alert v-if="lifecycle.refreshError" type="warning" class="mb-3">
          {{ lifecycle.refreshError }}
        </v-alert>
        <v-alert v-if="lifecycle.outcomeUnknown" type="warning" class="mb-3">
          操作结果尚未确认，请核实后再继续。
          <v-btn
            v-if="lifecycle.canVerifyOutcome"
            size="small"
            class="ml-2"
            @click="lifecycle.verifyOutcome()"
          >
            核实结果
          </v-btn>
        </v-alert>
        <div class="d-flex ga-2 align-center mb-3">
          <v-text-field
            v-model="searchKeyword"
            label="搜索编码或名称"
            density="compact"
            hide-details
            clearable
            @keyup.enter="lifecycle.search(searchKeyword)"
          />
          <v-btn
            :disabled="lifecycle.loading"
            @click="lifecycle.search(searchKeyword)"
          >
            搜索
          </v-btn>
        </div>
        <v-progress-linear v-if="lifecycle.loading" indeterminate />
        <v-table>
          <thead>
            <tr>
              <th>编码</th>
              <th>候选版本</th>
              <th>最新批准</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in lifecycle.items" :key="item.subjectId">
              <td>{{ item.code ?? '待编' }}</td>
              <td>
                {{
                  item.openCandidate
                    ? approvalStatusPresentation[item.openCandidate.status]
                        .label
                    : '无'
                }}
              </td>
              <td>{{ item.latestApproved?.versionNo ?? '无' }}</td>
              <td>
                <v-btn size="small" @click="lifecycle.select(item)">
                  查看
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="pageCount > 1"
          class="mt-3"
          :model-value="lifecycle.page"
          :length="pageCount"
          @update:model-value="lifecycle.goToPage($event)"
        />

        <template v-if="lifecycle.selectedSubjectId">
          <h3 class="mt-6">版本与审核</h3>
          <v-table v-if="lifecycle.versions.length">
            <thead>
              <tr>
                <th>版本</th>
                <th>状态</th>
                <th>提交时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="version in lifecycle.versions"
                :key="version.submissionId"
              >
                <td>{{ version.versionNo }}</td>
                <td>{{ approvalStatusPresentation[version.status].label }}</td>
                <td>{{ version.submittedAt }}</td>
                <td>
                  <v-btn size="small" @click="lifecycle.selectVersion(version)">
                    查看此版本
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
          <p v-else class="text-medium-emphasis mt-2">
            无版本读取权限或暂无版本。
          </p>

          <v-table v-if="lifecycle.auditHistory.length" class="mt-3">
            <thead>
              <tr>
                <th>动作</th>
                <th>操作人</th>
                <th>时间</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in lifecycle.auditHistory" :key="event.id">
                <td>{{ auditLabel(event.action) }}</td>
                <td>{{ event.actorId }}</td>
                <td>{{ event.createdAt }}</td>
                <td>{{ event.reason ?? '—' }}</td>
              </tr>
            </tbody>
          </v-table>

          <template v-if="lifecycle.selected">
            <v-textarea
              v-if="requiresReason"
              v-model="reason"
              class="mt-3"
              label="驳回或反批准原因"
            />
            <div class="d-flex flex-wrap ga-2 mt-2">
              <v-btn
                v-if="lifecycle.canAction('approve')"
                @click="act('approve')"
              >
                批准
              </v-btn>
              <v-btn
                v-if="lifecycle.canAction('reject')"
                @click="act('reject')"
              >
                驳回
              </v-btn>
              <v-btn
                v-if="lifecycle.canAction('unreject')"
                @click="act('unreject')"
              >
                恢复审核
              </v-btn>
              <v-btn
                v-if="lifecycle.canAction('unapprove')"
                @click="act('unapprove')"
              >
                反批准
              </v-btn>
              <v-btn v-if="onClone" variant="outlined" @click="cloneSelected">
                克隆为新档案
              </v-btn>
              <v-btn
                v-if="lifecycle.canAction('delete')"
                color="error"
                @click="confirmDelete = true"
              >
                删除候选
              </v-btn>
            </div>
            <CustomerSnapshotView
              v-if="lifecycle.selected.entity === 'customer'"
              :snapshot="lifecycle.selected.snapshot as CustomerData"
              :previous="previousCustomerSnapshot"
            />
            <ProductSnapshotView
              v-else-if="lifecycle.selected.entity === 'product'"
              :snapshot="lifecycle.selected.snapshot as ProductData"
            />
            <IdentityArchiveSnapshotView
              v-else-if="snapshot"
              :entity="lifecycle.selected.entity"
              :snapshot="snapshot"
            />
          </template>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="lifecycle.mutating" @click="close"> 关闭 </v-btn>
      </v-card-actions>
    </v-card>

    <v-dialog v-model="confirmDelete" max-width="440">
      <v-card title="确认删除候选版本">
        <v-card-text>删除后无法恢复，确定继续吗？</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="confirmDelete = false">取消</v-btn>
          <v-btn color="error" @click="act('delete')">确认删除</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>
