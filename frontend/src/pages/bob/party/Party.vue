<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { components } from '@/api/generated/schema'
import { usePartyViewModel } from './vm'

const vm = reactive(usePartyViewModel())
const router = useRouter()
type PartyListItem = components['schemas']['PartyListItem']
const columns: readonly BusinessObjectColumn<PartyListItem>[] = [
  { key: 'displayName', label: '显示名称', value: (row) => row.displayName },
  { key: 'legalName', label: '法定名称', value: (row) => row.legalName },
  { key: 'kind', label: '类型', value: (row) => row.kind, sizing: 'compact' },
]
const kindItems = [
  { title: '个人', value: 'PERSON' },
  { title: '组织', value: 'ORGANIZATION' },
]
const relationshipLabels: Record<
  components['schemas']['PartyRelationshipCard']['entity'],
  string
> = {
  customer: '客户关系',
  supplier: '供应关系',
  employee: '雇佣关系',
  'other-unit': '服务关系',
  'sales-partner': '销售合作关系',
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
  <v-container fluid class="pa-3 pa-md-6"
    ><v-card
      ><v-card-title>主体（当前档案）</v-card-title
      ><v-card-text>
        <BusinessObjectList
          :columns="columns"
          :editable="vm.canGet"
          empty-text="暂无当前主体"
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
          <template #filters
            ><v-select
              v-model="vm.kindDraft"
              :items="kindItems"
              label="主体类型"
              clearable
              hide-details
          /></template>
          <template #cell-kind="{ row }">{{
            row.kind === 'PERSON' ? '个人' : '组织'
          }}</template>
          <template #actions="{ row }"
            ><ListRowActions
              :actions="[
                {
                  key: 'open',
                  label: `查看 ${row.displayName}`,
                  icon: 'mdi-eye-outline',
                },
              ]"
              :label="`操作 ${row.displayName}`"
              @select="vm.open(row)"
          /></template>
        </BusinessObjectList> </v-card-text
    ></v-card>
    <v-dialog v-model="vm.detailOpen" max-width="820"
      ><v-card
        ><v-card-title>主体当前档案</v-card-title
        ><v-card-text>
          <v-alert type="info" variant="tonal" class="mb-4"
            >当前档案只读；维护共享身份、候选和审批请进入主体申报。</v-alert
          >
          <v-row dense
            ><v-col cols="12" sm="4"
              ><strong>类型：</strong
              >{{ vm.detail?.kind === 'PERSON' ? '个人' : '组织' }}</v-col
            ><v-col cols="12" sm="8"
              ><strong>法定名称：</strong>{{ vm.detail?.legalName }}</v-col
            ><v-col cols="12" sm="6"
              ><strong>显示名称：</strong>{{ vm.detail?.displayName }}</v-col
            ><v-col cols="12" sm="6"
              ><strong>税号：</strong>{{ vm.detail?.taxNumber || '—' }}</v-col
            ><v-col cols="12"
              ><strong>强标识：</strong
              >{{
                vm.detail?.strongIdentifiers
                  .map((item) => item.value)
                  .join('、') || '—'
              }}</v-col
            ></v-row
          >
          <div class="text-subtitle-1 mt-5 mb-2">当前可见关系</div>
          <v-row dense
            ><v-col
              v-for="relation in vm.detail?.relationships ?? []"
              :key="relation.objectId"
              cols="12"
              sm="6"
              ><v-card variant="outlined"
                ><v-card-text
                  ><div class="font-weight-medium">
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
                  ></v-card-text
                ></v-card
              ></v-col
            ><v-col
              v-if="!vm.detail?.relationships.length"
              cols="12"
              class="text-medium-emphasis"
              >没有当前权限可见的关系。</v-col
            ></v-row
          > </v-card-text
        ><v-card-actions
          ><v-btn
            :to="{
              path: '/dcl/party',
              query: { partyId: vm.detail?.partyId, mode: 'view' },
            }"
            variant="tonal"
            >查看主体申报</v-btn
          ><v-spacer /><v-btn @click="vm.close">关闭</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
    <AppSnackbar v-model="vm.errorMessage" color="error" />
  </v-container>
</template>
