<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  approvalActionPresentation,
  approvalStatusPresentation,
  type ApprovalAction,
  type ApprovalStatus,
} from '@zerp/model'

import { useDclRptDefinitionViewModel } from './vm.ts'

const vm = reactive(useDclRptDefinitionViewModel())
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

function actionLabel(action: ApprovalAction): string {
  return approvalActionPresentation[action].label
}

function statusLabel(status: ApprovalStatus): string {
  return approvalStatusPresentation[status].label
}
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="dcl-rpt-definition-page">
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-alert v-if="vm.message" type="success" variant="tonal" class="mb-4">{{
      vm.message
    }}</v-alert>
    <div class="d-flex align-center mb-5">
      <div>
        <h1 class="text-h5">报表定义申报</h1>
        <div class="text-body-2 text-medium-emphasis">
          维护 SQL、强类型参数与展示列；RPT 只执行当前有效正式版本。
        </div>
      </div>
      <v-spacer /><v-btn
        v-if="vm.canCreate"
        color="primary"
        @click="vm.newDraft"
        >新建本地草稿</v-btn
      >
    </div>

    <v-expansion-panels v-if="vm.drafts.length" class="mb-6">
      <v-expansion-panel v-for="draft in vm.drafts" :key="draft.draftId">
        <v-expansion-panel-title
          data-testid="dcl-draft"
          :data-draft-id="draft.draftId"
          :data-archive-draft-id="draft.draftId"
          >本地草稿 · {{ draft.snapshot.name }}</v-expansion-panel-title
        >
        <v-expansion-panel-text>
          <v-row
            ><v-col cols="12" md="8"
              ><v-text-field
                v-model="draft.snapshot.name"
                label="报表名称"
                variant="outlined" /></v-col
            ><v-col cols="12" md="4"
              ><v-switch
                v-model="draft.snapshot.enabled"
                label="批准后允许执行"
                color="primary" /></v-col
            ><v-col cols="12"
              ><v-textarea
                v-model="draft.snapshot.description"
                label="说明"
                rows="2"
                variant="outlined" /></v-col
            ><v-col cols="12"
              ><v-textarea
                v-model="draft.snapshot.sql"
                label="查询 SQL"
                rows="10"
                variant="outlined"
                class="font-monospace" /></v-col
          ></v-row>
          <div class="d-flex align-center my-3">
            <h2 class="text-subtitle-1">查询参数</h2>
            <v-spacer /><v-btn
              size="small"
              variant="outlined"
              @click="vm.addParameter(draft)"
              >新增参数</v-btn
            >
          </div>
          <v-table density="compact"
            ><thead>
              <tr>
                <th>参数键</th>
                <th>名称</th>
                <th>类型</th>
                <th>必填</th>
                <th>枚举值 / 引用类型</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(parameter, index) in draft.snapshot.parameters"
                :key="index"
              >
                <td>
                  <v-text-field
                    v-model="parameter.key"
                    hide-details
                    density="compact"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model="parameter.name"
                    hide-details
                    density="compact"
                  />
                </td>
                <td>
                  <v-select
                    v-model="parameter.type"
                    :items="[
                      'TEXT',
                      'INTEGER',
                      'DECIMAL',
                      'BOOLEAN',
                      'DATE',
                      'DATE_RANGE',
                      'ENUM',
                      'REFERENCE',
                    ]"
                    hide-details
                    density="compact"
                  />
                </td>
                <td>
                  <v-checkbox v-model="parameter.required" hide-details />
                </td>
                <td>
                  <v-combobox
                    v-if="parameter.type === 'ENUM'"
                    v-model="parameter.enumValues"
                    label="枚举值"
                    multiple
                    chips
                    hide-details
                    density="compact"
                  />
                  <v-select
                    v-else-if="parameter.type === 'REFERENCE'"
                    v-model="parameter.referenceType"
                    :items="[
                      'ACCOUNTING_BOOK',
                      'ACCOUNT_SUBJECT',
                      'CUSTOMER_SUBUNIT',
                      'SUPPLIER',
                      'OTHER_UNIT',
                      'EMPLOYEE',
                      'SALES_PARTNER',
                      'DEPARTMENT',
                      'PRODUCT',
                      'WAREHOUSE',
                      'FUND_ACCOUNT',
                      'ASSET',
                      'BILL',
                      'COUNTERPARTY',
                    ]"
                    hide-details
                    density="compact"
                  />
                </td>
              </tr></tbody
          ></v-table>
          <div class="d-flex align-center my-3">
            <h2 class="text-subtitle-1">结果列</h2>
            <v-spacer /><v-btn
              size="small"
              variant="outlined"
              @click="vm.addColumn(draft)"
              >新增列</v-btn
            >
          </div>
          <v-table density="compact"
            ><thead>
              <tr>
                <th>别名</th>
                <th>标题</th>
                <th>类型</th>
                <th>顺序</th>
                <th>宽度</th>
                <th>显示</th>
                <th>格式</th>
                <th>下钻</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(column, index) in draft.snapshot.columns"
                :key="index"
              >
                <td>
                  <v-text-field
                    v-model="column.alias"
                    hide-details
                    density="compact"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model="column.name"
                    hide-details
                    density="compact"
                  />
                </td>
                <td>
                  <v-select
                    v-model="column.type"
                    :items="[
                      'TEXT',
                      'INTEGER',
                      'DECIMAL',
                      'BOOLEAN',
                      'DATE',
                      'DATETIME',
                      'ID',
                    ]"
                    hide-details
                    density="compact"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model.number="column.order"
                    type="number"
                    hide-details
                    density="compact"
                  />
                </td>
                <td>
                  <v-text-field
                    v-model.number="column.width"
                    type="number"
                    hide-details
                    density="compact"
                  />
                </td>
                <td><v-checkbox v-model="column.visible" hide-details /></td>
                <td>
                  <v-text-field
                    v-model="column.format"
                    hide-details
                    density="compact"
                    clearable
                  />
                </td>
                <td>
                  <v-select
                    v-model="column.drilldownEntity"
                    :items="['VOU']"
                    hide-details
                    density="compact"
                    clearable
                  />
                </td>
              </tr></tbody
          ></v-table>
          <v-alert
            v-if="vm.validationError(draft)"
            type="warning"
            variant="tonal"
            density="compact"
            class="my-4"
            >{{ vm.validationError(draft) }}</v-alert
          >
          <div class="d-flex justify-end ga-2">
            <v-btn variant="outlined" @click="vm.saveDraft(draft)"
              >保存到本机</v-btn
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
          label="驳回或反批准原因" /></v-card-text
      ><v-data-table-server
        :headers="[
          { title: '编码', key: 'code' },
          { title: '版本', key: 'versionNo' },
          { title: '状态', key: 'status' },
          { title: '技术有效性', key: 'validity.status' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.submissions"
        :items-length="vm.total"
        :items-per-page="20"
        :page="vm.page"
        :loading="vm.loading"
        @update:page="vm.query"
        ><template #item.status="{ item }">{{
          statusLabel(item.status)
        }}</template
        ><template #item.validity.status="{ item }">{{
          item.validity?.status === 'VALID'
            ? '有效'
            : item.validity?.status === 'INVALID'
              ? '无效'
              : '待校验'
        }}</template
        ><template #item.actions="{ item }"
          ><span
            data-testid="dcl-submission"
            :data-submission-id="item.submissionId"
            :data-archive-submission-id="item.submissionId"
            :data-archive-status="item.status"
            ><v-btn
              size="small"
              variant="text"
              @click="vm.openDetail(item.subjectId)"
              >查看详情</v-btn
            ><v-btn
              v-if="item.status === 'APPROVED'"
              size="small"
              variant="text"
              @click="vm.createChange(item)"
              >创建变更</v-btn
            ><v-btn
              v-for="action in item.availableApprovalActions"
              v-show="vm.canReview(item, action)"
              :key="action"
              size="small"
              variant="text"
              @click="vm.review(item, action)"
              >{{ actionLabel(action) }}</v-btn
            ><v-btn
              v-if="item.canDelete"
              size="small"
              variant="text"
              color="error"
              @click="vm.removeSubmission(item)"
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
        :data-submission-id="vm.detail.submission.submissionId"
      >
        <v-card-title>报表定义详情</v-card-title>
        <v-card-text
          >编码：{{ vm.detail.submission.code ?? '—' }} · 共
          {{ vm.detail.versions.length }} 个版本</v-card-text
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
