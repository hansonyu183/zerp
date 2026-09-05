<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { approvalStatusPresentation } from '@zerp/model'
import { useRouter } from 'vue-router'
import {
  useDashboardViewModel,
  workbenchEntityLabel,
  workbenchEntityOptions,
  type WorkbenchAction,
  type WorkbenchItem,
} from './vm.ts'

const vm = reactive(useDashboardViewModel())
const router = useRouter()
async function act(
  action: WorkbenchAction,
  item: WorkbenchItem,
): Promise<void> {
  if (action === 'view' || action === 'edit') {
    await router.push(vm.itemHref(item, action))
    return
  }
  if (action === 'delete') {
    await vm.remove(item)
    return
  }
  await vm.review(item, action)
}
onMounted(() => vm.query('DOCUMENT', 1))
</script>

<template>
  <v-container fluid class="pa-4 pa-md-7">
    <v-card rounded="xl" variant="flat">
      <v-tabs
        :model-value="vm.activeTab"
        color="primary"
        @update:model-value="
          (value) => vm.switchTab(value as 'DOCUMENT' | 'ARCHIVE')
        "
        ><v-tab value="DOCUMENT"
          ><v-icon class="mr-2" icon="mdi-file-clock-outline" />待办单据</v-tab
        ><v-tab value="ARCHIVE"
          ><v-icon
            class="mr-2"
            icon="mdi-database-clock-outline"
          />待办资料</v-tab
        ></v-tabs
      >
      <v-divider />
      <v-card-text>
        <v-alert
          v-if="vm.activeState.queryError"
          class="mb-4"
          type="error"
          title="待办加载失败"
          ><span>{{ vm.activeState.queryError }}</span
          ><template #append
            ><v-btn variant="text" @click="vm.retry">重试查询</v-btn></template
          ></v-alert
        >
        <v-alert v-if="vm.activeState.actionError" class="mb-4" type="error">{{
          vm.activeState.actionError
        }}</v-alert>
        <v-form class="filters" @submit.prevent="vm.applyFilters"
          ><v-text-field
            v-model="vm.activeState.keyword"
            label="编码或名称"
            hide-details
            variant="outlined"
          /><v-select
            v-model="vm.activeState.entity"
            label="类型"
            :items="[
              { title: '全部', value: '' },
              ...workbenchEntityOptions(vm.activeTab),
            ]"
            hide-details
            variant="outlined"
          /><v-select
            v-model="vm.activeState.status"
            :items="[
              { title: '全部', value: '' },
              { title: '待批准', value: 'PENDING' },
              { title: '已驳回', value: 'REJECTED' },
            ]"
            label="状态"
            hide-details
            variant="outlined"
          /><v-btn color="primary" type="submit">查询</v-btn
          ><v-btn variant="text" @click="vm.resetFilters">重置</v-btn></v-form
        >
        <v-data-table
          :headers="[
            { title: '类型', key: 'entity' },
            { title: '编码', key: 'code' },
            { title: '名称', key: 'name' },
            { title: '状态', key: 'status' },
            { title: '更新时间', key: 'updatedAt' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="vm.activeState.items"
          :loading="vm.activeState.loading"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.entity="{ item }">{{
            workbenchEntityLabel(item.domain, item.entity)
          }}</template>
          <template #item.status="{ item }">{{
            approvalStatusPresentation[item.status].label
          }}</template>
          <template #item.actions="{ item }"
            ><div
              class="actions"
              :data-workbench-submission-id="item.submissionId"
            >
              <template v-for="action in vm.visibleActions(item)" :key="action"
                ><v-text-field
                  v-if="action === 'reject'"
                  v-model="vm.reasons[item.submissionId]"
                  density="compact"
                  hide-details
                  label="驳回原因"
                /><v-btn
                  size="small"
                  variant="text"
                  @click="act(action, item)"
                  >{{ vm.actionLabel(action) }}</v-btn
                ></template
              >
            </div></template
          >
          <template #no-data>暂无可处理待办。</template>
        </v-data-table>
        <div class="pager">
          <span>共 {{ vm.activeState.total }} 项</span
          ><v-pagination
            v-if="vm.activeState.total > 20"
            :model-value="vm.activeState.page"
            :length="Math.ceil(vm.activeState.total / 20)"
            @update:model-value="(page) => vm.query(vm.activeTab, page)"
          />
        </div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns:
    minmax(180px, 1fr) minmax(150px, 0.6fr) minmax(140px, 0.5fr)
    auto auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
}
@media (max-width: 800px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
