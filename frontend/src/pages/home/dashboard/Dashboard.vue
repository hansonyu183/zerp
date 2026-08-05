<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
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
import { pageRegistrations, pageRegistry } from '@/router/registry'
import {
  type WorkbenchAction,
  type WorkbenchDocumentItem,
  type WorkbenchItem,
  type WorkbenchObjectItem,
  type WorkbenchPendingStage,
  useDashboardViewModel,
} from './vm'

const vm = reactive(useDashboardViewModel())
const router = useRouter()
const session = useSessionStore()
const rejectTarget = ref<WorkbenchObjectItem | null>(null)
const rejectComment = ref('')

function fallbackEntityTitle(entity: string): string {
  return `开发中：${entity.replaceAll('-', ' ')}`
}

function canProcessEntity(domain: 'bob' | 'vou', entity: string): boolean {
  const actions =
    domain === 'bob'
      ? ['submit', 'approve', 'reject']
      : ['check', 'approve', 'finalize']
  return (
    session.can(`/${domain}/${entity}/query`) &&
    actions.some((action) => session.can(`/${domain}/${entity}/${action}`))
  )
}

const entityFilterOptions = computed(() => {
  const domain = vm.activeCategory === 'BOB' ? 'bob' : 'vou'
  const options = new Map<string, string>()
  const add = (entity: string, title?: string): void => {
    if (!options.has(entity)) {
      options.set(
        entity,
        pageRegistry[`${domain}/${entity}`]?.entityTitle ??
          (title ? `开发中：${title}` : fallbackEntityTitle(entity)),
      )
    }
  }

  for (const registration of pageRegistrations) {
    if (
      registration.domain === domain &&
      canProcessEntity(domain, registration.entity)
    ) {
      add(registration.entity, registration.entityTitle)
    }
  }
  for (const menuDomain of session.routeMenus) {
    if (menuDomain.domain !== domain) continue
    for (const menu of menuDomain.children) {
      const entity = menu.routeKey?.split('/')[1] ?? menu.entity
      if (canProcessEntity(domain, entity)) add(entity, menu.title)
    }
  }
  for (const row of vm.states[vm.activeCategory].rows) {
    if (row.category === vm.activeCategory) add(row.entity)
  }

  return [...options].map(([value, title]) => ({ title, value }))
})
const pendingStageFilterOptions = computed(() => [
  { title: '待核对', value: 'CHECK' as const },
  { title: '待批准', value: 'APPROVE' as const },
  ...(vm.activeCategory === 'VOU'
    ? [{ title: '待完成', value: 'FINALIZE' as const }]
    : []),
])

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

function updateEntityFilters(value: unknown): void {
  vm.activeState.entities = Array.isArray(value)
    ? value.filter((entity): entity is string => typeof entity === 'string')
    : []
}

function updatePendingStageFilters(value: unknown): void {
  const validStages = new Set<WorkbenchPendingStage>([
    'CHECK',
    'APPROVE',
    'FINALIZE',
  ])
  vm.activeState.pendingStages = Array.isArray(value)
    ? value.filter(
        (stage): stage is WorkbenchPendingStage =>
          typeof stage === 'string' &&
          validStages.has(stage as WorkbenchPendingStage),
      )
    : []
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

void vm.query('VOU')
</script>

<template>
  <v-container fluid class="workbench pa-4 pa-md-7">
    <v-card class="workbench__panel" rounded="xl" variant="flat">
      <v-tabs
        :model-value="vm.activeCategory"
        color="primary"
        @update:model-value="changeCategory"
      >
        <v-tab value="VOU">
          <v-icon class="mr-2" icon="mdi-file-clock-outline" />
          待办单据
        </v-tab>
        <v-tab value="BOB">
          <v-icon class="mr-2" icon="mdi-database-clock-outline" />
          待办资料
        </v-tab>
      </v-tabs>

      <v-divider />

      <div class="workbench__list">
        <AppSnackbar
          diagnostics
          :message="vm.activeState.errorMessage"
          @dismiss="vm.activeState.errorMessage = null"
        />
        <AppSnackbar
          :message="vm.successMessage"
          type="success"
          @dismiss="vm.successMessage = null"
        />

        <BusinessObjectList
          v-if="vm.activeCategory === 'BOB'"
          :columns="objectColumns"
          :editable="true"
          empty-text="暂无待办资料"
          :keyword="vm.activeState.keyword"
          :loading="vm.activeState.loading"
          :page="vm.activeState.page"
          :page-size="vm.activeState.pageSize"
          :row-key="(row) => row.objectId"
          :rows="objectRows"
          search-label="编码或名称"
          :total="vm.activeState.total"
          @query="vm.query(vm.activeCategory, true)"
          @apply-filters="vm.query(vm.activeCategory, true)"
          @reset-filters="vm.resetFilters"
          @update:keyword="vm.activeState.keyword = $event"
          @update:page="vm.changePage"
        >
          <template #filters>
            <v-select
              chips
              clearable
              hide-details
              item-title="title"
              item-value="value"
              :items="entityFilterOptions"
              label="类型"
              :model-value="vm.activeState.entities"
              multiple
              variant="outlined"
              @update:model-value="updateEntityFilters"
            />
            <v-select
              chips
              clearable
              hide-details
              item-title="title"
              item-value="value"
              :items="pendingStageFilterOptions"
              label="待办状态"
              :model-value="vm.activeState.pendingStages"
              multiple
              variant="outlined"
              @update:model-value="updatePendingStageFilters"
            />
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
          empty-text="暂无待办单据"
          :filterable="true"
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
          @reset="vm.resetFilters"
          @update:keyword="vm.activeState.keyword = $event"
          @update:page="vm.changePage"
        >
          <template #filters>
            <v-select
              chips
              clearable
              hide-details
              item-title="title"
              item-value="value"
              :items="entityFilterOptions"
              label="类型"
              :model-value="vm.activeState.entities"
              multiple
              variant="outlined"
              @update:model-value="updateEntityFilters"
            />
            <v-select
              chips
              clearable
              hide-details
              item-title="title"
              item-value="value"
              :items="pendingStageFilterOptions"
              label="待办状态"
              :model-value="vm.activeState.pendingStages"
              multiple
              variant="outlined"
              @update:model-value="updatePendingStageFilters"
            />
          </template>

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
