<script setup lang="ts">
import { reactive } from 'vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { useSalesPartnerViewModel, type SalesPartnerListItem } from './vm'

const vm = reactive(useSalesPartnerViewModel())
const capabilities = [
  { title: '外部兼职销售', value: 'EXTERNAL_PART_TIME' },
  { title: '渠道商', value: 'CHANNEL_PARTNER' },
] as const
const partyKindItems = [
  { title: '企业/机构', value: 'ORGANIZATION' },
  { title: '个人', value: 'PERSON' },
] as const
const columns: readonly BusinessObjectColumn<SalesPartnerListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  {
    key: 'partyDisplayName',
    label: '主体',
    value: (row) => row.partyDisplayName,
  },
  {
    key: 'operatingEntityName',
    label: '经营主体',
    value: (row) => `${row.operatingEntityCode} · ${row.operatingEntityName}`,
  },
  {
    key: 'capabilities',
    label: '能力',
    value: (row) => (row.candidate ?? row.effective)?.capabilities ?? [],
  },
  {
    key: 'status',
    label: '状态',
    value: (row) => (row.candidate ?? row.effective)?.status ?? '—',
    sizing: 'compact',
  },
]

function capabilityLabel(value: string): string {
  return capabilities.find((option) => option.value === value)?.title ?? value
}

function rowActions(row: SalesPartnerListItem): ListRowAction[] {
  return [
    ...(vm.canView
      ? [
          {
            key: 'view',
            label: '查看',
            icon: 'mdi-eye-outline',
            color: 'primary',
          },
        ]
      : []),
    ...(vm.canSave
      ? [
          {
            key: 'edit',
            label: '编辑',
            icon: 'mdi-pencil-outline',
            color: 'primary',
          },
        ]
      : []),
    ...(['submit', 'approve', 'enable', 'disable'] as const)
      .filter((action) => vm.canRun(row, action))
      .map((action) => ({
        key: action,
        label:
          action === 'submit'
            ? '提交'
            : action === 'approve'
              ? '审核'
              : action === 'enable'
                ? '启用'
                : '停用',
        icon:
          action === 'submit'
            ? 'mdi-send-outline'
            : action === 'approve'
              ? 'mdi-check-circle-outline'
              : action === 'enable'
                ? 'mdi-toggle-switch-outline'
                : 'mdi-toggle-switch-off-outline',
      })),
  ]
}

function selectRowAction(action: string, row: SalesPartnerListItem): void {
  if (action === 'view') {
    void vm.open(row, 'view')
    return
  }
  if (action === 'edit') {
    void vm.open(row, 'edit')
    return
  }
  if (['submit', 'approve', 'enable', 'disable'].includes(action)) {
    void vm.runLifecycle(
      row,
      action as 'submit' | 'approve' | 'enable' | 'disable',
    )
  }
}

function partyTitle(item: { displayName: string; legalName: string }): string {
  return item.displayName || item.legalName
}

function referenceTitle(item: { code: string; name: string }): string {
  return `${item.code} · ${item.name}`
}
</script>

<template>
  <v-container fluid class="pa-3 pa-md-6">
    <AppSnackbar
      diagnostics
      :message="vm.errorMessage"
      @dismiss="vm.errorMessage = null"
    />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <v-card>
      <v-card-title>销售合作方</v-card-title>
      <v-card-text>
        <BusinessObjectList
          :columns="columns"
          :creatable="vm.canCreate"
          :editable="vm.canView"
          empty-text="请设置条件后查询销售合作方"
          :keyword="vm.keywordDraft"
          :loading="vm.loading || Boolean(vm.actionLoading)"
          :page="vm.page"
          :page-size="20"
          :row-key="(row) => row.objectId"
          :rows="vm.rows"
          search-label="编码或主体名称"
          :total="vm.total"
          @apply-filters="vm.submitFilters"
          @create="vm.openCreate"
          @query="vm.submitFilters"
          @reset-filters="vm.resetFilters"
          @update:keyword="vm.keywordDraft = $event"
          @update:page="vm.changePage"
        >
          <template #filters>
            <v-select
              v-model="vm.capabilityDraft"
              clearable
              hide-details
              :items="capabilities"
              label="能力"
            />
          </template>
          <template #cell-capabilities="{ value }">
            <div class="d-flex flex-wrap ga-1">
              <v-chip
                v-for="item in value"
                :key="item"
                size="small"
                variant="tonal"
              >
                {{ capabilityLabel(item) }}
              </v-chip>
            </div>
          </template>
          <template #cell-status="{ row }">
            <v-chip size="small" variant="tonal">
              {{ (row.candidate ?? row.effective)?.status ?? '—' }}
            </v-chip>
          </template>
          <template #actions="{ row }">
            <ListRowActions
              :actions="rowActions(row)"
              :label="`操作 ${row.code}`"
              :loading="Boolean(vm.actionLoading)"
              @select="selectRowAction($event, row)"
            />
          </template>
        </BusinessObjectList>
      </v-card-text>
    </v-card>

    <v-dialog v-model="vm.workspaceOpen" max-width="900" persistent>
      <v-card>
        <v-card-title>
          {{ vm.mode === 'create' ? '新增销售合作关系' : '销售合作关系' }}
        </v-card-title>
        <v-card-text>
          <template v-if="vm.mode === 'create'">
            <v-btn-toggle
              v-model="vm.partyMode"
              mandatory
              color="primary"
              class="mb-4"
            >
              <v-btn v-if="vm.canCreateWithNewParty" value="new">新主体</v-btn>
              <v-btn v-if="vm.canCreateWithExistingParty" value="existing"
                >复用已有主体</v-btn
              >
            </v-btn-toggle>
            <v-row v-if="vm.partyMode === 'new'" dense>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="vm.newParty.kind"
                  :items="partyKindItems"
                  label="主体类型"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model="vm.newParty.legalName"
                  label="主体名称"
                  required
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model="vm.newParty.taxNumber"
                  label="税号（可选）"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12">
                <v-text-field
                  v-model="vm.newParty.displayName"
                  label="显示名称（可选）"
                  variant="outlined"
                />
              </v-col>
            </v-row>
            <v-autocomplete
              v-else
              v-model="vm.selectedParty"
              :item-title="partyTitle"
              :items="vm.partyOptions"
              label="已有主体"
              return-object
              variant="outlined"
              @update:search="vm.searchParties($event ?? '')"
            />
          </template>
          <v-text-field
            v-else
            :model-value="vm.detail?.partyDisplayName ?? ''"
            label="主体"
            readonly
            variant="outlined"
          />
          <v-row dense>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="vm.operatingEntity"
                :item-title="referenceTitle"
                :items="vm.operatingOptions"
                label="经营主体"
                :readonly="vm.mode !== 'create'"
                required
                return-object
                variant="outlined"
                @update:search="vm.searchOperatingEntities($event ?? '')"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="vm.data.capabilities"
                chips
                :items="capabilities"
                hint="草稿可暂不选择，提交审核前至少选择一种"
                label="能力（草稿可空）"
                multiple
                :readonly="!vm.editing"
                variant="outlined"
              />
            </v-col>
            <v-col cols="12" md="6"
              ><v-text-field
                v-model="vm.data.contactName"
                label="联系人"
                :readonly="!vm.editing"
                variant="outlined"
            /></v-col>
            <v-col cols="12" md="6"
              ><v-text-field
                v-model="vm.data.contactPhone"
                label="电话"
                :readonly="!vm.editing"
                variant="outlined"
            /></v-col>
            <v-col cols="12"
              ><v-text-field
                v-model="vm.data.email"
                label="邮箱"
                :readonly="!vm.editing"
                variant="outlined"
            /></v-col>
            <v-col cols="12"
              ><v-textarea
                v-model="vm.data.address"
                label="地址"
                :readonly="!vm.editing"
                variant="outlined"
            /></v-col>
            <v-col cols="12"
              ><v-textarea
                v-model="vm.data.remark"
                label="备注"
                :readonly="!vm.editing"
                variant="outlined"
            /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="vm.workspaceOpen = false">关闭</v-btn>
          <v-btn
            v-if="vm.editing"
            color="primary"
            :disabled="!vm.formValid"
            :loading="vm.saving"
            @click="vm.save"
            >保存</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
