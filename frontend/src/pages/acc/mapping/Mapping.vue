<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import { mappingEntities } from './entities'
import { createCurrentAccountingMappingViewModel } from './vm'

const vm = createCurrentAccountingMappingViewModel()
void vm.initialize()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <EntityListControls
      :keyword="''"
      :loading="vm.loading"
      :queryable="vm.canQuery"
      :searchable="false"
      filterable
      @apply-filters="vm.query()"
      @query="vm.query()"
      @reset-filters="vm.resetFilters"
    >
      <template #filters>
        <v-select
          v-model="vm.entityFilter"
          clearable
          density="comfortable"
          :items="mappingEntities"
          label="VOU 类型"
          variant="outlined"
          @update:model-value="vm.query()"
        />
      </template>
      <template #toolbar>
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
      </template>
    </EntityListControls>

    <v-alert class="mb-4" type="info" variant="tonal">
      此处只显示 ACC 当前有效的记账映射与字段规则。创建、候选、审批、版本和审计统一在“会计映射申报”中维护。
    </v-alert>

    <v-card title="当前 VOU 会计映射">
      <v-data-table-server
        :headers="[
          { title: 'VOU 类型', key: 'vouEntity' },
          { title: '当前版本', key: 'approval.versionNo' },
          { title: '默认结果', key: 'defaultResult' },
          { title: '规则', key: 'actions', sortable: false },
        ]"
        :items="vm.rows"
        :items-length="vm.total"
        :loading="vm.loading"
        :mobile-breakpoint="700"
        :page="vm.page"
        :items-per-page="vm.pageSize"
        @update:page="vm.changePage"
      >
        <template #[`item.defaultResult`]="{ item }">
          {{ item.defaultResult === 'POST' ? '生成凭证' : '忽略' }}
        </template>
        <template #[`item.actions`]="{ item }">
          <ListRowActions
            :actions="vm.canView ? [{ key: 'view', label: '查看当前规则', icon: 'mdi-eye-outline' }] : []"
            :label="`查看 ${item.vouEntity} 当前映射`"
            @select="vm.open(item)"
          />
        </template>
      </v-data-table-server>
    </v-card>
  </v-container>

  <v-navigation-drawer
    v-model="vm.detailOpen"
    location="end"
    temporary
    width="760"
  >
    <v-card class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        当前映射规则
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.close" />
      </v-card-title>
      <v-divider />
      <v-card-text v-if="vm.selected" class="pa-6">
        <v-list density="compact">
          <v-list-item title="VOU 类型" :subtitle="vm.selected.vouEntity" />
          <v-list-item title="当前版本" :subtitle="`V${vm.selected.approval.versionNo}`" />
          <v-list-item
            title="默认结果"
            :subtitle="vm.selected.defaultResult === 'POST' ? '生成凭证' : '忽略'"
          />
        </v-list>
        <v-alert class="my-4" density="compact" type="info" variant="tonal">
          <template v-if="vm.catalog">
            头字段：{{ vm.catalog.headerFields.join('、') }}；行集合：{{
              Object.keys(vm.catalog.collections).join('、')
            }}。
          </template>
        </v-alert>
        <v-textarea
          :model-value="JSON.stringify(vm.selected.definition, null, 2)"
          auto-grow
          label="当前声明式映射定义"
          readonly
          rows="20"
          spellcheck="false"
          variant="outlined"
        />
      </v-card-text>
    </v-card>
  </v-navigation-drawer>
</template>

<style scoped>
.mapping-filter {
  max-width: 280px;
  min-width: 220px;
}
</style>
