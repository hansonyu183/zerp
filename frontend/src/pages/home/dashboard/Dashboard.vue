<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import {
  VoucherList,
  type VoucherLifecycleLabels,
  type VoucherSort,
} from '@/components/voucher'
import { pageRegistry } from '@/router/registry'
import {
  type WorkbenchAction,
  type WorkbenchDocumentItem,
  type WorkbenchItem,
  type WorkbenchObjectItem,
  useDashboardViewModel,
} from './vm'

const vm = reactive(useDashboardViewModel())
const router = useRouter()
const rejectTarget = ref<WorkbenchObjectItem | null>(null)
const rejectComment = ref('')

const objectColumns: readonly BusinessObjectColumn<WorkbenchObjectItem>[] = [
  { key: 'entity', label: '类型', value: entityTitle, sizing: 'compact' },
  {
    key: 'code',
    label: '编码',
    value: (row) => row.code,
    sizing: 'compact',
  },
  {
    key: 'name',
    label: '名称',
    value: (row) => row.name,
    sizing: 'fluid',
  },
  { key: 'status', label: '状态', value: pendingStatus, sizing: 'compact' },
]

const objectRows = computed(() =>
  vm.states.BOB.rows.filter(
    (row): row is WorkbenchObjectItem => row.category === 'BOB',
  ),
)
const documentRows = computed(() =>
  vm.states.VOU.rows.filter(
    (row): row is WorkbenchDocumentItem => row.category === 'VOU',
  ),
)
const documentSort: VoucherSort = { field: 'updatedAt', order: 'desc' }
const documentLifecycleLabels: VoucherLifecycleLabels = {
  check: '核对',
  uncheck: '反核对',
  approve: '批准',
  unapprove: '反批准',
  finalize: '完成',
  unfinalize: '撤销完成',
  checked: '已核对',
  finalized: '已完成',
}

const actionDefinitions: Record<WorkbenchAction, Omit<ListRowAction, 'key'>> = {
  view: { label: '查看', icon: 'mdi-eye-outline' },
  edit: { label: '编辑', icon: 'mdi-pencil-outline', color: 'primary' },
  submit: { label: '提交审核', icon: 'mdi-send-outline', color: 'primary' },
  approve: {
    label: '批准',
    icon: 'mdi-check-decagram-outline',
    color: 'success',
  },
  reject: { label: '驳回', icon: 'mdi-close-octagon-outline', color: 'error' },
  check: { label: '核对', icon: 'mdi-account-check-outline', color: 'primary' },
  finalize: {
    label: '完成',
    icon: 'mdi-play-circle-outline',
    color: 'primary',
  },
}

function entityTitle(row: Readonly<WorkbenchItem>): string {
  return (
    pageRegistry[`${row.category === 'BOB' ? 'bob' : 'vou'}/${row.entity}`]
      ?.entityTitle ?? row.entity
  )
}

function pendingStatus(row: Readonly<WorkbenchItem>): string {
  return {
    CHECK: '待核对',
    APPROVE: '待批准',
    FINALIZE: '待完成',
  }[row.pendingStage]
}

function pendingColor(row: Readonly<WorkbenchItem>): string {
  if (row.pendingStage === 'APPROVE') return 'success'
  if (row.pendingStage === 'FINALIZE') return 'primary'
  return 'warning'
}

function rowIdentity(row: WorkbenchItem): string {
  return row.category === 'BOB' ? row.code : row.documentNo
}

function visibleActions(row: WorkbenchItem): WorkbenchAction[] {
  return row.availableActions.filter(
    (action) => action !== 'view' || !row.availableActions.includes('edit'),
  )
}

function rowActions(row: WorkbenchItem): {
  primary: ListRowAction[]
  more: ListRowAction[]
} {
  const actions = visibleActions(row)
  const forward = actions.find((action) =>
    ['submit', 'approve', 'check', 'finalize', 'reject'].includes(action),
  )
  const primaryAction = forward ?? actions[0]
  const toAction = (action: WorkbenchAction): ListRowAction => ({
    key: action,
    ...actionDefinitions[action],
    label: `${actionDefinitions[action].label} ${rowIdentity(row)}`,
  })
  return {
    primary: primaryAction ? [toAction(primaryAction)] : [],
    more: actions.filter((action) => action !== primaryAction).map(toAction),
  }
}

async function changeCategory(value: unknown): Promise<void> {
  if (value === 'BOB' || value === 'VOU') await vm.selectCategory(value)
}

async function openItem(
  row: WorkbenchItem,
  mode: 'view' | 'edit',
): Promise<void> {
  const domain = row.category === 'BOB' ? 'bob' : 'vou'
  await router.push({
    path: `/${domain}/${row.entity}`,
    query: {
      ...(row.category === 'BOB'
        ? { objectId: row.objectId }
        : { documentId: row.documentId }),
      mode,
    },
  })
}

async function selectAction(action: string, row: WorkbenchItem): Promise<void> {
  if (action === 'view' || action === 'edit') {
    await openItem(row, action)
    return
  }
  if (action === 'reject' && row.category === 'BOB') {
    rejectTarget.value = row
    rejectComment.value = ''
    return
  }
  if (
    action === 'submit' ||
    action === 'approve' ||
    action === 'check' ||
    action === 'finalize'
  ) {
    await vm.runAction(row, action)
  }
}

async function confirmReject(): Promise<void> {
  const target = rejectTarget.value
  if (!target || !rejectComment.value.trim()) return
  if (await vm.runAction(target, 'reject', rejectComment.value)) {
    rejectTarget.value = null
    rejectComment.value = ''
  }
}

function closeReject(value: boolean): void {
  if (!value) {
    rejectTarget.value = null
    rejectComment.value = ''
  }
}

void vm.query('BOB')
</script>

<template>
  <v-container fluid class="workbench pa-4 pa-md-7">
    <v-card class="workbench__panel" rounded="xl" variant="flat">
      <v-tabs
        :model-value="vm.activeCategory"
        color="primary"
        @update:model-value="changeCategory"
      >
        <v-tab value="BOB">
          <v-icon class="mr-2" icon="mdi-database-clock-outline" />
          待处理资料
        </v-tab>
        <v-tab value="VOU">
          <v-icon class="mr-2" icon="mdi-file-clock-outline" />
          待处理单据
        </v-tab>
      </v-tabs>

      <v-divider />

      <div class="workbench__list">
        <AppSnackbar
          :message="vm.activeState.errorMessage"
          @dismiss="vm.activeState.errorMessage = null"
        />

        <BusinessObjectList
          v-if="vm.activeCategory === 'BOB'"
          :columns="objectColumns"
          :editable="true"
          empty-text="暂无待处理资料"
          :keyword="vm.activeState.keyword"
          :loading="vm.activeState.loading"
          :page="vm.activeState.page"
          :page-size="vm.activeState.pageSize"
          :row-key="(row) => row.objectId"
          :rows="objectRows"
          search-label="编码或名称"
          :total="vm.activeState.total"
          @query="vm.query(vm.activeCategory, true)"
          @update:keyword="vm.activeState.keyword = $event"
          @update:page="vm.changePage"
        >
          <template #cell-status="{ row }">
            <v-chip
              :color="pendingColor(row)"
              density="comfortable"
              size="small"
              variant="tonal"
            >
              {{ pendingStatus(row) }}
            </v-chip>
          </template>

          <template #actions="{ row }">
            <ListRowActions
              :label="`操作 ${rowIdentity(row)}`"
              :loading="Boolean(vm.actionLoading)"
              :more="rowActions(row).more"
              :more-label="`更多操作 ${rowIdentity(row)}`"
              :primary="rowActions(row).primary"
              @select="selectAction($event, row)"
            />
          </template>
        </BusinessObjectList>

        <VoucherList
          v-else
          :date-from="''"
          :date-to="''"
          empty-text="暂无待处理单据"
          :filterable="false"
          :keyword="vm.activeState.keyword"
          :lifecycle-labels="documentLifecycleLabels"
          :loading="vm.activeState.loading"
          :page="vm.activeState.page"
          :page-size="vm.activeState.pageSize"
          :party="null"
          :rows="documentRows"
          search-label="单号或往来方"
          :show-entity="true"
          :sort="documentSort"
          :sortable="false"
          :statuses="[]"
          :total="vm.activeState.total"
          @query="vm.query('VOU', true)"
          @update:keyword="vm.activeState.keyword = $event"
          @update:page="vm.changePage"
        >
          <template #cell-entity="{ row }">
            {{ entityTitle(row) }}
          </template>

          <template #cell-status="{ row }">
            <v-chip
              :color="pendingColor(row)"
              density="comfortable"
              size="small"
              variant="tonal"
            >
              {{ pendingStatus(row) }}
            </v-chip>
          </template>

          <template #cell-amount="{ row }">
            {{ [row.currency, row.amount].filter(Boolean).join(' ') }}
          </template>

          <template #actions="{ row }">
            <ListRowActions
              :label="`操作 ${rowIdentity(row)}`"
              :loading="Boolean(vm.actionLoading)"
              :more="rowActions(row).more"
              :more-label="`更多操作 ${rowIdentity(row)}`"
              :primary="rowActions(row).primary"
              @select="selectAction($event, row)"
            />
          </template>
        </VoucherList>
      </div>
    </v-card>

    <v-dialog
      :model-value="Boolean(rejectTarget)"
      max-width="520"
      @update:model-value="closeReject"
    >
      <v-card rounded="xl" title="驳回资料">
        <v-card-text>
          <p class="mb-4">请输入驳回 {{ rejectTarget?.code }} 的审核意见。</p>
          <v-textarea
            v-model="rejectComment"
            autofocus
            counter="1000"
            label="驳回意见"
            maxlength="1000"
            rows="4"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeReject(false)">取消</v-btn>
          <v-btn
            color="error"
            :disabled="!rejectComment.trim()"
            :loading="Boolean(vm.actionLoading)"
            @click="confirmReject"
          >
            确认驳回
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.workbench {
  color: rgb(var(--v-theme-on-background));
}

.workbench__panel {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.workbench__panel :deep(.v-tabs) {
  padding-inline: 12px;
}

.workbench__list {
  padding: 22px;
}

@media (max-width: 700px) {
  .workbench__panel :deep(.v-tab) {
    min-width: 0;
    flex: 1;
    padding-inline: 8px;
  }

  .workbench__list {
    padding: 14px;
  }
}
</style>
