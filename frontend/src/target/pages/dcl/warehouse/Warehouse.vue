<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'

import type { ApprovalAction } from '@zerp/model'

import type { WarehouseDraft } from '../../../warehouse-drafts.ts'
import { useWarehouseViewModel } from './vm.ts'

const vm = reactive(useWarehouseViewModel())
const route = useRoute()

const managerItems = computed(() =>
  vm.managerCandidates.map((candidate) => ({
    title: `${String(candidate.code ?? '')} · ${String(candidate.name ?? '')}`,
    value: String(candidate.objectId ?? ''),
    candidate,
  })),
)

function managerChanged(draft: WarehouseDraft, employeeId: string | null) {
  const selected = managerItems.value.find((item) => item.value === employeeId)
  vm.selectManager(draft, selected?.candidate ?? null)
}

function actionLabel(action: ApprovalAction): string {
  return {
    approve: '批准',
    reject: '驳回',
    unreject: '恢复审核',
    unapprove: '反批准',
  }[action]
}

function statusLabel(status: string): string {
  return (
    { PENDING: '待批准', APPROVED: '已批准', REJECTED: '已驳回' }[status] ??
    status
  )
}

function deepLink() {
  return {
    ...(typeof route.query.objectId === 'string'
      ? { objectId: route.query.objectId }
      : {}),
    ...(typeof route.query.submissionId === 'string'
      ? { submissionId: route.query.submissionId }
      : {}),
    ...(typeof route.query.revision === 'string'
      ? { revision: route.query.revision }
      : {}),
    ...(typeof route.query.mode === 'string' ? { mode: route.query.mode } : {}),
  }
}

let initialized = false
onMounted(async () => {
  await Promise.all([vm.loadDrafts(), vm.loadManagerCandidates(), vm.query(1)])
  initialized = true
  await vm.synchronizeDeepLink(deepLink())
})
watch(
  () => [
    route.query.objectId,
    route.query.submissionId,
    route.query.revision,
    route.query.mode,
  ],
  () => initialized && void vm.synchronizeDeepLink(deepLink()),
)
</script>

<template>
  <v-container fluid class="page-shell" data-testid="warehouse-page">
    <v-alert type="info" variant="tonal" class="mb-4">
      编辑内容仅保存在当前浏览器和当前用户空间；提交后才形成服务器 Submission。
    </v-alert>
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-alert v-if="vm.message" type="success" variant="tonal" class="mb-4">
      {{ vm.message }}
    </v-alert>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        仓库申报
        <v-spacer />
        <v-btn
          v-if="vm.canCreate"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.newDraft"
        >
          新建本地草稿
        </v-btn>
      </v-card-title>
      <v-card-text>
        <v-form class="filters" @submit.prevent="vm.query(1)">
          <v-text-field
            v-model="vm.filters.keyword"
            label="编码、名称或负责人"
            variant="outlined"
            hide-details
            clearable
          />
          <v-select
            v-model="vm.filters.status"
            label="审批状态"
            :items="[
              { title: '全部', value: '' },
              { title: '待批准', value: 'PENDING' },
              { title: '已批准', value: 'APPROVED' },
              { title: '已驳回', value: 'REJECTED' },
            ]"
            variant="outlined"
            hide-details
          />
          <v-select
            v-model="vm.filters.enabled"
            label="启用状态"
            :items="[
              { title: '全部', value: '' },
              { title: '启用', value: 'true' },
              { title: '停用', value: 'false' },
            ]"
            variant="outlined"
            hide-details
          />
          <v-btn type="submit" color="primary">查询</v-btn>
        </v-form>
        <v-data-table
          :headers="[
            { title: '编码', key: 'code' },
            { title: '名称', key: 'name' },
            { title: '负责人', key: 'managerName' },
            { title: '启用', key: 'enabled' },
            { title: '当前正式', key: 'latestApproved' },
            { title: '开放候选', key: 'openCandidate' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="vm.subjects"
          :loading="vm.loading"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.enabled="{ item }">
            <v-chip size="small" :color="item.enabled ? 'success' : 'default'">
              {{ item.enabled ? '启用' : '停用' }}
            </v-chip>
          </template>
          <template #item.latestApproved="{ item }">
            <v-chip v-if="item.latestApproved" size="small" color="success">
              V{{ item.latestApproved.versionNo }} ·
              {{ statusLabel(item.latestApproved.status) }}
            </v-chip>
            <span v-else>—</span>
          </template>
          <template #item.openCandidate="{ item }">
            <v-chip v-if="item.openCandidate" size="small" color="warning">
              V{{ item.openCandidate.versionNo }} ·
              {{ statusLabel(item.openCandidate.status) }}
            </v-chip>
            <span v-else>—</span>
          </template>
          <template #item.actions="{ item }">
            <v-btn
              v-if="item.openCandidate ?? item.latestApproved"
              data-testid="dcl-submission"
              :data-archive-status="
                (item.openCandidate ?? item.latestApproved)?.status
              "
              :data-submission-id="
                (item.openCandidate ?? item.latestApproved)?.submissionId
              "
              :data-archive-submission-id="
                (item.openCandidate ?? item.latestApproved)?.submissionId
              "
              size="small"
              variant="text"
              @click="
                vm.viewHistory(item.openCandidate ?? item.latestApproved!)
              "
            >
              详情与历史
            </v-btn>
            <v-btn
              v-if="!item.openCandidate && item.latestApproved && vm.canClone()"
              size="small"
              variant="text"
              @click="vm.cloneSubmission(item.latestApproved)"
            >
              克隆草稿
            </v-btn>
            <template
              v-for="submission in [item.openCandidate, item.latestApproved]"
              :key="submission?.submissionId"
            >
              <v-btn
                v-for="action in submission?.availableApprovalActions ?? []"
                :key="`${submission?.submissionId}-${action}`"
                size="small"
                variant="text"
                @click="vm.review(submission!, action)"
                >{{ actionLabel(action) }}</v-btn
              >
              <v-btn
                v-if="submission?.canDelete"
                size="small"
                color="error"
                variant="text"
                @click="vm.withdraw(submission)"
                >撤回</v-btn
              >
            </template>
          </template>
          <template #no-data>尚无仓库 Submission。</template>
        </v-data-table>
        <div class="pager">
          <span>共 {{ vm.total }} 个仓库</span>
          <v-pagination
            v-if="vm.total > 20"
            :model-value="vm.page"
            :length="Math.ceil(vm.total / 20)"
            @update:model-value="vm.query"
          />
        </div>
        <v-textarea
          v-model="vm.reason"
          label="驳回或反批准原因"
          variant="outlined"
          class="mt-4"
        />
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>当前设备的本地草稿</v-card-title>
      <v-card-text>
        <v-expansion-panels multiple>
          <v-expansion-panel
            v-for="draft in vm.drafts"
            :key="draft.draftId"
            data-testid="dcl-draft"
            :data-draft-id="draft.draftId"
            :data-archive-draft-id="draft.draftId"
            :title="`${draft.mode === 'NEW' ? '新增' : '变更'} · ${draft.snapshot.name || '未命名仓库'}`"
          >
            <v-expansion-panel-text>
              <div class="draft-grid">
                <v-text-field
                  v-model="draft.snapshot.name"
                  label="仓库名称"
                  variant="outlined"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-text-field
                  v-model="draft.snapshot.address"
                  label="地址"
                  variant="outlined"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-text-field
                  v-model="draft.snapshot.contactName"
                  label="联系人"
                  variant="outlined"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-text-field
                  v-model="draft.snapshot.contactPhone"
                  label="联系电话"
                  variant="outlined"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-select
                  :model-value="draft.snapshot.managerEmployeeId || null"
                  :items="managerItems"
                  label="仓库负责人"
                  clearable
                  variant="outlined"
                  @update:model-value="managerChanged(draft, $event)"
                />
                <v-switch
                  v-model="draft.snapshot.enabled"
                  label="启用"
                  color="primary"
                  @update:model-value="vm.scheduleSave(draft)"
                />
                <v-textarea
                  v-model="draft.snapshot.remark"
                  label="备注"
                  variant="outlined"
                  class="span-2"
                  @update:model-value="vm.scheduleSave(draft)"
                />
              </div>
              <div class="d-flex justify-end ga-2">
                <v-btn
                  variant="text"
                  color="error"
                  @click="vm.deleteDraft(draft)"
                >
                  删除本地草稿
                </v-btn>
                <v-btn
                  color="primary"
                  :loading="vm.saving"
                  @click="vm.submitDraft(draft)"
                >
                  提交
                </v-btn>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <v-empty-state
          v-if="vm.drafts.length === 0"
          title="当前设备没有仓库草稿"
        />
      </v-card-text>
    </v-card>

    <v-dialog
      :model-value="vm.history !== null"
      max-width="900"
      @update:model-value="!$event && (vm.history = null)"
    >
      <v-card
        title="仓库版本历史"
        data-testid="dcl-detail"
        :data-submission-id="vm.history?.detail.submissionId"
      >
        <v-card-text>
          <v-data-table
            :headers="[
              { title: '版本', key: 'versionNo' },
              { title: '状态', key: 'status' },
              { title: '名称', key: 'snapshot.name' },
              { title: 'revision', key: 'revision' },
            ]"
            :items="vm.history?.versions ?? []"
            hide-default-footer
          >
            <template #item.versionNo="{ item }"
              >V{{ item.versionNo }}</template
            >
            <template #item.status="{ item }">
              {{ statusLabel(item.status) }}
            </template>
          </v-data-table>
        </v-card-text>
        <v-card-actions
          ><v-spacer /><v-btn @click="vm.history = null"
            >关闭</v-btn
          ></v-card-actions
        >
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.page-shell {
  padding: 24px;
}
.filters {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 180px 160px auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
}
.draft-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.span-2 {
  grid-column: 1 / -1;
}
@media (max-width: 900px) {
  .filters,
  .draft-grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: auto;
  }
}
</style>
