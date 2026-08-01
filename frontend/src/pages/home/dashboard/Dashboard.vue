<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { pageRegistry } from '@/router/registry'
import { formatLocalDateTime } from '@/utils/date'
import {
  type WorkbenchAction,
  type WorkbenchItem,
  type WorkbenchObjectItem,
  useDashboardViewModel,
} from './vm'

const vm = reactive(useDashboardViewModel())
const router = useRouter()
const rejectTarget = ref<WorkbenchObjectItem | null>(null)
const rejectComment = ref('')

const objectColumns: readonly BusinessObjectColumn<WorkbenchItem>[] = [
  { key: 'entity', label: '类型', value: entityTitle, width: '140px' },
  {
    key: 'identity',
    label: '编码 · 名称',
    value: (row) =>
      row.category === 'BOB' ? `${row.code} · ${row.name}` : '—',
  },
  { key: 'status', label: '状态', value: pendingStatus, width: '110px' },
  {
    key: 'updatedAt',
    label: '更新时间',
    value: (row) => formatLocalDateTime(row.updatedAt),
    width: '190px',
  },
]

const documentColumns: readonly BusinessObjectColumn<WorkbenchItem>[] = [
  { key: 'entity', label: '类型', value: entityTitle, width: '140px' },
  {
    key: 'documentNo',
    label: '单号',
    value: (row) => (row.category === 'VOU' ? row.documentNo : '—'),
  },
  {
    key: 'businessDate',
    label: '日期',
    value: (row) => (row.category === 'VOU' ? row.businessDate : '—'),
    width: '120px',
  },
  {
    key: 'partyName',
    label: '往来方',
    value: (row) => (row.category === 'VOU' ? row.partyName || '—' : '—'),
  },
  {
    key: 'amount',
    label: '金额',
    value: (row) =>
      row.category === 'VOU'
        ? [row.currency, row.amount].filter(Boolean).join(' ')
        : '—',
    align: 'end',
    width: '150px',
  },
  { key: 'status', label: '状态', value: pendingStatus, width: '110px' },
  {
    key: 'updatedAt',
    label: '更新时间',
    value: (row) => formatLocalDateTime(row.updatedAt),
    width: '190px',
  },
]

const activeColumns = computed(() =>
  vm.activeCategory === 'BOB' ? objectColumns : documentColumns,
)

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
    <v-sheet class="workbench__heading" rounded="xl">
      <div>
        <div class="workbench__eyebrow">WORKBENCH</div>
        <h2>工作台</h2>
        <p>集中处理当前账号有权限核对、批准和完成的业务。</p>
      </div>
      <v-avatar color="primary" size="58" variant="tonal">
        <v-icon icon="mdi-briefcase-check-outline" size="30" />
      </v-avatar>
    </v-sheet>

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
        <v-alert
          v-if="vm.activeState.errorMessage"
          class="mb-4"
          type="error"
          variant="tonal"
        >
          {{ vm.activeState.errorMessage }}
        </v-alert>

        <BusinessObjectList
          :columns="activeColumns"
          :editable="true"
          :empty-text="
            vm.activeCategory === 'BOB' ? '暂无待处理资料' : '暂无待处理单据'
          "
          :keyword="vm.activeState.keyword"
          :loading="vm.activeState.loading"
          :page="vm.activeState.page"
          :page-size="vm.activeState.pageSize"
          :row-key="
            (row) => (row.category === 'BOB' ? row.objectId : row.documentId)
          "
          :rows="vm.activeState.rows"
          search-label="编码、名称、单号或往来方"
          :total="vm.activeState.total"
          @query="vm.query(vm.activeCategory, true)"
          @update:keyword="vm.activeState.keyword = $event"
          @update:page="vm.changePage"
        >
          <template #cell-status="{ row }">
            <v-chip
              :color="
                row.pendingStage === 'APPROVE'
                  ? 'success'
                  : row.pendingStage === 'FINALIZE'
                    ? 'primary'
                    : 'warning'
              "
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

.workbench__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 28px;
  background: linear-gradient(
    135deg,
    rgba(var(--v-theme-primary), 0.12),
    rgba(var(--v-theme-surface), 0.98)
  );
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.workbench__eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.workbench__heading h2 {
  margin: 5px 0 4px;
  font-size: clamp(25px, 4vw, 34px);
  letter-spacing: -0.03em;
}

.workbench__heading p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.workbench__panel {
  margin-top: 22px;
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
  .workbench__heading {
    align-items: flex-start;
    padding: 20px;
  }

  .workbench__heading .v-avatar {
    display: none;
  }

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
