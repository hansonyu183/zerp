<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { formatLocalDateTime } from '@/utils/date'
import type { SupplierListItem, SupplierVersion } from './types'
import type { SupplierLifecycleAction, SupplierViewModel } from './vm'

const props = defineProps<{ model: SupplierViewModel }>()
const vm = reactive(props.model)
const lifecycleTarget = ref<SupplierListItem | null>(null)
const lifecycleAction = ref<SupplierLifecycleAction | null>(null)
const lifecycleReason = ref('')
const versionsLength = computed(() =>
  Math.max(1, Math.ceil(vm.versionsTotal / vm.versionsPageSize)),
)
const auditLength = computed(() =>
  Math.max(1, Math.ceil(vm.auditTotal / vm.auditPageSize)),
)

const statusItems = [
  { value: 'DRAFT', title: '草稿' },
  { value: 'PENDING', title: '待审核' },
  { value: 'EFFECTIVE', title: '有效' },
  { value: 'INVALID', title: '已失效' },
] as const
const statusLabel = (value: string) =>
  statusItems.find((item) => item.value === value)?.title ?? value
const eventLabels: Readonly<Record<string, string>> = {
  CREATED: '创建',
  SAVED: '保存',
  SUBMITTED: '提交审核',
  UNSUBMITTED: '撤回提交',
  APPROVED: '审核通过',
  REJECTED: '审核驳回',
  ENABLED: '启用',
  DISABLED: '禁用',
  DELETED: '删除候选版本',
  REFERENCES_TRANSFERRED: '引用转移',
}
const eventLabel = (value: string) => eventLabels[value] ?? '其他变更'
const purchaserLabel = (version: SupplierListItem['effective']) =>
  version?.defaultPurchaserName
    ? `${version.defaultPurchaserCode ?? ''} · ${version.defaultPurchaserName}`
    : '—'

const columns: readonly BusinessObjectColumn<SupplierListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  { key: 'name', label: '名称', value: (row) => row.name, sizing: 'fluid' },
  {
    key: 'defaultPurchaser',
    label: '默认采购员',
    value: (row) => purchaserLabel(row.effective ?? row.candidate),
  },
  {
    key: 'status',
    label: '状态',
    value: (row) => statusLabel(row.status),
    sizing: 'compact',
  },
  {
    key: 'candidate',
    label: '候选版本',
    value: (row) => (row.hasCandidate ? '有' : '—'),
    sizing: 'compact',
  },
]

function rowActions(row: SupplierListItem): ListRowAction[] {
  const lifecycle: Array<{
    action: SupplierLifecycleAction
    label: string
    icon: string
    color?: string
  }> = [
    {
      action: 'submit',
      label: '提交审核',
      icon: 'mdi-send-outline',
      color: 'primary',
    },
    {
      action: 'unsubmit',
      label: '撤回提交',
      icon: 'mdi-undo-variant',
      color: 'warning',
    },
    {
      action: 'approve',
      label: '审核通过',
      icon: 'mdi-check-decagram-outline',
      color: 'success',
    },
    {
      action: 'reject',
      label: '审核驳回',
      icon: 'mdi-close-octagon-outline',
      color: 'error',
    },
    {
      action: 'enable',
      label: '启用',
      icon: 'mdi-play-circle-outline',
      color: 'success',
    },
    {
      action: 'disable',
      label: '禁用',
      icon: 'mdi-pause-circle-outline',
      color: 'warning',
    },
    {
      action: 'delete',
      label: '删除候选版本',
      icon: 'mdi-delete-outline',
      color: 'error',
    },
  ]
  return [
    ...(vm.canView
      ? [
          {
            key: 'edit',
            label: vm.canEdit ? '查看 / 编辑' : '查看',
            icon: vm.canEdit ? 'mdi-pencil-outline' : 'mdi-eye-outline',
            color: 'primary',
          },
        ]
      : []),
    ...(vm.canOpenVersions
      ? [{ key: 'versions', label: '版本历史', icon: 'mdi-history' }]
      : []),
    ...(vm.canOpenAudit
      ? [
          {
            key: 'audit',
            label: '审核记录',
            icon: 'mdi-clipboard-text-clock-outline',
          },
        ]
      : []),
    ...lifecycle
      .filter(({ action }) => vm.canLifecycleFor(row, action))
      .map(({ action, ...item }) => ({ key: action, ...item })),
  ]
}

function selectRowAction(action: string, row: SupplierListItem): void {
  if (action === 'edit') {
    if (vm.canEdit) void vm.openEdit(row)
    else void vm.openView(row)
    return
  }
  if (action === 'versions') {
    void vm.openVersions(row)
    return
  }
  if (action === 'audit') {
    void vm.openAudit(row)
    return
  }
  const selected = action as SupplierLifecycleAction
  if (selected === 'submit' || selected === 'enable') {
    void vm.runLifecycle(row, selected)
    return
  }
  lifecycleTarget.value = row
  lifecycleAction.value = selected
  lifecycleReason.value = ''
}

const lifecycleTitle = computed(() =>
  lifecycleAction.value
    ? (
        {
          unsubmit: '撤回提交',
          approve: '审核通过',
          reject: '审核驳回',
          disable: '确认禁用供应商',
          delete: '确认删除候选版本',
          submit: '提交审核',
          enable: '启用供应商',
        } as const
      )[lifecycleAction.value]
    : '',
)
const lifecycleRequiresReason = computed(() =>
  ['unsubmit', 'reject'].includes(lifecycleAction.value ?? ''),
)
function closeLifecycleDialog(): void {
  if (vm.actionLoading) return
  lifecycleTarget.value = null
  lifecycleAction.value = null
  lifecycleReason.value = ''
}
async function confirmLifecycle(): Promise<void> {
  if (
    lifecycleTarget.value &&
    lifecycleAction.value &&
    (await vm.runLifecycle(
      lifecycleTarget.value,
      lifecycleAction.value,
      lifecycleReason.value,
    ))
  )
    closeLifecycleDialog()
}

function referenceTitle(item: { code: string; name: string }): string {
  return `${item.code} · ${item.name}`
}
function partyTitle(item: { displayName: string; legalName: string }): string {
  return item.displayName || item.legalName
}
function versionTitle(label: string, version: SupplierVersion | null): string {
  return version
    ? `${label}（${statusLabel(version.status)}）`
    : `${label}（无）`
}

onMounted(() => {
  void vm.query()
  void vm.loadReferenceOptions('defaultPurchaser')
})
</script>

<template>
  <v-container fluid class="supplier-workspace pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <BusinessObjectList
      :columns="columns"
      :creatable="vm.canCreate"
      :editable="(row) => rowActions(row).length > 0"
      empty-text="暂无供应商"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      search-label="供应商关键字"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-select
          v-model="vm.filters.status"
          chips
          clearable
          density="comfortable"
          label="生命周期状态"
          :items="statusItems"
          multiple
          variant="outlined"
        />
        <v-autocomplete
          v-model="vm.filters.defaultPurchaserEmployeeId"
          clearable
          density="comfortable"
          item-title="name"
          item-value="objectId"
          :items="vm.referenceOptions.defaultPurchaser"
          label="默认采购员"
          variant="outlined"
          @update:search="
            vm.loadReferenceOptions('defaultPurchaser', $event ?? '')
          "
        />
      </template>
      <template #actions="{ row }"
        ><ListRowActions
          :actions="rowActions(row)"
          :label="`操作 ${row.code}`"
          :loading="Boolean(vm.actionLoading)"
          @select="selectRowAction($event, row)"
      /></template>
    </BusinessObjectList>
  </v-container>

  <v-dialog :model-value="Boolean(lifecycleTarget)" max-width="620" persistent>
    <v-card rounded="xl" :title="lifecycleTitle">
      <v-card-text>
        <v-alert
          v-if="lifecycleAction === 'delete'"
          class="mb-4"
          type="warning"
          variant="tonal"
          >删除后无法恢复；已有有效版本时只删除当前候选版本。</v-alert
        >
        <v-alert
          v-else-if="lifecycleAction === 'disable'"
          class="mb-4"
          type="warning"
          variant="tonal"
          >禁用后该供应商不能用于新的业务单据。</v-alert
        >
        <v-textarea
          v-if="
            ['unsubmit', 'approve', 'reject'].includes(lifecycleAction ?? '')
          "
          v-model="lifecycleReason"
          counter="1000"
          :label="lifecycleRequiresReason ? '操作原因' : '审核意见（可选）'"
          :maxlength="1000"
          :required="lifecycleRequiresReason"
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-5"
        ><v-spacer /><v-btn
          :disabled="Boolean(vm.actionLoading)"
          variant="text"
          @click="closeLifecycleDialog"
          >取消</v-btn
        ><v-btn
          :color="
            lifecycleAction === 'delete' || lifecycleAction === 'reject'
              ? 'error'
              : 'primary'
          "
          :disabled="lifecycleRequiresReason && !lifecycleReason.trim()"
          :loading="Boolean(vm.actionLoading)"
          @click="confirmLifecycle"
          >确认</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>

  <v-navigation-drawer
    :model-value="vm.workspaceOpen"
    class="supplier-workspace__drawer"
    location="end"
    temporary
    width="860"
    @update:model-value="
      $event ? (vm.workspaceOpen = true) : vm.closeWorkspace()
    "
  >
    <v-form class="supplier-workspace__form" @submit.prevent="vm.save">
      <header class="supplier-workspace__header">
        <div>
          <div class="text-caption">供应商主数据</div>
          <h2>
            {{
              vm.mode === 'create'
                ? '新增供应商'
                : vm.mode === 'view'
                  ? '查看供应商历史版本'
                  : '查看 / 编辑供应商'
            }}
          </h2>
        </div>
        <div class="d-flex ga-2">
          <v-btn :disabled="vm.saving" variant="text" @click="vm.closeWorkspace"
            >取消</v-btn
          ><v-btn
            v-if="
              vm.mode === 'create'
                ? vm.canCreate
                : vm.mode === 'edit' && vm.canEdit
            "
            color="primary"
            :loading="vm.saving"
            type="submit"
            >保存</v-btn
          >
        </div>
      </header>
      <v-alert
        v-if="vm.historicalVersionId"
        class="mb-4"
        type="info"
        variant="tonal"
      >
        正在查看不可修改的历史版本。
        <template #append>
          <v-btn variant="text" @click="vm.returnToCurrentVersion"
            >返回当前版本</v-btn
          >
        </template>
      </v-alert>
      <v-alert
        v-if="vm.formErrors.length"
        class="mb-4"
        title="请先修正以下内容"
        type="error"
        variant="tonal"
        ><ul class="pl-5">
          <li v-for="message in vm.formErrors" :key="message">{{ message }}</li>
        </ul></v-alert
      >
      <section class="supplier-workspace__section">
        <h3>供应商资料</h3>
        <v-btn-toggle
          v-if="vm.mode === 'create'"
          v-model="vm.form.partyMode"
          class="mb-4"
          color="primary"
          mandatory
        >
          <v-btn v-if="vm.canCreateWithNewParty" value="new">新主体</v-btn>
          <v-btn v-if="vm.canCreateWithExistingParty" value="existing"
            >复用已有主体</v-btn
          >
        </v-btn-toggle>
        <div class="supplier-workspace__grid">
          <v-text-field
            v-if="vm.form.code"
            :model-value="vm.form.code"
            label="供应商编码"
            readonly
            variant="outlined"
          />
          <v-text-field
            v-if="vm.mode !== 'create' || vm.form.partyMode === 'new'"
            v-model="vm.form.name"
            label="主体名称"
            :readonly="vm.mode !== 'create'"
            required
            variant="outlined"
          />
          <v-autocomplete
            v-else
            v-model="vm.form.selectedParty"
            :item-title="partyTitle"
            :items="vm.partyOptions"
            label="已有主体"
            required
            return-object
            variant="outlined"
            @update:search="vm.searchParties($event ?? '')"
          />
          <v-select
            v-if="vm.mode === 'create' && vm.form.partyMode === 'new'"
            v-model="vm.form.partyKind"
            :items="[
              { value: 'ORGANIZATION', title: '企业/机构' },
              { value: 'PERSON', title: '个人' },
            ]"
            label="主体类型"
            variant="outlined"
          />
          <v-text-field
            v-if="vm.mode === 'create' && vm.form.partyMode === 'new'"
            v-model="vm.form.taxNumber"
            label="税号"
            variant="outlined"
          />
          <v-select
            v-if="vm.mode === 'create' && vm.form.partyMode === 'new'"
            v-model="vm.form.identifierType"
            :items="[
              { title: '身份证件号', value: 'PERSON_ID' },
              {
                title: '统一社会信用代码',
                value: 'UNIFIED_SOCIAL_CREDIT_CODE',
              },
            ]"
            label="强标识类型"
            variant="outlined"
          />
          <v-text-field
            v-if="vm.mode === 'create' && vm.form.partyMode === 'new'"
            v-model="vm.form.identifierValue"
            label="强标识值（可选）"
            variant="outlined"
          />
          <v-autocomplete
            v-model="vm.form.operatingEntity"
            :item-title="referenceTitle"
            :items="vm.referenceOptions.operatingEntity"
            label="经营主体"
            :readonly="vm.mode !== 'create'"
            required
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('operatingEntity', $event ?? '')
            "
          />
          <v-text-field
            v-model="vm.form.contactName"
            label="联系人"
            :readonly="vm.mode === 'view'"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.contactPhone"
            label="电话"
            :readonly="vm.mode === 'view'"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.email"
            label="邮箱"
            :readonly="vm.mode === 'view'"
            variant="outlined"
          />
          <v-autocomplete
            v-model="vm.form.settlementMethod"
            :item-title="referenceTitle"
            :items="vm.referenceOptions.settlementMethod"
            label="结算方式"
            :readonly="vm.mode === 'view'"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('settlementMethod', $event ?? '')
            "
          />
          <v-autocomplete
            v-model="vm.form.defaultPurchaser"
            :item-title="referenceTitle"
            :items="vm.referenceOptions.defaultPurchaser"
            label="默认采购员"
            :readonly="vm.mode === 'view'"
            return-object
            variant="outlined"
            @update:search="
              vm.loadReferenceOptions('defaultPurchaser', $event ?? '')
            "
          />
          <v-textarea
            v-model="vm.form.address"
            class="supplier-workspace__wide"
            label="地址"
            :readonly="vm.mode === 'view'"
            variant="outlined"
          />
          <v-textarea
            v-model="vm.form.remark"
            class="supplier-workspace__wide"
            label="备注"
            :readonly="vm.mode === 'view'"
            variant="outlined"
          />
        </div>
      </section>
      <section v-if="vm.detail" class="supplier-workspace__section">
        <h3>版本资料</h3>
        <div class="supplier-workspace__versions">
          <v-card
            v-for="(version, label) in {
              有效版本: vm.detail.effective,
              候选版本: vm.detail.candidate,
            }"
            :key="label"
            variant="outlined"
            ><v-card-title>{{ versionTitle(label, version) }}</v-card-title
            ><v-card-text v-if="version"
              ><dl class="supplier-workspace__detail">
                <template
                  v-for="(value, key) in {
                    主体: vm.detail.partyDisplayName,
                    经营主体: vm.detail.operatingEntityName,
                    联系人: version.data.contactName || '—',
                    电话: version.data.contactPhone || '—',
                    邮箱: version.data.email || '—',
                    地址: version.data.address || '—',
                    备注: version.data.remark || '—',
                    结算方式: version.data.settlementMethod
                      ? referenceTitle(version.data.settlementMethod)
                      : '—',
                    默认采购员: version.defaultPurchaserName
                      ? `${version.defaultPurchaserCode ?? ''} · ${version.defaultPurchaserName}`
                      : '—',
                  }"
                  :key="key"
                  ><dt>{{ key }}</dt>
                  <dd>{{ value }}</dd></template
                >
              </dl></v-card-text
            ></v-card
          >
        </div>
      </section>
    </v-form>
  </v-navigation-drawer>

  <v-dialog v-model="vm.versionsOpen" max-width="980">
    <v-card rounded="xl" title="版本历史">
      <v-progress-linear
        :active="vm.versionsLoading"
        color="primary"
        indeterminate
      />
      <v-card-text>
        <v-table class="responsive-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>名称</th>
              <th>更新</th>
              <th>意见</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in vm.versions" :key="item.versionId">
              <td data-label="版本">V{{ item.version }}</td>
              <td data-label="状态">{{ statusLabel(item.status) }}</td>
              <td data-label="名称">{{ item.summary.name }}</td>
              <td data-label="更新">
                {{ formatLocalDateTime(item.updatedAt) }}
              </td>
              <td data-label="意见">{{ item.reviewComment || '—' }}</td>
              <td class="text-end responsive-table__actions" data-label="操作">
                <v-btn
                  v-if="vm.canView"
                  density="comfortable"
                  variant="text"
                  @click="vm.openHistoricalVersion(item)"
                >
                  查看
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="vm.versionsTotal > vm.versionsPageSize"
          :length="versionsLength"
          :model-value="vm.versionsPage"
          @update:model-value="vm.changeVersionsPage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.versionsOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.auditOpen" max-width="1080">
    <v-card rounded="xl" title="审核记录">
      <v-progress-linear
        :active="vm.auditLoading"
        color="primary"
        indeterminate
      />
      <v-card-text>
        <v-table class="responsive-table">
          <thead>
            <tr>
              <th>事件</th>
              <th>状态变化</th>
              <th>操作人</th>
              <th>时间</th>
              <th>意见</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in vm.auditEvents" :key="event.id">
              <td data-label="事件">{{ eventLabel(event.eventType) }}</td>
              <td data-label="状态变化">
                {{ event.fromStatus ? statusLabel(event.fromStatus) : '—' }}
                → {{ statusLabel(event.toStatus) }}
              </td>
              <td data-label="操作人">{{ event.actorId }}</td>
              <td data-label="时间">
                {{ formatLocalDateTime(event.occurredAt) }}
              </td>
              <td data-label="意见">{{ event.comment || '—' }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="vm.auditTotal > vm.auditPageSize"
          :length="auditLength"
          :model-value="vm.auditPage"
          @update:model-value="vm.changeAuditPage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.auditOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.supplier-workspace__drawer {
  max-width: 100vw;
}
.supplier-workspace__form {
  min-height: 100%;
  padding: 24px;
}
.supplier-workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.supplier-workspace__header h2 {
  margin: 0;
  font-size: 1.35rem;
}
.supplier-workspace__section + .supplier-workspace__section {
  margin-top: 28px;
}
.supplier-workspace__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.supplier-workspace__wide {
  grid-column: 1 / -1;
}
.supplier-workspace__versions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.supplier-workspace__detail {
  display: grid;
  grid-template-columns: 6em 1fr;
  gap: 8px 12px;
  margin: 0;
}
.supplier-workspace__detail dt {
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.supplier-workspace__detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  .supplier-workspace__form {
    padding: 16px;
  }
  .supplier-workspace__grid,
  .supplier-workspace__versions {
    grid-template-columns: 1fr;
  }
  .supplier-workspace__header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
