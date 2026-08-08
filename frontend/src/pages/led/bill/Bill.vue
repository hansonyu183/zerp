<script setup lang="ts">
import { onMounted } from 'vue'
import ReferenceAutocomplete from '@/components/common/ReferenceAutocomplete.vue'
import { formatReferenceLabel } from '@/utils/reference-label'
import { useBillLedgerViewModel } from './vm'
const vm = useBillLedgerViewModel()
const labels: Record<string, string> = {
  AVAILABLE: '可用',
  USED: '已使用',
  MATURED: '已到期',
  BANK_ACCEPTANCE: '银行承兑',
  COMMERCIAL_ACCEPTANCE: '商业承兑',
  CHECK: '支票',
  OTHER: '其他',
}
const partyTypeLabels: Record<string, string> = {
  customer: '客户',
  supplier: '供应商',
  'other-party': '其他往来方',
}
onMounted(() => void vm.load())
</script>
<template>
  <v-container fluid>
    <h1 class="text-h5 mb-4">票据台账</h1>
    <v-alert v-if="!vm.canQuery.value" type="warning" variant="tonal"
      >当前账号没有票据台账查询权限。</v-alert
    >
    <template v-else>
      <v-card class="mb-4"
        ><v-card-text class="d-flex flex-wrap ga-3 align-center">
          <v-select
            v-model="vm.filters.availability"
            clearable
            :items="[
              { title: '可用', value: 'AVAILABLE' },
              { title: '已使用', value: 'USED' },
              { title: '已到期', value: 'MATURED' },
            ]"
            label="持有状态"
            variant="outlined"
          />
          <v-select
            v-model="vm.filters.billType"
            clearable
            :items="[
              { title: '银行承兑', value: 'BANK_ACCEPTANCE' },
              { title: '商业承兑', value: 'COMMERCIAL_ACCEPTANCE' },
              { title: '支票', value: 'CHECK' },
              { title: '其他', value: 'OTHER' },
            ]"
            label="票据类型"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.filters.billNo"
            clearable
            label="票据号码"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.filters.maturityDateFrom"
            label="到期日起"
            type="date"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.filters.maturityDateTo"
            label="到期日止"
            type="date"
            variant="outlined"
          />
          <ReferenceAutocomplete
            label="来源往来方"
            :model-value="vm.selectedOriginatingParty.value"
            :options="vm.originatingPartyOptions.value"
            @search="vm.searchOriginatingParty"
            @update:model-value="vm.selectOriginatingParty"
          />
          <v-btn color="primary" @click="vm.search">查询</v-btn>
          <v-btn variant="tonal" @click="vm.maturityShortcut('30d')">未来30天到期</v-btn>
          <v-btn variant="tonal" @click="vm.maturityShortcut('7d')">未来7天到期</v-btn>
          <v-btn variant="tonal" @click="vm.maturityShortcut('today')">今日到期</v-btn>
          <v-btn variant="tonal" @click="vm.maturityShortcut('overdue')">已到期未处理</v-btn>
        </v-card-text></v-card
      >
      <v-alert
        v-if="vm.errorMessage.value"
        class="mb-3"
        type="error"
        variant="tonal"
        >{{ vm.errorMessage.value }}</v-alert
      >
      <v-table class="responsive-table"
        ><thead>
          <tr>
            <th>票据号码</th>
            <th>类型</th>
            <th>持有状态</th>
            <th>币种</th>
            <th>票面金额</th>
            <th>到期日</th>
            <th>来源往来方</th>
            <th>客户成本</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in vm.rows.value" :key="row.billId">
            <td data-label="票据号码">{{ row.billNo }}</td>
            <td data-label="类型">{{ labels[row.billType] ?? row.billType }}</td>
            <td data-label="持有状态">{{ labels[row.availability] ?? row.availability }}</td>
            <td data-label="币种">{{ row.currency }}</td>
            <td data-label="票面金额">{{ row.faceAmount }}</td>
            <td data-label="到期日">{{ row.maturityDate }}</td>
            <td data-label="来源往来方">
              {{
                row.originatingParty
                  ? `${partyTypeLabels[row.originatingParty.entity]} · ${formatReferenceLabel(row.originatingParty)}`
                  : '—'
              }}
            </td>
            <td data-label="客户成本">{{ row.customerCostAmount }}</td>
            <td data-label="来源">{{ row.sourceDocumentNo || '—' }}</td>
          </tr>
          <tr v-if="!vm.loading.value && vm.rows.value.length === 0">
            <td class="text-center py-8" colspan="9">暂无票据</td>
          </tr>
        </tbody></v-table
      >
      <v-pagination
        v-if="vm.total.value > vm.pageSize.value"
        class="mt-4"
        :length="Math.ceil(vm.total.value / vm.pageSize.value)"
        :model-value="vm.page.value"
        @update:model-value="vm.changePage"
      />
    </template>
  </v-container>
</template>
