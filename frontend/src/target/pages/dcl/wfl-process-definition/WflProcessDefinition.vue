<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  approvalActionPresentation,
  approvalStatusPresentation,
  vouEntities,
  vouEntityPresentation,
  type ApprovalAction,
  type ApprovalStatus,
} from '@zerp/model'

import { useDclWflProcessDefinitionViewModel } from './vm.ts'

const vm = reactive(useDclWflProcessDefinitionViewModel())
const route = useRoute()

function deepLink() {
  return {
    objectId:
      typeof route.query.objectId === 'string'
        ? route.query.objectId
        : undefined,
    submissionId:
      typeof route.query.submissionId === 'string'
        ? route.query.submissionId
        : undefined,
    revision:
      typeof route.query.revision === 'string'
        ? route.query.revision
        : undefined,
    mode: typeof route.query.mode === 'string' ? route.query.mode : undefined,
  }
}

let initialized = false
onMounted(async () => {
  await Promise.all([vm.loadDrafts(), vm.query(1)])
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

const vouEntityOptions = vouEntities.map((value) => ({
  value,
  title: vouEntityPresentation[value].label,
}))

function statusLabel(status: ApprovalStatus): string {
  return approvalStatusPresentation[status].label
}

const trialDocumentOptions = computed(() =>
  vm.trialDocuments.map((item) => ({
    value: item.documentId,
    title: `${item.documentNo} · ${statusLabel(item.status)}`,
  })),
)

function actionLabel(action: ApprovalAction): string {
  return approvalActionPresentation[action].label
}
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="dcl-wfl-definition-page">
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-alert v-if="vm.message" type="success" variant="tonal" class="mb-4">{{
      vm.message
    }}</v-alert>
    <div class="d-flex flex-wrap align-center ga-3 mb-5">
      <div>
        <h1 class="text-h5">流程定义申报</h1>
        <div class="text-body-2 text-medium-emphasis">
          编辑 Starlark、使用真实 VOU 单据试算，再提交 DCL 候选。
        </div>
      </div>
      <v-spacer /><v-text-field
        v-model="vm.keyword"
        label="流程编码"
        density="compact"
        variant="outlined"
        hide-details
        class="search-field"
        @keyup.enter="vm.query(1)"
      /><v-btn variant="outlined" @click="vm.query(1)">查询</v-btn
      ><v-btn v-if="vm.canCreate" color="primary" @click="vm.newDraft"
        >新建本地草稿</v-btn
      >
    </div>

    <v-expansion-panels v-if="vm.drafts.length" class="mb-6">
      <v-expansion-panel
        v-for="draft in vm.drafts"
        :key="draft.draftId"
        data-testid="wfl-local-draft"
        :data-wfl-submission-id="draft.submissionId"
      >
        <v-expansion-panel-title
          data-testid="dcl-draft"
          :data-draft-id="draft.draftId"
          :data-archive-draft-id="draft.draftId"
          >本地草稿 ·
          {{
            draft.mode === 'NEW' ? '新流程' : '变更流程'
          }}</v-expansion-panel-title
        >
        <v-expansion-panel-text>
          <v-textarea
            v-model="draft.script"
            data-testid="wfl-trial-script"
            label="Starlark 流程脚本"
            rows="18"
            variant="outlined"
            class="font-monospace"
          />
          <v-row
            ><v-col cols="12" md="5"
              ><v-select
                v-model="draft.trialDocument.entity"
                data-testid="wfl-trial-document-entity"
                label="试算单据类型"
                :items="vouEntityOptions"
                variant="outlined"
                @update:model-value="vm.loadTrialDocuments(draft)" /></v-col
            ><v-col cols="12" md="7"
              ><v-select
                v-model="draft.trialDocument.documentId"
                data-testid="wfl-trial-document"
                label="试算单据"
                :items="trialDocumentOptions"
                variant="outlined" /></v-col
          ></v-row>
          <v-alert
            v-if="vm.validationError(draft)"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
            >{{ vm.validationError(draft) }}</v-alert
          >
          <v-card v-if="vm.trialGraph" variant="outlined" class="mb-4"
            ><v-card-title>{{ vm.trialGraph.name }}</v-card-title
            ><v-card-text
              >{{ vm.trialGraph.nodes.length }} 个节点，{{
                vm.trialGraph.edges.length
              }}
              条连接，根节点 {{ vm.trialGraph.rootKey }}</v-card-text
            ></v-card
          >
          <div class="d-flex justify-end ga-2">
            <v-btn variant="outlined" @click="vm.saveDraft(draft)"
              >保存到本机</v-btn
            ><v-btn
              v-if="vm.canTrial"
              variant="outlined"
              @click="vm.trialDraft(draft)"
              >试算</v-btn
            ><v-btn
              color="primary"
              :loading="vm.saving"
              @click="vm.submitDraft(draft)"
              >提交候选</v-btn
            >
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-card title="服务器候选与正式版本"
      ><v-card-text
        ><v-text-field
          v-model="vm.reason"
          data-testid="dcl-wfl-review-reason"
          label="驳回或反批准原因" /></v-card-text
      ><v-data-table-server
        :headers="[
          { title: '编码', key: 'code' },
          { title: '正式版本', key: 'latestApproved.versionNo' },
          { title: '当前状态', key: 'openCandidate.status' },
          { title: '运行状态', key: 'latestApproved.enabled' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.items"
        :items-length="vm.total"
        :items-per-page="20"
        :page="vm.page"
        :loading="vm.loading"
        @update:page="vm.query"
        ><template #item.openCandidate.status="{ item }">
          {{
            vm.active(item)
              ? statusLabel(vm.active(item)!.status)
              : '无提交版本'
          }}
        </template>
        <template #item.latestApproved.enabled="{ item }">
          {{
            item.latestApproved
              ? item.latestApproved.enabled
                ? '启用'
                : '停用'
              : '未批准'
          }}
        </template>
        <template #item.actions="{ item }"
          ><span
            data-testid="dcl-wfl-submission"
            :data-submission-id="vm.active(item)?.submissionId"
            :data-archive-submission-id="vm.active(item)?.submissionId"
            :data-wfl-submission-id="vm.active(item)?.submissionId"
            ><v-btn
              size="small"
              variant="text"
              @click="vm.openDetail(item.subjectId)"
              >查看详情</v-btn
            ><v-btn
              v-if="item.latestApproved && vm.canCreateChange"
              size="small"
              variant="text"
              @click="vm.createChange(item)"
              >创建变更</v-btn
            ><v-btn
              v-for="action in vm.active(item)?.availableApprovalActions || []"
              v-show="vm.canReview(item, action)"
              :key="action"
              size="small"
              variant="text"
              @click="vm.review(item, action)"
              >{{ actionLabel(action) }}</v-btn
            ><v-btn
              v-if="
                item.latestApproved &&
                vm.canSetEnabled(
                  item.latestApproved,
                  !item.latestApproved.enabled,
                )
              "
              size="small"
              variant="text"
              @click="
                vm.setEnabled(item.latestApproved, !item.latestApproved.enabled)
              "
              >{{ item.latestApproved.enabled ? '停用' : '启用' }}</v-btn
            ><v-btn
              v-if="item.openCandidate?.canDelete"
              size="small"
              variant="text"
              color="error"
              @click="vm.removeSubmission(item.openCandidate)"
              >删除候选</v-btn
            ></span
          ></template
        ></v-data-table-server
      ></v-card
    >
    <v-dialog
      :model-value="vm.detail !== null"
      max-width="900"
      @update:model-value="!$event && (vm.detail = null)"
    >
      <v-card
        v-if="vm.detail"
        data-testid="dcl-detail"
        :data-submission-id="vm.detail.submissionId"
      >
        <v-card-title>流程定义详情</v-card-title>
        <v-card-text
          >{{ vm.detail.code }} ·
          {{ statusLabel(vm.detail.status) }}</v-card-text
        >
        <v-card-actions
          ><v-spacer /><v-btn @click="vm.detail = null"
            >关闭</v-btn
          ></v-card-actions
        >
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.search-field {
  max-width: 20rem;
}
</style>
