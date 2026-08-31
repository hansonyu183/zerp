<script setup lang="ts">
import { useRoute } from 'vue-router'
import { BusinessObjectList } from '@/components/business-object'
import type { BusinessObjectColumn } from '@/components/business-object'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import {
  approvalEventActionLabels,
  approvalStatusPresentation,
} from '@/shared/approval'
import type { ApprovalStatus } from '@/api/generated'
import type { RptDefinitionListItem } from './api'
import {
  activeRptDefinitionVersion,
  rptDefinitionValidityPresentation,
} from './presentation'
import { createDclRptDefinitionViewModel } from './vm'

const vm = createDclRptDefinitionViewModel()
const route = useRoute()
const statusOptions = (
  Object.entries(approvalStatusPresentation) as [
    ApprovalStatus,
    { label: string },
  ][]
).map(([value, item]) => ({ title: item.label, value }))
const columns: readonly BusinessObjectColumn<RptDefinitionListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  { key: 'name', label: '名称', value: (row) => row.name, sizing: 'fluid' },
  {
    key: 'status',
    label: '审批状态',
    value: (row) => activeRptDefinitionVersion(row)?.approval.status,
    format: (value) =>
      value ? approvalStatusPresentation[value as ApprovalStatus].label : '—',
    sizing: 'compact',
  },
  {
    key: 'validity',
    label: '技术有效性',
    value: (row) => activeRptDefinitionVersion(row)?.validity,
    format: (value) =>
      value
        ? rptDefinitionValidityPresentation[
            value as keyof typeof rptDefinitionValidityPresentation
          ].label
        : '—',
    sizing: 'compact',
  },
  {
    key: 'enabled',
    label: '启停',
    value: (row) =>
      activeRptDefinitionVersion(row)?.enabled ? '启用' : '停用',
    sizing: 'compact',
  },
]

function rowActions(row: RptDefinitionListItem): ListRowAction[] {
  return vm.permissions.get
    ? [{ key: 'open', label: `打开 ${row.code}`, icon: 'mdi-open-in-new' }]
    : []
}

void vm.query().then(() => {
  const { code, approvalEntryId } = route.query
  if (typeof code === 'string')
    void vm.openByTarget(
      code,
      typeof approvalEntryId === 'string' ? approvalEntryId : undefined,
    )
})
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <div class="d-flex align-center flex-wrap ga-3 mb-5">
      <div>
        <h1 class="text-h5">报表定义变更</h1>
        <div class="text-body-2 text-medium-emphasis">
          DCL 统一维护候选版本与审批；RPT 仅执行当前有效正式版本。
        </div>
      </div>
    </div>

    <v-alert v-if="vm.errorMessage" type="error" closable class="mb-4">
      {{ vm.errorMessage }}
    </v-alert>
    <v-alert v-if="vm.successMessage" type="success" closable class="mb-4">
      {{ vm.successMessage }}
    </v-alert>

    <BusinessObjectList
      :columns="columns"
      :creatable="vm.permissions.create"
      :editable="vm.permissions.get"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.definitionId"
      :rows="vm.rows"
      search-label="编码或名称"
      :total="vm.total"
      @apply-filters="vm.query"
      @create="vm.openCreate"
      @query="vm.query"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-select
          v-model="vm.status"
          :items="statusOptions"
          label="审批状态"
          multiple
          clearable
          density="comfortable"
          variant="outlined"
        />
        <v-checkbox
          v-model="vm.includeDisabled"
          label="包含停用"
          hide-details
        />
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="rowActions(row)"
          :label="`操作 ${row.code}`"
          :loading="vm.loading"
          @select="vm.openDefinition(row)"
        />
      </template>
    </BusinessObjectList>

    <v-dialog v-model="vm.editorOpen" max-width="980">
      <v-card>
        <v-card-title>{{
          vm.selected ? '报表定义版本' : '新建报表定义'
        }}</v-card-title>
        <v-card-text>
          <div class="d-flex ga-3 flex-wrap">
            <v-text-field
              v-if="vm.selected"
              :model-value="vm.selected.code"
              label="报表编码"
              readonly
            />
            <v-text-field v-model="vm.form.name" label="名称" />
          </div>
          <v-checkbox
            v-model="vm.form.enabled"
            :disabled="
              Boolean(vm.selected && vm.selected.approval.status !== 'DRAFT') ||
              !vm.canSetFormEnabled(!vm.form.enabled)
            "
            label="本候选版本启用"
            hide-details
          />
          <v-textarea v-model="vm.form.description" label="说明" rows="2" />
          <v-textarea
            v-model="vm.form.dataText"
            label="类型化定义 JSON"
            auto-grow
            rows="12"
          />
          <v-textarea
            v-model="vm.form.validationParametersText"
            label="提交/批准校验参数 JSON"
            rows="3"
          />
          <v-text-field v-model="vm.reason" label="驳回/反批原因" />
          <div v-if="vm.selected" class="text-caption text-medium-emphasis">
            Approval Entry ID：{{ vm.selected.approval.approvalEntryId }} · 版本
            {{ vm.selected.approval.versionNo }} ·
            {{ approvalStatusPresentation[vm.selected.approval.status].label }}
          </div>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn @click="vm.editorOpen = false">关闭</v-btn>
          <v-btn
            v-if="vm.canPersistForm"
            color="primary"
            :loading="vm.saving"
            @click="vm.save"
            >保存</v-btn
          >
          <template v-if="vm.selected">
            <v-btn
              v-if="
                vm.selected.approval.status === 'DRAFT' && vm.permissions.submit
              "
              @click="vm.run('submit')"
              >提交</v-btn
            >
            <v-btn
              v-if="
                vm.selected.approval.status === 'DRAFT' &&
                vm.permissions['delete-version']
              "
              color="error"
              @click="vm.run('delete-version')"
              >删除草稿</v-btn
            >
            <v-btn
              v-if="
                vm.selected.approval.status === 'PENDING' &&
                vm.permissions.unsubmit
              "
              @click="vm.run('unsubmit')"
              >撤回</v-btn
            >
            <v-btn
              v-if="
                vm.selected.approval.status === 'PENDING' &&
                vm.permissions.reject
              "
              color="error"
              @click="vm.run('reject')"
              >驳回</v-btn
            >
            <v-btn
              v-if="
                vm.selected.approval.status === 'PENDING' &&
                vm.permissions.approve
              "
              @click="vm.run('approve')"
              >批准</v-btn
            >
            <v-btn
              v-if="
                vm.selected.approval.status === 'APPROVED' &&
                vm.permissions['create-next']
              "
              @click="vm.run('create-next')"
              >创建下一版本</v-btn
            >
            <v-btn
              v-if="
                vm.selected.approval.status === 'APPROVED' &&
                vm.permissions.unapprove
              "
              @click="vm.run('unapprove')"
              >反批</v-btn
            >
            <v-btn
              v-if="
                vm.selected.approval.status === 'DRAFT' &&
                !vm.selected.enabled &&
                vm.canChangeEnabled(true)
              "
              @click="vm.changeEnabled(true)"
              >启用草稿</v-btn
            >
            <v-btn
              v-if="
                vm.selected.approval.status === 'DRAFT' &&
                vm.selected.enabled &&
                vm.canChangeEnabled(false)
              "
              @click="vm.changeEnabled(false)"
              >停用草稿</v-btn
            >
            <span
              v-if="vm.selected.approval.status === 'APPROVED'"
              class="text-caption text-medium-emphasis"
              >启停请先创建下一版本。</span
            >
            <v-btn v-if="vm.permissions.versions" @click="vm.loadVersions"
              >版本历史</v-btn
            >
            <v-btn v-if="vm.permissions['audit-history']" @click="vm.loadAudit"
              >审核记录</v-btn
            >
          </template>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="vm.versionsOpen" max-width="850">
      <v-card
        ><v-card-title>版本历史</v-card-title
        ><v-card-text>
          <v-table
            ><thead>
              <tr>
                <th>版本</th>
                <th>状态</th>
                <th>启停</th>
                <th>有效性</th>
                <th>名称</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="version in vm.versions"
                :key="version.approval.approvalEntryId"
              >
                <td>{{ version.approval.versionNo }}</td>
                <td>
                  {{
                    approvalStatusPresentation[version.approval.status].label
                  }}
                </td>
                <td>{{ version.enabled ? '启用' : '停用' }}</td>
                <td>
                  {{
                    rptDefinitionValidityPresentation[version.validity].label
                  }}
                </td>
                <td>{{ version.name }}</td>
              </tr>
            </tbody></v-table
          >
        </v-card-text></v-card
      >
    </v-dialog>
    <v-dialog v-model="vm.auditOpen" max-width="900">
      <v-card
        ><v-card-title>审核记录</v-card-title
        ><v-card-text>
          <v-table
            ><thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>Entry ID</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in vm.auditEvents" :key="event.id">
                <td>{{ event.createdAt }}</td>
                <td>{{ approvalEventActionLabels[event.action] }}</td>
                <td>{{ event.approvalEntryId }}</td>
                <td>{{ event.reason ?? '—' }}</td>
              </tr>
            </tbody></v-table
          >
        </v-card-text></v-card
      >
    </v-dialog>
  </v-container>
</template>
