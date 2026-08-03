<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'

interface Reference {
  name: string
  code: string
}
interface Asset {
  assetId: string
  assetNo: string
  assetName: string
  specification?: string
  category: Reference
  department: Reference
  custodian?: Reference
  location?: string
  acquisitionDate: string
  depreciationStartMonth: string
  originalValue: string
  residualValue: string
  usefulLifeMonths: number
  accumulatedDepreciation: string
  netValue: string
  lastDepreciationMonth?: string
  status: string
  remark?: string
}
interface History {
  id: string
  entryType: string
  sourceDocumentNo: string
  effectiveDate: string
  amount: string
  statusFrom?: string
  statusTo?: string
}
interface Detail {
  asset: Asset
  history: History[]
}
interface AssetQueryRequest {
  page: number
  pageSize: number
  filters: { keyword: string; status: string[] }
}
interface AssetGetRequest {
  assetId: string
}
const rows = ref<Asset[]>([]),
  total = ref(0),
  page = ref(1),
  pageSize = ref(20),
  keyword = ref(''),
  status = ref<string[]>([])
const loading = ref(false),
  errorMessage = ref(''),
  detail = ref<Detail | null>(null),
  detailOpen = ref(false)
const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / pageSize.value)),
)
const statusOptions = [
  { title: '在用', value: 'ACTIVE' },
  { title: '已出让', value: 'SOLD' },
  { title: '已清算', value: 'RETIRED' },
]
function statusLabel(value: string) {
  return statusOptions.find((x) => x.value === value)?.title ?? value
}
async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await apiClient.post<PageResult<Asset>, AssetQueryRequest>(
      'led/asset/query',
      {
        page: page.value,
        pageSize: pageSize.value,
        filters: { keyword: keyword.value.trim(), status: status.value },
      },
    )
    rows.value = data.items
    total.value = data.total
  } catch (e) {
    errorMessage.value = getErrorMessage(e)
  } finally {
    loading.value = false
  }
}
async function open(row: Asset) {
  loading.value = true
  try {
    const { data } = await apiClient.post<Detail, AssetGetRequest>(
      'led/asset/get',
      {
        assetId: row.assetId,
      },
    )
    detail.value = data
    detailOpen.value = true
  } catch (e) {
    errorMessage.value = getErrorMessage(e)
  } finally {
    loading.value = false
  }
}
function search() {
  page.value = 1
  void load()
}
function updatePage(value: number) {
  page.value = value
  void load()
}
function updatePageSize(value: number) {
  pageSize.value = value
  page.value = 1
  void load()
}
onMounted(load)
</script>
<template>
  <v-container fluid>
    <div class="d-flex align-center justify-space-between mb-4">
      <div>
        <h1 class="text-h5">固定资产台账</h1>
        <div class="text-medium-emphasis">查询资产卡片、折旧余额与处置历史</div>
      </div>
      <v-btn prepend-icon="mdi-refresh" variant="tonal" @click="load"
        >刷新</v-btn
      >
    </div>
    <v-card
      ><v-card-text
        ><div class="asset-filters">
          <v-text-field
            v-model="keyword"
            clearable
            hide-details
            label="资产编号或名称"
            variant="outlined"
            @keyup.enter="search"
          /><v-select
            v-model="status"
            chips
            clearable
            hide-details
            :items="statusOptions"
            label="状态"
            multiple
            variant="outlined"
          /><v-btn color="primary" size="large" @click="search">查询</v-btn>
        </div>
        <v-alert
          v-if="errorMessage"
          class="mt-3"
          type="error"
          variant="tonal"
          >{{ errorMessage }}</v-alert
        ></v-card-text
      >
      <v-data-table-server
        :headers="[
          { title: '资产编号', key: 'assetNo' },
          { title: '资产名称', key: 'assetName' },
          { title: '类别', key: 'category.name' },
          { title: '部门', key: 'department.name' },
          { title: '购置日期', key: 'acquisitionDate' },
          { title: '原值', key: 'originalValue', align: 'end' },
          { title: '累计折旧', key: 'accumulatedDepreciation', align: 'end' },
          { title: '净值', key: 'netValue', align: 'end' },
          { title: '状态', key: 'status' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="rows"
        :items-length="total"
        :loading="loading"
        :items-per-page="pageSize"
        :page="page"
        @update:page="updatePage"
        @update:items-per-page="updatePageSize"
      >
        <template #[`item.status`]="{ value }"
          ><v-chip size="small" variant="tonal">{{
            statusLabel(String(value))
          }}</v-chip></template
        ><template #[`item.actions`]="{ item }"
          ><v-btn size="small" variant="text" @click="open(item)"
            >详情</v-btn
          ></template
        >
      </v-data-table-server>
      <div class="text-caption text-medium-emphasis pa-3">
        共 {{ total }} 项，共 {{ pageCount }} 页
      </div></v-card
    >
    <v-dialog v-model="detailOpen" max-width="960"
      ><v-card v-if="detail"
        ><v-card-title
          >{{ detail.asset.assetNo }} ·
          {{ detail.asset.assetName }}</v-card-title
        ><v-card-text
          ><v-row dense
            ><v-col
              v-for="item in [
                { l: '资产类别', v: detail.asset.category.name },
                { l: '使用部门', v: detail.asset.department.name },
                { l: '保管人', v: detail.asset.custodian?.name || '-' },
                { l: '原值', v: detail.asset.originalValue },
                { l: '残值', v: detail.asset.residualValue },
                { l: '累计折旧', v: detail.asset.accumulatedDepreciation },
                { l: '净值', v: detail.asset.netValue },
                {
                  l: '最近折旧月',
                  v: detail.asset.lastDepreciationMonth || '-',
                },
              ]"
              :key="item.l"
              cols="12"
              md="3"
              ><div class="text-caption text-medium-emphasis">{{ item.l }}</div>
              <div>{{ item.v }}</div></v-col
            ></v-row
          ><v-divider class="my-4" />
          <h3 class="mb-2">变动历史</h3>
          <v-table density="compact"
            ><thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>来源单据</th>
                <th>金额</th>
                <th>状态变化</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in detail.history" :key="entry.id">
                <td>{{ entry.effectiveDate }}</td>
                <td>{{ entry.entryType }}</td>
                <td>{{ entry.sourceDocumentNo }}</td>
                <td>{{ entry.amount }}</td>
                <td>
                  {{ entry.statusFrom || '-' }} → {{ entry.statusTo || '-' }}
                </td>
              </tr>
            </tbody></v-table
          ></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn @click="detailOpen = false"
            >关闭</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
  </v-container>
</template>
<style scoped>
.asset-filters {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(260px, 1fr) auto;
  gap: 12px;
  align-items: center;
}
@media (max-width: 800px) {
  .asset-filters {
    grid-template-columns: 1fr;
  }
}
</style>
