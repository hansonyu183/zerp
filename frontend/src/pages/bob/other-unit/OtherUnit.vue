<script setup lang="ts">
import { onMounted, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { statusText } from '../shared/config-helpers'
import { useOtherUnitViewModel } from './vm'
import type { OtherUnitView } from './types'

const vm = reactive(useOtherUnitViewModel())
const route = useRoute()
const router = useRouter()
const statusItems = [
  { title: '草稿', value: 'DRAFT' },
  { title: '待批准', value: 'PENDING' },
  { title: '已批准', value: 'APPROVED' },
]
const partyKindItems = [
  { title: '个人', value: 'PERSON' },
  { title: '组织', value: 'ORGANIZATION' },
]
const lifecycle = [
  { action: 'submit', label: '提交', icon: 'mdi-send-outline' },
  { action: 'unsubmit', label: '撤回', icon: 'mdi-undo-variant' },
  { action: 'approve', label: '通过', icon: 'mdi-check-circle-outline' },
  { action: 'reject', label: '驳回', icon: 'mdi-close-circle-outline' },
  { action: 'unapprove', label: '撤销批准', icon: 'mdi-undo' },
  { action: 'enable', label: '启用', icon: 'mdi-toggle-switch-outline' },
  { action: 'disable', label: '停用', icon: 'mdi-toggle-switch-off-outline' },
  { action: 'delete', label: '删除草稿', icon: 'mdi-delete-outline' },
] as const
const columns: readonly BusinessObjectColumn<OtherUnitView>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  {
    key: 'partyDisplayName',
    label: '主体',
    value: (row) => row.partyDisplayName,
  },
  {
    key: 'operatingEntityName',
    label: '经营主体',
    value: (row) => row.operatingEntityName,
  },
  {
    key: 'status',
    label: '状态',
    value: (row) => row.approval.status,
    sizing: 'compact',
  },
]

function rowActions(row: OtherUnitView): ListRowAction[] {
  return [
    ...(vm.canGet
      ? [
          {
            key: 'open',
            label: '查看 / 编辑',
            icon: 'mdi-pencil-outline',
            color: 'primary',
          },
        ]
      : []),
    ...lifecycle
      .filter((entry) => vm.canRun(row, entry.action))
      .map((entry) => ({
        key: entry.action,
        label: entry.label,
        icon: entry.icon,
      })),
  ]
}

function selectRowAction(action: string, row: OtherUnitView): void {
  if (action === 'open') {
    void vm.open(row, vm.canSave ? 'edit' : 'view')
    return
  }
  const entry = lifecycle.find((item) => item.action === action)
  if (entry) void run(row, entry.action)
}

async function run(
  row: OtherUnitView,
  action: (typeof lifecycle)[number]['action'],
): Promise<void> {
  const reason = ['unsubmit', 'reject', 'unapprove'].includes(action)
    ? (window.prompt('请输入原因') ?? '')
    : ''
  if (
    ['delete', 'disable', 'unapprove'].includes(action) &&
    !window.confirm('确认执行此操作？')
  )
    return
  await vm.runLifecycle(row, action, reason)
}

onMounted(() => void vm.query())

watch(
  () => [route.query.objectId, route.query.mode] as const,
  ([objectId, mode]) => {
    if (typeof objectId !== 'string') return
    void vm.openById(objectId, mode === 'edit' && vm.canSave ? 'edit' : 'view')
  },
  { immediate: true },
)

watch(
  () => vm.editorOpen,
  (open, wasOpen) => {
    if (open || !wasOpen || typeof route.query.objectId !== 'string') return
    const { objectId: _objectId, mode: _mode, ...query } = route.query
    void router.replace({ query })
  },
)
</script>

<template>
  <v-container fluid class="pa-3 pa-md-6">
    <v-card>
      <v-card-title>其他单位</v-card-title>
      <v-card-text>
        <BusinessObjectList
          :columns="columns"
          :creatable="vm.canCreate"
          :editable="true"
          empty-text="暂无其他单位"
          :keyword="vm.keywordDraft"
          :loading="vm.loading"
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
          @update:page="
            (value) => {
              vm.page = value
              void vm.query()
            }
          "
        >
          <template #filters>
            <v-select
              v-model="vm.statusDraft"
              :items="statusItems"
              label="状态"
              multiple
              clearable
              hide-details
            />
            <v-autocomplete
              v-if="vm.canOperatingQuery"
              v-model="vm.operatingDraft"
              :items="vm.operatingOptions"
              item-value="objectId"
              item-title="title"
              label="经营主体"
              clearable
              hide-details
              @update:search="vm.searchOperatingEntities"
            />
          </template>
          <template #cell-status="{ row: item }">
            <div class="d-flex flex-wrap ga-1">
              <v-chip size="small" variant="tonal">
                V{{ item.approval.versionNo }} ·
                {{ statusText[item.approval.status] }}
              </v-chip>
            </div>
          </template>
          <template #actions="{ row }">
            <ListRowActions
              :actions="rowActions(row)"
              :label="`操作 ${row.code}`"
              :loading="vm.loading"
              @select="selectRowAction($event, row)"
            />
          </template>
        </BusinessObjectList>
      </v-card-text>
    </v-card>

    <v-dialog v-model="vm.editorOpen" max-width="960" persistent>
      <v-card>
        <v-card-title>{{
          vm.mode === 'create' ? '新增其他单位' : '其他单位关系资料'
        }}</v-card-title>
        <v-card-text>
          <template v-if="vm.mode === 'create'">
            <v-btn-toggle
              v-model="vm.form.partyMode"
              mandatory
              color="primary"
              class="mb-4"
            >
              <v-btn v-if="vm.canCreateWithNewParty" value="NEW">新主体</v-btn>
              <v-btn v-if="vm.canCreateWithExistingParty" value="EXISTING"
                >复用已有主体</v-btn
              >
            </v-btn-toggle>
            <v-autocomplete
              v-if="vm.form.partyMode === 'EXISTING'"
              v-model="vm.form.partyId"
              :items="vm.partyOptions"
              item-value="partyId"
              item-title="displayName"
              label="选择主体"
              @update:search="vm.searchParties"
            />
            <v-row v-else dense>
              <v-col cols="12" sm="4"
                ><v-select
                  v-model="vm.form.partyKind"
                  :items="partyKindItems"
                  label="主体类型"
              /></v-col>
              <v-col cols="12" sm="8"
                ><v-text-field
                  v-model="vm.form.legalName"
                  label="法定名称"
                  required
              /></v-col>
              <v-col cols="12" sm="6"
                ><v-text-field v-model="vm.form.displayName" label="显示名称"
              /></v-col>
              <v-col cols="12" sm="6"
                ><v-text-field v-model="vm.form.taxNumber" label="税号"
              /></v-col>
              <v-col cols="12" sm="5"
                ><v-select
                  v-model="vm.form.identifierType"
                  :items="[
                    { title: '身份证件号', value: 'PERSON_ID' },
                    {
                      title: '统一社会信用代码',
                      value: 'UNIFIED_SOCIAL_CREDIT_CODE',
                    },
                  ]"
                  label="强标识类型"
              /></v-col>
              <v-col cols="12" sm="7"
                ><v-text-field
                  v-model="vm.form.identifierValue"
                  label="强标识（精确命中会自动复用）"
              /></v-col>
              <v-col v-if="vm.partyOptions.length" cols="12">
                <v-alert
                  type="warning"
                  variant="tonal"
                  title="可能已有同一主体"
                >
                  <div class="mb-2">以下仅为名称模糊建议，不阻止继续创建：</div>
                  <div class="d-flex flex-wrap ga-2">
                    <v-btn
                      v-for="party in vm.partyOptions"
                      :key="party.partyId"
                      size="small"
                      variant="outlined"
                      @click="vm.reuseSuggestedParty(party)"
                    >
                      复用 {{ party.displayName }}
                    </v-btn>
                  </div>
                </v-alert>
              </v-col>
            </v-row>
          </template>
          <v-alert v-else type="info" variant="tonal" class="mb-4"
            >{{ vm.detail?.partyDisplayName }} ·
            主体共享身份请到主体页面修改。</v-alert
          >
          <v-autocomplete
            v-model="vm.form.operatingEntityId"
            :items="vm.operatingOptions"
            item-value="objectId"
            item-title="title"
            label="经营主体"
            :disabled="vm.mode !== 'create'"
            @update:search="vm.searchOperatingEntities"
          />
          <v-row dense>
            <v-col cols="12" sm="6"
              ><v-text-field
                v-model="vm.form.contactName"
                label="业务联系人"
                :disabled="!vm.editable"
            /></v-col>
            <v-col cols="12" sm="6"
              ><v-text-field
                v-model="vm.form.contactPhone"
                label="业务联系电话"
                :disabled="!vm.editable"
            /></v-col>
            <v-col cols="12" sm="6"
              ><v-text-field
                v-model="vm.form.email"
                label="业务邮箱"
                :disabled="!vm.editable"
            /></v-col>
            <v-col cols="12" sm="6">
              <v-autocomplete
                v-model="vm.form.settlementMethodId"
                :items="vm.settlementOptions"
                item-value="objectId"
                item-title="title"
                label="结算方式（可选）"
                clearable
                no-filter
                :disabled="!vm.editable"
                @update:search="vm.searchSettlementMethods"
              />
            </v-col>
            <v-col cols="12"
              ><v-textarea
                v-model="vm.form.address"
                label="业务地址"
                rows="2"
                :disabled="!vm.editable"
            /></v-col>
            <v-col cols="12"
              ><v-textarea
                v-model="vm.form.remark"
                label="关系备注"
                rows="2"
                :disabled="!vm.editable"
            /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="vm.close">关闭</v-btn>
          <v-btn
            v-if="vm.editable && (vm.mode === 'create' || vm.canSave)"
            color="primary"
            :loading="vm.saving"
            :disabled="!vm.formValid"
            @click="vm.save"
            >保存草稿</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <AppSnackbar v-model="vm.errorMessage" color="error" />
    <AppSnackbar v-model="vm.successMessage" color="success" />
  </v-container>
</template>
