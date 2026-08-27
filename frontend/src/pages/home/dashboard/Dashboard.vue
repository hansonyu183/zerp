<script setup lang="ts">
import { computed, reactive } from 'vue'
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
  workbenchItemPath,
  useDashboardViewModel,
} from './vm'
import WorkbenchActionDialog from './WorkbenchActionDialog.vue'

const vm = reactive(useDashboardViewModel())
const router = useRouter()
const session = useSessionStore()

function fallbackEntityTitle(entity: string): string {
  return `开发中：${entity.replaceAll('-', ' ')}`
}

function canProcessEntity(domain: 'bob' | 'vou', entity: string): boolean {
  const permissionDomain =
    domain === 'bob' && entity === 'operating-entity' ? 'dcl' : domain
  const actions =
    domain === 'bob'
      ? ['submit', 'approve', 'reject', 'unsubmit']
      : ['submit', 'approve', 'unsubmit']
  return (
    session.can(`/${permissionDomain}/${entity}/query`) &&
    actions.some((action) =>
      session.can(`/${permissionDomain}/${entity}/${action}`),
    )
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
      (registration.domain === domain ||
        (domain === 'bob' &&
          registration.domain === 'dcl' &&
          registration.entity === 'operating-entity')) &&
      canProcessEntity(domain, registration.entity)
    ) {
      add(registration.entity, registration.entityTitle)
    }
  }
  for (const menuDomain of session.routeMenus) {
    if (
      menuDomain.domain !== domain &&
      !(
        domain === 'bob' &&
        menuDomain.domain === 'dcl' &&
        menuDomain.children.some(
          (menu) =>
            (menu.routeKey?.split('/')[1] ?? menu.entity) ===
            'operating-entity',
        )
      )
    ) {
      continue
    }
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
  { title: '待提交审核', value: 'SUBMIT' as const },
  { title: '待批准', value: 'APPROVE' as const },
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
  submit: '提交审核',
  unsubmit: '撤回提交',
  approve: '批准',
  unapprove: '反批准',
  pending: '待审核',
  approved: '已批准',
}

const actionDefinitions: Record<WorkbenchAction, Omit<ListRowAction, 'key'>> = {
  view: { label: '查看', icon: 'mdi-eye-outline' },
  edit: { label: '编辑', icon: 'mdi-pencil-outline', color: 'primary' },
  approve: {
    label: '批准',
    icon: 'mdi-check-decagram-outline',
    color: 'success',
  },
  reject: { label: '驳回', icon: 'mdi-close-octagon-outline', color: 'error' },
  submit: { label: '提交审核', icon: 'mdi-send-outline', color: 'primary' },
  unsubmit: {
    label: '撤回提交',
    icon: 'mdi-undo-variant',
    color: 'warning',
  },
}

function entityTitle(row: Readonly<WorkbenchItem>): string {
  const domain =
    row.category === 'VOU'
      ? 'vou'
      : row.entity === 'operating-entity'
        ? 'dcl'
        : 'bob'
  return pageRegistry[`${domain}/${row.entity}`]?.entityTitle ?? row.entity
}

function pendingStatus(row: Readonly<WorkbenchItem>): string {
  const labels: Record<string, string> = {
    SUBMIT: '待提交审核',
    APPROVE: '待批准',
  }
  return labels[row.pendingStage] ?? '待处理'
}

function pendingColor(row: Readonly<WorkbenchItem>): string {
  if (row.pendingStage === 'APPROVE') return 'success'
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

function rowActions(row: WorkbenchItem): ListRowAction[] {
  const actions = visibleActions(row)
  const forward = actions.find((action) =>
    ['submit', 'approve', 'reject'].includes(action),
  )
  const primaryAction = forward ?? actions[0]
  const toAction = (action: WorkbenchAction): ListRowAction => ({
    key: action,
    ...actionDefinitions[action],
    label: `${actionDefinitions[action].label} ${rowIdentity(row)}`,
  })
  return [
    ...(primaryAction ? [toAction(primaryAction)] : []),
    ...actions.filter((action) => action !== primaryAction).map(toAction),
  ]
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
  const validStages = new Set<WorkbenchPendingStage>(['SUBMIT', 'APPROVE'])
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
  await router.push({
    path: workbenchItemPath(row),
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
    vm.requestConfirmation(row, action)
    return
  }
  if (action === 'unsubmit' && row.category === 'BOB') {
    vm.requestConfirmation(row, action)
    return
  }
  if (action === 'unsubmit' && row.category === 'VOU') {
    vm.requestConfirmation(row, action)
    return
  }
  if (action === 'submit' || action === 'approve') {
    await vm.runAction(row, action)
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
          :message="vm.successMessage"
          type="success"
          @dismiss="vm.successMessage = null"
        />

        <v-alert
          v-if="vm.activeState.errorMessage"
          class="mb-4"
          closable
          density="comfortable"
          title="待办加载失败"
          type="error"
          @click:close="vm.activeState.errorMessage = null"
        >
          {{ vm.activeState.errorMessage }}
          <template #append>
            <v-btn
              size="small"
              variant="text"
              @click="vm.query(vm.activeCategory)"
            >
              重试查询
            </v-btn>
          </template>
        </v-alert>

        <BusinessObjectList
          v-if="
            vm.activeCategory === 'BOB' &&
            (!vm.activeState.errorMessage || objectRows.length > 0)
          "
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
          @query="vm.applyFilters(vm.activeCategory)"
          @apply-filters="vm.applyFilters(vm.activeCategory)"
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
              :actions="rowActions(row)"
              :label="`操作 ${rowIdentity(row)}`"
              :loading="Boolean(vm.actionLoading)"
              :more-label="`更多操作 ${rowIdentity(row)}`"
              @select="selectAction($event, row)"
            />
          </template>
        </BusinessObjectList>

        <VoucherList
          v-else-if="!vm.activeState.errorMessage || documentRows.length > 0"
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
          @query="vm.applyFilters('VOU')"
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
              :actions="rowActions(row)"
              :label="`操作 ${rowIdentity(row)}`"
              :loading="Boolean(vm.actionLoading)"
              :more-label="`更多操作 ${rowIdentity(row)}`"
              @select="selectAction($event, row)"
            />
          </template>
        </VoucherList>
      </div>
    </v-card>

    <WorkbenchActionDialog
      :action="vm.confirmationAction"
      :comment="vm.confirmationComment"
      :loading="Boolean(vm.actionLoading)"
      :target="vm.confirmationTarget"
      @close="vm.cancelConfirmation"
      @confirm="vm.confirmAction"
      @update:comment="vm.confirmationComment = $event"
    />
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
