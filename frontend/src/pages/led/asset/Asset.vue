<script setup lang="ts">
import { onMounted } from 'vue'
import { assetStatusOptions, useAssetLedgerViewModel } from './vm'

const vm = useAssetLedgerViewModel()
onMounted(vm.load)
</script>
<template>
  <v-container fluid>
    <div class="d-flex align-center justify-space-between mb-4">
      <div>
        <h1 class="text-h5">固定资产台账</h1>
        <div class="text-medium-emphasis">查询资产卡片、折旧余额与处置历史</div>
      </div>
      <v-btn prepend-icon="mdi-refresh" variant="tonal" @click="vm.load"
        >刷新</v-btn
      >
    </div>
    <v-card
      ><v-card-text
        ><div class="asset-filters">
          <v-text-field
            v-model="vm.keyword.value"
            clearable
            hide-details
            label="资产编号或名称"
            variant="outlined"
            @keyup.enter="vm.search"
          /><v-select
            v-model="vm.status.value"
            chips
            clearable
            hide-details
            :items="assetStatusOptions"
            label="状态"
            multiple
            variant="outlined"
          /><v-btn color="primary" size="large" @click="vm.search">查询</v-btn>
        </div>
        <v-alert
          v-if="vm.errorMessage.value"
          class="mt-3"
          type="error"
          variant="tonal"
          >{{ vm.errorMessage.value }}</v-alert
        ></v-card-text
      >
      <div class="responsive-table-wrap">
        <v-table class="asset-ledger__table responsive-table">
          <thead>
            <tr>
              <th>资产编号</th>
              <th>资产名称</th>
              <th>类别</th>
              <th>部门</th>
              <th>购置日期</th>
              <th class="text-end">原值</th>
              <th class="text-end">累计折旧</th>
              <th class="text-end">净值</th>
              <th>状态</th>
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in vm.rows.value" :key="row.assetId">
              <td data-label="资产编号">{{ row.assetNo }}</td>
              <td data-label="资产名称">{{ row.assetName }}</td>
              <td data-label="类别">{{ row.category.name }}</td>
              <td data-label="部门">{{ row.department.name }}</td>
              <td data-label="购置日期">{{ row.acquisitionDate }}</td>
              <td class="text-end" data-label="原值">
                {{ row.originalValue }}
              </td>
              <td class="text-end" data-label="累计折旧">
                {{ row.accumulatedDepreciation }}
              </td>
              <td class="text-end" data-label="净值">{{ row.netValue }}</td>
              <td data-label="状态">
                <v-chip size="small" variant="tonal">{{
                  vm.statusLabel(row.status)
                }}</v-chip>
              </td>
              <td class="text-end responsive-table__actions" data-label="操作">
                <v-btn
                  :disabled="!vm.canGet.value"
                  size="small"
                  variant="text"
                  @click="vm.open(row)"
                  >详情</v-btn
                >
              </td>
            </tr>
            <tr
              v-if="!vm.loading.value && vm.rows.value.length === 0"
              class="responsive-table__empty-row"
            >
              <td class="text-center text-medium-emphasis" colspan="10">
                暂无固定资产
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-progress-linear v-if="vm.loading.value" indeterminate />
      </div>
      <v-card-actions class="asset-ledger__pagination">
        <span>共 {{ vm.total.value }} 项</span>
        <v-select
          density="compact"
          hide-details
          :items="[20, 50, 100, 200]"
          label="每页"
          :model-value="vm.pageSize.value"
          variant="outlined"
          @update:model-value="vm.updatePageSize(Number($event))"
        />
        <v-btn
          aria-label="上一页"
          :disabled="vm.page.value <= 1 || vm.loading.value"
          icon="mdi-chevron-left"
          variant="text"
          @click="vm.updatePage(vm.page.value - 1)"
        />
        <span>第 {{ vm.page.value }} / {{ vm.pageCount.value }} 页</span>
        <v-btn
          aria-label="下一页"
          :disabled="vm.page.value >= vm.pageCount.value || vm.loading.value"
          icon="mdi-chevron-right"
          variant="text"
          @click="vm.updatePage(vm.page.value + 1)"
        /> </v-card-actions
    ></v-card>
    <v-dialog v-model="vm.detailOpen.value" max-width="960"
      ><v-card v-if="vm.detail.value"
        ><v-card-title
          >{{ vm.detail.value.asset.assetNo }} ·
          {{ vm.detail.value.asset.assetName }}</v-card-title
        ><v-card-text
          ><v-row dense
            ><v-col
              v-for="item in [
                { l: '资产类别', v: vm.detail.value.asset.category.name },
                { l: '使用部门', v: vm.detail.value.asset.department.name },
                {
                  l: '保管人',
                  v: vm.detail.value.asset.custodian?.name || '-',
                },
                { l: '原值', v: vm.detail.value.asset.originalValue },
                { l: '残值', v: vm.detail.value.asset.residualValue },
                {
                  l: '累计折旧',
                  v: vm.detail.value.asset.accumulatedDepreciation,
                },
                { l: '净值', v: vm.detail.value.asset.netValue },
                {
                  l: '最近折旧月',
                  v: vm.detail.value.asset.lastDepreciationMonth || '-',
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
              <tr v-for="entry in vm.detail.value.history" :key="entry.id">
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
          ><v-spacer /><v-btn @click="vm.detailOpen.value = false"
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
.asset-ledger__table {
  min-width: 1180px;
}
.asset-ledger__pagination {
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.asset-ledger__pagination :deep(.v-select) {
  flex: 0 0 112px;
}
@media (max-width: 800px) {
  .asset-filters {
    grid-template-columns: 1fr;
  }
  .asset-ledger__pagination {
    flex-wrap: wrap;
    justify-content: center;
  }
}
</style>
