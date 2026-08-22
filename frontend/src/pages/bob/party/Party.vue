<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import { usePartyViewModel } from './vm'
import type { components } from '@/api/generated/schema'

const vm = reactive(usePartyViewModel())
const router = useRouter()
type PartyListItem = components['schemas']['PartyListItem']
type PartyMergeRelationshipConflict =
  components['schemas']['PartyMergeRelationshipConflict']
const columns: readonly BusinessObjectColumn<PartyListItem>[] = [
  { key: 'displayName', label: '显示名称', value: (row) => row.displayName },
  { key: 'legalName', label: '法定名称', value: (row) => row.legalName },
  { key: 'kind', label: '类型', value: (row) => row.kind, sizing: 'compact' },
]
const kindItems = [
  { title: '个人', value: 'PERSON' },
  { title: '组织', value: 'ORGANIZATION' },
]
const identifierTypeItems = [
  { title: '身份证件号', value: 'PERSON_ID' },
  { title: '统一社会信用代码', value: 'UNIFIED_SOCIAL_CREDIT_CODE' },
]
const relationshipLabels: Record<
  PartyMergeRelationshipConflict['relationshipType'],
  string
> = {
  customer: '客户关系',
  supplier: '供应关系',
  employee: '雇佣关系',
  'other-unit': '服务关系',
  'sales-partner': '销售合作关系',
}

async function save(): Promise<void> {
  if (!window.confirm(vm.impactMessage())) return
  await vm.save()
}

function conflictKey(conflict: PartyMergeRelationshipConflict): string {
  return `${conflict.relationshipType}\u0000${conflict.operatingEntityId}`
}

function setConflictResolution(
  conflict: PartyMergeRelationshipConflict,
  objectId: string | null,
): void {
  if (objectId) vm.mergeResolutions[conflictKey(conflict)] = objectId
}

async function confirmMerge(): Promise<void> {
  if (
    !window.confirm(
      '主体合并不可撤销。来源主体将永久只读，历史单据不改写；确认执行？',
    )
  )
    return
  await vm.confirmMerge()
}

function openRelationship(
  entity: components['schemas']['PartyRelationshipCard']['entity'],
  objectId: string,
): void {
  void router.push({
    name: `page:bob/${entity}`,
    query: { objectId, mode: 'view' },
  })
}

onMounted(() => void vm.query())
</script>

<template>
  <v-container fluid class="pa-3 pa-md-6">
    <v-card>
      <v-card-title class="d-flex align-center ga-2 flex-wrap">
        <span>主体</span>
        <v-spacer />
        <v-chip color="primary" variant="tonal"
          >只维护共享身份，不允许单独新建</v-chip
        >
      </v-card-title>
      <v-card-text>
        <BusinessObjectList
          :columns="columns"
          :editable="vm.canGet"
          empty-text="暂无主体"
          :keyword="vm.keywordDraft"
          :loading="vm.loading"
          :page="vm.page"
          :page-size="20"
          :row-key="(row) => row.partyId"
          :rows="vm.rows"
          search-label="名称、电话、邮箱或地址"
          :total="vm.total"
          @apply-filters="vm.submitFilters"
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
              v-model="vm.kindDraft"
              :items="kindItems"
              label="主体类型"
              clearable
              hide-details
            />
            <v-checkbox
              v-model="vm.mergedDraft"
              label="仅查看已合并主体"
              hide-details
            />
          </template>
          <template #cell-kind="{ row }">
            {{ row.kind === 'PERSON' ? '个人' : '组织' }}
          </template>
          <template #actions="{ row }">
            <ListRowActions
              :actions="[
                {
                  key: 'open',
                  label: '查看 / 编辑',
                  icon: 'mdi-pencil-outline',
                  color: 'primary',
                },
              ]"
              :label="`操作 ${row.displayName}`"
              @select="vm.open(row)"
            />
          </template>
        </BusinessObjectList>
      </v-card-text>
    </v-card>

    <v-dialog v-model="vm.editorOpen" max-width="900" persistent>
      <v-card>
        <v-card-title>主体共享身份</v-card-title>
        <v-card-text>
          <v-alert
            v-if="vm.detail?.mergedIntoPartyId"
            type="warning"
            variant="tonal"
            class="mb-4"
          >
            该主体已合并并永久只读；保留主体 ID：{{
              vm.detail.mergedIntoPartyId
            }}。
          </v-alert>
          <v-alert type="info" variant="tonal" class="mb-4"
            >共享身份保存后立即用于未来业务；关系专属资料请到对应关系页面维护。</v-alert
          >
          <v-row dense>
            <v-col cols="12" sm="4"
              ><v-select
                v-model="vm.form.kind"
                :items="kindItems"
                label="主体类型"
                :disabled="!vm.canModify"
            /></v-col>
            <v-col cols="12" sm="8"
              ><v-text-field
                v-model="vm.form.legalName"
                label="法定名称"
                required
                :disabled="!vm.canModify"
            /></v-col>
            <v-col cols="12" sm="6"
              ><v-text-field
                v-model="vm.form.displayName"
                label="显示名称"
                :disabled="!vm.canModify"
            /></v-col>
            <v-col cols="12">
              <div class="d-flex align-center mb-2">
                <span class="text-subtitle-1">强标识</span>
                <v-spacer />
                <v-btn
                  v-if="vm.canModify"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-plus"
                  @click="vm.addIdentifier"
                  >添加强标识</v-btn
                >
              </div>
              <v-row
                v-for="(identifier, index) in vm.form.strongIdentifiers"
                :key="index"
                dense
              >
                <v-col cols="12" sm="4">
                  <v-select
                    v-model="identifier.type"
                    :items="identifierTypeItems"
                    label="强标识类型"
                    :disabled="!vm.canModify"
                  />
                </v-col>
                <v-col cols="10" sm="7">
                  <v-text-field
                    v-model="identifier.value"
                    label="强标识值"
                    :disabled="!vm.canModify"
                  />
                </v-col>
                <v-col cols="2" sm="1" class="d-flex align-center">
                  <v-btn
                    v-if="vm.canModify"
                    icon="mdi-delete-outline"
                    variant="text"
                    aria-label="删除强标识"
                    @click="vm.removeIdentifier(index)"
                  />
                </v-col>
              </v-row>
              <div
                v-if="!vm.form.strongIdentifiers.length"
                class="text-medium-emphasis mb-2"
              >
                暂无强标识。
              </div>
            </v-col>
            <v-col cols="12" sm="6"
              ><v-text-field
                v-model="vm.form.taxNumber"
                label="税号"
                :disabled="!vm.canModify"
            /></v-col>
            <v-col cols="12" sm="6"
              ><v-text-field
                v-model="vm.form.phone"
                label="通用电话"
                :disabled="!vm.canModify"
            /></v-col>
            <v-col cols="12" sm="6"
              ><v-text-field
                v-model="vm.form.email"
                label="通用邮箱"
                :disabled="!vm.canModify"
            /></v-col>
            <v-col cols="12"
              ><v-textarea
                v-model="vm.form.address"
                label="通用地址"
                rows="2"
                :disabled="!vm.canModify"
            /></v-col>
          </v-row>
          <div class="text-subtitle-1 mb-2">当前可见关系</div>
          <v-row dense>
            <v-col
              v-for="relation in vm.detail?.relationships ?? []"
              :key="relation.objectId"
              cols="12"
              sm="6"
            >
              <v-card variant="outlined">
                <v-card-text>
                  <div class="font-weight-medium">
                    {{ relation.code }} ·
                    {{ relationshipLabels[relation.entity] }}
                  </div>
                  <div class="text-medium-emphasis">
                    {{ relation.operatingEntityName }}
                  </div>
                  <v-btn
                    v-if="vm.canOpenRelationship(relation.entity)"
                    class="mt-2"
                    size="small"
                    variant="text"
                    @click="
                      openRelationship(relation.entity, relation.objectId)
                    "
                    >查看关系</v-btn
                  >
                </v-card-text>
              </v-card>
            </v-col>
            <v-col
              v-if="!vm.detail?.relationships.length"
              cols="12"
              class="text-medium-emphasis"
              >没有当前权限可见的关系。</v-col
            >
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="vm.canMerge && !vm.detail?.mergedIntoPartyId"
            color="error"
            variant="tonal"
            :disabled="vm.isDirty"
            @click="vm.openMerge"
            >合并重复主体</v-btn
          >
          <v-spacer />
          <v-btn @click="vm.close">关闭</v-btn>
          <v-btn
            v-if="vm.canModify"
            color="primary"
            :loading="vm.saving"
            :disabled="!vm.form.legalName.trim()"
            @click="save"
            >保存共享身份</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="vm.mergeOpen" max-width="860" persistent>
      <v-card>
        <v-card-title>合并重复主体</v-card-title>
        <v-card-text>
          <v-alert type="warning" variant="tonal" class="mb-4">
            当前主体是来源主体；请选择最终保留的同类型主体。必须先完成服务端预检，任何资料或关系状态变化都会使预检失效。
          </v-alert>
          <v-row dense>
            <v-col cols="12" sm="8">
              <v-text-field
                v-model="vm.mergeTargetKeyword"
                label="按名称查找保留主体"
                @keyup.enter="vm.searchMergeTargets"
              />
            </v-col>
            <v-col cols="12" sm="4" class="d-flex align-center">
              <v-btn
                block
                variant="tonal"
                :loading="vm.loading"
                @click="vm.searchMergeTargets"
                >查找</v-btn
              >
            </v-col>
            <v-col cols="12">
              <v-select
                :model-value="vm.mergeTarget?.partyId"
                :items="
                  vm.mergeTargetRows.map((item) => ({
                    title: `${item.displayName} · ${item.legalName}`,
                    value: item.partyId,
                  }))
                "
                label="保留主体"
                no-data-text="请先查找同类型主体"
                @update:model-value="vm.selectMergeTarget"
              />
            </v-col>
          </v-row>
          <v-btn
            color="primary"
            variant="tonal"
            :disabled="!vm.mergeTarget"
            :loading="vm.saving"
            @click="vm.preflightMerge"
            >执行合并预检</v-btn
          >

          <template v-if="vm.mergePreflight">
            <v-alert
              v-if="vm.mergePreflight.blockReasons.length"
              type="error"
              variant="tonal"
              class="mt-4"
            >
              <div
                v-for="reason in vm.mergePreflight.blockReasons"
                :key="reason"
              >
                {{ reason }}
              </div>
            </v-alert>
            <v-alert v-else type="success" variant="tonal" class="mt-4"
              >预检通过。请核对并处理全部关系冲突。</v-alert
            >
            <v-card
              v-for="conflict in vm.mergePreflight.relationshipConflicts"
              :key="conflictKey(conflict)"
              class="mt-3"
              variant="outlined"
            >
              <v-card-text>
                <div class="font-weight-medium">
                  {{ relationshipLabels[conflict.relationshipType] }} ·
                  {{ conflict.operatingEntityName }}
                </div>
                <v-radio-group
                  :model-value="vm.mergeResolutions[conflictKey(conflict)]"
                  class="mt-2"
                  hide-details
                  @update:model-value="setConflictResolution(conflict, $event)"
                >
                  <v-radio
                    :label="`保留来源关系 ${conflict.sourceObjectCode}`"
                    :value="conflict.sourceObjectId"
                  />
                  <v-radio
                    :label="`保留目标关系 ${conflict.targetObjectCode}`"
                    :value="conflict.targetObjectId"
                  />
                </v-radio-group>
              </v-card-text>
            </v-card>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="vm.closeMerge">取消</v-btn>
          <v-btn
            v-if="vm.mergePreflight?.canMerge"
            color="error"
            :loading="vm.saving"
            @click="confirmMerge"
            >确认合并</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <AppSnackbar v-model="vm.errorMessage" color="error" />
    <AppSnackbar v-model="vm.successMessage" color="success" />
  </v-container>
</template>
