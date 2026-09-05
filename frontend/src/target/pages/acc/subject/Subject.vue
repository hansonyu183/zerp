<script setup lang="ts">
import { reactive } from 'vue'
import type { AccSubject } from './vm.ts'
import {
  accDimensionOptions,
  accSettlementOptions,
  useAccSubjectViewModel,
} from './vm.ts'

const vm = reactive(useAccSubjectViewModel())
const dimensionLabels = new Map(
  accDimensionOptions.map((option) => [option.value, option.title]),
)

async function remove(subject: AccSubject): Promise<void> {
  if (!window.confirm(`确认删除科目“${subject.code} ${subject.name}”吗？`))
    return
  await vm.remove(subject)
}

void vm.initialize()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="acc-subject-page">
    <v-alert
      v-if="vm.error"
      type="error"
      class="mb-4"
      closable
      @click:close="vm.error = null"
      >{{ vm.error }}</v-alert
    >
    <v-alert
      v-if="vm.message"
      type="success"
      variant="tonal"
      class="mb-4"
      closable
      @click:close="vm.message = null"
      >{{ vm.message }}</v-alert
    >
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>会计科目</span><v-spacer />
        <v-select
          class="subject-book"
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
        <v-text-field
          v-model="vm.keyword"
          label="科目编码或名称"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="subject-search"
          @keyup.enter="vm.query(1)"
        />
        <v-btn variant="outlined" :loading="vm.loading" @click="vm.query(1)"
          >查询</v-btn
        >
        <v-btn
          v-if="vm.canCreate"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.openCreate"
          >新增科目</v-btn
        >
      </v-card-title>
      <v-divider />
      <v-data-table-server
        :headers="[
          { title: '编码', key: 'code' },
          { title: '名称', key: 'name' },
          { title: '余额方向', key: 'balanceDirection' },
          { title: '辅助核算', key: 'requiredDimensions' },
          { title: '数量核算', key: 'inventoryQuantity' },
          { title: '往来用途', key: 'settlementPurpose' },
          { title: '状态', key: 'enabled' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.items"
        :items-length="vm.total"
        :items-per-page="20"
        :page="vm.page"
        :loading="vm.loading"
        @update:page="vm.query"
      >
        <template #item.balanceDirection="{ item }">{{
          item.balanceDirection === 'DEBIT' ? '借' : '贷'
        }}</template>
        <template #item.requiredDimensions="{ item }">{{
          item.requiredDimensions
            .map((value) => dimensionLabels.get(value))
            .join('、') || '—'
        }}</template>
        <template #item.inventoryQuantity="{ item }">{{
          item.inventoryQuantity ? '是' : '否'
        }}</template>
        <template #item.settlementPurpose="{ item }">{{
          accSettlementOptions.find(
            (option) => option.value === item.settlementPurpose,
          )?.title
        }}</template>
        <template #item.enabled="{ item }"
          ><v-chip size="small" :color="item.enabled ? 'success' : 'default'">{{
            item.enabled ? '启用' : '停用'
          }}</v-chip></template
        >
        <template #item.actions="{ item }">
          <v-btn
            v-if="vm.canEdit"
            size="small"
            variant="text"
            @click="vm.openEdit(item)"
            >编辑</v-btn
          >
          <v-btn
            v-if="vm.canDelete"
            size="small"
            color="error"
            variant="text"
            @click="remove(item)"
            >删除</v-btn
          >
        </template>
        <template #no-data>当前账簿暂无会计科目。</template>
      </v-data-table-server>
    </v-card>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    location="end"
    temporary
    width="720"
  >
    <v-card flat class="h-100">
      <v-card-title class="d-flex align-center px-6 py-5"
        >{{ vm.editing ? '编辑会计科目' : '新增会计科目' }}<v-spacer /><v-btn
          icon="mdi-close"
          variant="text"
          @click="vm.closeEditor"
      /></v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-row>
          <v-col cols="12" md="5"
            ><v-text-field
              v-model="vm.form.code"
              label="科目编码"
              maxlength="64"
              variant="outlined"
          /></v-col>
          <v-col cols="12" md="7"
            ><v-text-field
              v-model="vm.form.name"
              label="科目名称"
              maxlength="200"
              variant="outlined"
          /></v-col>
          <v-col cols="12"
            ><v-autocomplete
              v-model="vm.form.parentId"
              :items="vm.parentOptions"
              item-title="title"
              item-value="value"
              label="上级科目"
              clearable
              variant="outlined"
          /></v-col>
          <v-col cols="12" md="6"
            ><v-select
              v-model="vm.form.balanceDirection"
              :items="[
                { title: '借', value: 'DEBIT' },
                { title: '贷', value: 'CREDIT' },
              ]"
              label="余额方向"
              variant="outlined"
          /></v-col>
          <v-col cols="12" md="6"
            ><v-select
              v-model="vm.form.settlementPurpose"
              :items="accSettlementOptions"
              item-title="title"
              item-value="value"
              label="往来用途"
              variant="outlined"
          /></v-col>
          <v-col cols="12"
            ><v-select
              v-model="vm.form.requiredDimensions"
              :items="accDimensionOptions"
              item-title="title"
              item-value="value"
              label="必填辅助核算"
              multiple
              chips
              variant="outlined"
          /></v-col>
          <v-col cols="12" md="6"
            ><v-switch
              v-model="vm.form.inventoryQuantity"
              label="登记库存数量账"
              color="primary"
          /></v-col>
          <v-col cols="12" md="6"
            ><v-switch v-model="vm.form.enabled" label="启用" color="primary"
          /></v-col>
        </v-row>
        <v-alert
          v-if="vm.validationError"
          type="warning"
          variant="tonal"
          density="compact"
          >{{ vm.validationError }}</v-alert
        >
      </v-card-text>
      <v-card-actions class="px-6 pb-6"
        ><v-spacer /><v-btn variant="text" @click="vm.closeEditor">取消</v-btn
        ><v-btn
          color="primary"
          :disabled="!vm.canSubmit"
          :loading="vm.saving"
          @click="vm.submit"
          >保存</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-navigation-drawer>
</template>

<style scoped>
.subject-book {
  min-width: min(22rem, 70vw);
  max-width: 22rem;
}
.subject-search {
  min-width: min(20rem, 70vw);
  max-width: 20rem;
}
</style>
