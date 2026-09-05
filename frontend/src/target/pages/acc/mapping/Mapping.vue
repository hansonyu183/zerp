<script setup lang="ts">
import { reactive } from 'vue'
import { useAccMappingViewModel } from './vm.ts'
const vm = reactive(useAccMappingViewModel())
void vm.initialize()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="acc-mapping-page">
    <v-alert
      v-if="vm.error"
      type="error"
      class="mb-4"
      closable
      @click:close="vm.error = null"
      >{{ vm.error }}</v-alert
    >
    <v-alert type="info" variant="tonal" class="mb-4"
      >这里只显示 ACC
      当前最新已批准映射；候选、版本与审批在“会计映射申报”维护。</v-alert
    >
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>当前会计映射</span><v-spacer />
        <v-btn
          v-if="vm.canMaintain"
          :to="vm.maintenanceRoute"
          variant="outlined"
          prepend-icon="mdi-pencil"
        >
          维护记账映射
        </v-btn>
        <v-select
          class="mapping-filter"
          :items="vm.bookOptions"
          item-title="title"
          item-value="value"
          label="会计账簿"
          density="compact"
          variant="outlined"
          hide-details
          :model-value="vm.selectedBookId"
          @update:model-value="vm.selectBook"
        />
        <v-select
          v-model="vm.vouEntity"
          class="mapping-filter"
          :items="vm.entityOptions"
          item-title="title"
          item-value="value"
          label="VOU 类型"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          @update:model-value="vm.query(1)"
        />
      </v-card-title>
      <v-divider />
      <v-data-table-server
        :headers="[
          { title: 'VOU 类型', key: 'vouEntity' },
          { title: '当前版本', key: 'approval.versionNo' },
          { title: '默认结果', key: 'defaultResult' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.items"
        :items-length="vm.total"
        :items-per-page="20"
        :page="vm.page"
        :loading="vm.loading"
        @update:page="vm.query"
      >
        <template #item.vouEntity="{ item }"
          >{{ item.vouEntity.code }} · {{ item.vouEntity.name }}</template
        >
        <template #item.defaultResult="{ item }">{{
          item.defaultResult === 'POST' ? '生成凭证' : '忽略'
        }}</template>
        <template #item.actions="{ item }"
          ><v-btn
            v-if="vm.canView"
            size="small"
            variant="text"
            @click="vm.open(item)"
            >查看当前规则</v-btn
          ></template
        >
        <template #no-data>当前账簿暂无已批准会计映射。</template>
      </v-data-table-server>
    </v-card>
  </v-container>

  <v-navigation-drawer
    v-model="vm.detailOpen"
    location="end"
    temporary
    width="760"
  >
    <v-card flat class="h-100">
      <v-card-title class="d-flex align-center px-6 py-5"
        >当前映射规则<v-spacer /><v-btn
          icon="mdi-close"
          variant="text"
          @click="vm.close"
      /></v-card-title>
      <v-divider />
      <v-card-text v-if="vm.detail" class="pa-6">
        <v-list density="compact">
          <v-list-item
            title="VOU 类型"
            :subtitle="`${vm.detail.vouEntity.code} · ${vm.detail.vouEntity.name}`"
          />
          <v-list-item
            title="Approval Entry"
            :subtitle="vm.detail.approvalEntryId"
          />
          <v-list-item
            title="默认结果"
            :subtitle="vm.detail.defaultResult === 'POST' ? '生成凭证' : '忽略'"
          />
        </v-list>
        <h3 class="text-subtitle-1 mt-4">匹配规则</h3>
        <v-table density="compact"
          ><thead>
            <tr>
              <th>顺序</th>
              <th>条件数</th>
              <th>结果</th>
              <th>模板</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(rule, index) in vm.detail.definition.rules"
              :key="index"
            >
              <td>{{ index + 1 }}</td>
              <td>{{ rule.conditions.length }}</td>
              <td>{{ rule.result === 'POST' ? '生成凭证' : '忽略' }}</td>
              <td>{{ rule.templateId ?? '—' }}</td>
            </tr>
          </tbody></v-table
        >
        <h3 class="text-subtitle-1 mt-5">凭证模板</h3>
        <v-expansion-panels
          ><v-expansion-panel
            v-for="template in vm.detail.definition.templates"
            :key="template.templateId"
            :title="template.templateId"
            ><v-expansion-panel-text
              ><v-table density="compact"
                ><thead>
                  <tr>
                    <th>科目来源</th>
                    <th>方向</th>
                    <th>金额字段</th>
                    <th>币种字段</th>
                    <th>数量字段</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(line, index) in template.lines" :key="index">
                    <td>{{ line.subjectSource }} · {{ line.subjectValue }}</td>
                    <td>{{ line.direction === 'DEBIT' ? '借' : '贷' }}</td>
                    <td>{{ line.amountField }}</td>
                    <td>{{ line.currencyField }}</td>
                    <td>{{ line.quantityField ?? '—' }}</td>
                  </tr>
                </tbody></v-table
              ></v-expansion-panel-text
            ></v-expansion-panel
          ></v-expansion-panels
        >
      </v-card-text>
    </v-card>
  </v-navigation-drawer>
</template>

<style scoped>
.mapping-filter {
  min-width: min(20rem, 70vw);
  max-width: 20rem;
}
</style>
