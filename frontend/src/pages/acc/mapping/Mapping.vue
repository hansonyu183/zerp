<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { mappingEntities, createAccountingMappingViewModel } from './vm'
import type { AccountingMapping } from './api'

const vm = createAccountingMappingViewModel()

function actions(mapping: AccountingMapping) {
  if (mapping.state === 'DRAFT') {
    return [
      vm.canEdit ? { title: '编辑', action: () => vm.openEdit(mapping) } : null,
      vm.canApprove
        ? { title: '批准', action: () => vm.changeState(mapping, true) }
        : null,
    ].filter((action) => action !== null)
  }
  return [
    vm.canCreate
      ? { title: '基于此版本新建', action: () => vm.openCreate(mapping) }
      : null,
    vm.canUnapprove
      ? { title: '反批准', action: () => vm.changeState(mapping, false) }
      : null,
  ].filter((action) => action !== null)
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
    <v-card>
      <v-card-title class="d-flex align-center ga-3 flex-wrap pa-5">
        <span>VOU 会计映射</span>
        <v-spacer />
        <v-select
          class="mapping-filter"
          density="compact"
          hide-details
          item-title="title"
          item-value="value"
          :items="vm.bookOptions"
          label="会计账簿"
          :model-value="vm.selectedBookId"
          variant="outlined"
          @update:model-value="vm.changeBook"
        />
        <v-select
          v-model="vm.entityFilter"
          class="mapping-filter"
          clearable
          density="compact"
          hide-details
          :items="mappingEntities"
          label="VOU 类型"
          variant="outlined"
          @update:model-value="vm.query()"
        />
        <v-btn
          color="primary"
          :disabled="!vm.canCreate"
          prepend-icon="mdi-plus"
          @click="vm.openCreate()"
        >
          新建版本
        </v-btn>
      </v-card-title>
      <v-data-table-server
        class="mapping-table"
        :headers="[
          { title: 'VOU 类型', key: 'vouEntity' },
          { title: '版本', key: 'version' },
          { title: '状态', key: 'state' },
          { title: '默认结果', key: 'defaultResult' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.rows"
        :items-length="vm.total"
        :loading="vm.loading"
        :mobile-breakpoint="700"
        :page="vm.page"
        :items-per-page="vm.pageSize"
        @update:page="vm.changePage"
      >
        <template #[`item.state`]="{ item }">
          <v-chip
            :color="item.state === 'APPROVED' ? 'success' : 'warning'"
            size="small"
            variant="tonal"
          >
            {{ item.state === 'APPROVED' ? '已批准' : '草稿' }}
          </v-chip>
        </template>
        <template #[`item.defaultResult`]="{ item }">
          {{ item.defaultResult === 'POST' ? '生成凭证' : '忽略' }}
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            v-for="action in actions(item)"
            :key="action.title"
            class="mr-2"
            size="small"
            variant="text"
            @click="action.action"
          >
            {{ action.title }}
          </v-btn>
        </template>
      </v-data-table-server>
    </v-card>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    location="end"
    temporary
    width="760"
  >
    <v-card class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        {{ vm.editing ? '编辑映射草稿' : '新建映射版本' }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.closeEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-row>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.vouEntity"
              :disabled="Boolean(vm.editing)"
              :items="mappingEntities"
              label="VOU 单据类型"
              variant="outlined"
              @update:model-value="vm.loadCatalog"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.defaultResult"
              :items="[
                { title: 'POST · 生成凭证', value: 'POST' },
                { title: 'UN_POST · 忽略', value: 'UN_POST' },
              ]"
              label="未命中规则时"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-alert density="compact" type="info" variant="tonal">
              仅支持声明式字段映射，不执行脚本或任意表达式。条件操作符：EQ、NE、IN、NOT_IN、IS_EMPTY、IS_NOT_EMPTY。
              <template v-if="vm.catalog">
                头字段：{{ vm.catalog.headerFields.join('、') }}；行集合：{{
                  Object.keys(vm.catalog.collections).join('、')
                }}。
              </template>
            </v-alert>
          </v-col>
          <v-col cols="12">
            <v-textarea
              v-model="vm.form.definitionText"
              auto-grow
              label="声明式映射定义（JSON）"
              rows="20"
              spellcheck="false"
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
          >保存</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>
</template>

<style scoped>
.mapping-filter {
  max-width: 280px;
  min-width: 220px;
}
</style>
