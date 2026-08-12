<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import type { AccountingSubject } from './api'
import {
  createAccountingSubjectViewModel,
  dimensionOptions,
  settlementOptions,
} from './vm'

const vm = createAccountingSubjectViewModel()
const dimensionLabels = new Map(
  dimensionOptions.map((option) => [option.value, option.title]),
)
const columns: readonly BusinessObjectColumn<AccountingSubject>[] = [
  { key: 'code', label: '编码', value: (subject) => subject.code },
  { key: 'name', label: '名称', value: (subject) => subject.name },
  {
    key: 'balanceDirection',
    label: '余额方向',
    value: (subject) => (subject.balanceDirection === 'DEBIT' ? '借' : '贷'),
  },
  {
    key: 'requiredDimensions',
    label: '辅助核算',
    value: (subject) =>
      subject.requiredDimensions
        .map((dimension) => dimensionLabels.get(dimension) ?? dimension)
        .join('、'),
  },
  {
    key: 'inventoryQuantity',
    label: '数量核算',
    value: (subject) => (subject.inventoryQuantity ? '是' : '否'),
  },
  {
    key: 'enabled',
    label: '状态',
    value: (subject) => (subject.enabled ? '启用' : '停用'),
  },
]

async function remove(subject: AccountingSubject): Promise<void> {
  if (!window.confirm(`确认删除科目“${subject.code} ${subject.name}”吗？`))
    return
  await vm.remove(subject)
}

void vm.initialize()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <BusinessObjectList
      :columns="columns"
      :creatable="vm.canCreate"
      :deletable="vm.canDelete"
      :editable="vm.canEdit"
      empty-text="当前账簿暂无会计科目"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(subject) => subject.subjectId"
      :rows="vm.rows"
      search-label="科目编码或名称"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
    >
      <template #toolbar>
        <v-select
          class="subject-book-select"
          density="compact"
          hide-details
          item-title="title"
          item-value="value"
          :items="vm.bookOptions"
          label="会计账簿"
          :model-value="vm.selectedBookId"
          variant="outlined"
          @update:model-value="vm.selectBook($event)"
        />
      </template>
      <template #cell-code="{ row }">
        <span :class="{ 'text-medium-emphasis': !row.leaf }">
          {{ row.code }}
        </span>
      </template>
      <template #cell-enabled="{ row }">
        <v-chip
          :color="row.enabled ? 'success' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ row.enabled ? '启用' : '停用' }}
        </v-chip>
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :label="`操作 ${row.code}`"
          :more="
            vm.canDelete(row)
              ? [
                  {
                    key: 'delete',
                    label: '删除',
                    icon: 'mdi-delete-outline',
                    color: 'error',
                  },
                ]
              : []
          "
          :primary="
            vm.canEdit
              ? [
                  {
                    key: 'edit',
                    label: '编辑',
                    icon: 'mdi-pencil-outline',
                    color: 'primary',
                  },
                ]
              : []
          "
          @select="$event === 'edit' ? vm.openEdit(row) : remove(row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    location="end"
    temporary
    width="720"
  >
    <v-card class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        {{ vm.editing ? '编辑会计科目' : '新增会计科目' }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.closeEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-alert
          v-if="vm.editing?.referenced"
          class="mb-5"
          density="compact"
          type="info"
          variant="tonal"
        >
          此科目已被引用，只能停用，结构字段已锁定。
        </v-alert>
        <v-row>
          <v-col cols="12" md="5">
            <v-text-field
              v-model="vm.form.code"
              :disabled="vm.editing?.referenced"
              label="科目编码"
              required
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="7">
            <v-text-field
              v-model="vm.form.name"
              :disabled="vm.editing?.referenced"
              label="科目名称"
              required
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-autocomplete
              v-model="vm.form.parentSubjectId"
              clearable
              :disabled="vm.editing?.referenced"
              item-title="title"
              item-value="value"
              :items="vm.parentOptions"
              label="上级科目"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.balanceDirection"
              :disabled="vm.editing?.referenced"
              :items="[
                { title: '借', value: 'DEBIT' },
                { title: '贷', value: 'CREDIT' },
              ]"
              label="余额方向"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.settlementPurpose"
              :disabled="vm.editing?.referenced"
              item-title="title"
              item-value="value"
              :items="settlementOptions"
              label="往来用途"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-select
              v-model="vm.form.requiredDimensions"
              chips
              :disabled="vm.editing?.referenced"
              item-title="title"
              item-value="value"
              :items="dimensionOptions"
              label="必填辅助核算"
              multiple
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-switch
              v-model="vm.form.inventoryQuantity"
              color="primary"
              :disabled="vm.editing?.referenced"
              hide-details
              label="登记库存数量账"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-switch
              v-model="vm.form.enabled"
              color="primary"
              hide-details
              label="启用"
            />
          </v-col>
        </v-row>
        <v-alert
          v-if="vm.validationError"
          class="mt-4"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ vm.validationError }}
        </v-alert>
      </v-card-text>
      <v-card-actions class="px-6 pb-6">
        <v-spacer />
        <v-btn variant="text" @click="vm.closeEditor">取消</v-btn>
        <v-btn
          color="primary"
          :disabled="!vm.canSubmit"
          :loading="vm.saving"
          @click="vm.save"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>
</template>

<style scoped>
.subject-book-select {
  min-width: min(360px, 80vw);
}
</style>
