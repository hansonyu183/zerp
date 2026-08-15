<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import type { AccountingBook } from './api'
import { createAccountingBookViewModel } from './vm'

const vm = createAccountingBookViewModel()
const columns: readonly BusinessObjectColumn<AccountingBook>[] = [
  { key: 'code', label: '编码', value: (book) => book.code },
  { key: 'name', label: '名称', value: (book) => book.name },
  { key: 'description', label: '说明', value: (book) => book.description },
  {
    key: 'controlBook',
    label: '用途',
    value: (book) => (book.controlBook ? '业务控制' : '独立核算'),
  },
  { key: 'startMonth', label: '开始月份', value: (book) => book.startMonth },
  {
    key: 'subjectTemplate',
    label: '建账模板',
    value: (book) =>
      book.subjectTemplate === 'ENTERPRISE'
        ? '企业会计准则'
        : book.subjectTemplate === 'SMALL_BUSINESS'
          ? '小企业会计准则'
          : '空白',
  },
  {
    key: 'baseCurrency',
    label: '基础币种',
    value: (book) => book.baseCurrency,
  },
]

async function remove(book: AccountingBook): Promise<void> {
  if (!window.confirm(`确认删除账簿“${book.name}”吗？`)) return
  await vm.remove(book)
}

void vm.query()
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
      empty-text="暂无会计账簿"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(book) => book.bookId"
      :rows="vm.rows"
      search-label="编码或名称"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #cell-controlBook="{ row }">
        <v-chip
          :color="row.controlBook ? 'primary' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ row.controlBook ? '业务控制' : '独立核算' }}
        </v-chip>
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="[
            ...(vm.canEdit
              ? [
                  {
                    key: 'edit',
                    label: '编辑',
                    icon: 'mdi-pencil-outline',
                    color: 'primary',
                  },
                ]
              : []),
            ...(vm.canDelete(row)
              ? [
                  {
                    key: 'delete',
                    label: '删除',
                    icon: 'mdi-delete-outline',
                    color: 'error',
                  },
                ]
              : []),
          ]"
          :label="`操作 ${row.name}`"
          @select="$event === 'edit' ? vm.openEdit(row) : remove(row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    location="end"
    temporary
    width="680"
  >
    <v-card class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        {{ vm.editing ? '编辑会计账簿' : '新增会计账簿' }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.closeEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-alert
          v-if="vm.editing?.controlBook"
          class="mb-5"
          density="compact"
          type="info"
          variant="tonal"
        >
          这是永久业务控制账簿，不能更换或删除。
        </v-alert>
        <v-row>
          <v-col cols="12">
            <v-text-field
              v-model="vm.form.name"
              label="名称"
              required
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="vm.form.startMonth"
              :disabled="Boolean(vm.editing)"
              label="开始月份"
              required
              type="month"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.subjectTemplate"
              :disabled="Boolean(vm.editing)"
              :items="[
                { title: '企业会计准则', value: 'ENTERPRISE' },
                { title: '小企业会计准则', value: 'SMALL_BUSINESS' },
                { title: '空白', value: 'EMPTY' },
              ]"
              label="建账科目模板"
              required
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="vm.form.baseCurrency"
              label="基础币种"
              maxlength="3"
              required
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-textarea
              v-model="vm.form.description"
              auto-grow
              label="说明"
              rows="2"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-autocomplete
              v-model="vm.form.queryUserIds"
              chips
              clearable
              item-title="title"
              item-value="value"
              :items="vm.userOptions"
              label="可查询用户"
              multiple
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-autocomplete
              v-model="vm.form.operateUserIds"
              chips
              clearable
              hint="需要从界面查看并操作时，还应授予查询范围"
              item-title="title"
              item-value="value"
              :items="vm.userOptions"
              label="可操作用户"
              multiple
              persistent-hint
              variant="outlined"
            />
          </v-col>
        </v-row>
        <v-alert
          v-if="vm.validationError"
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
