<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  BusinessObjectEditor,
  BusinessObjectList,
} from '@/components/business-object'
import {
  useCustomerViewModel,
  type CustomerListItem,
} from './vm'

const vm = reactive(useCustomerViewModel())
const effectiveEditTarget = ref<CustomerListItem | null>(null)
const deleteTarget = ref<CustomerListItem | null>(null)

void vm.query()

function requestEdit(row: CustomerListItem): void {
  if (row.currentVersion.status === 'EFFECTIVE') {
    effectiveEditTarget.value = row
    return
  }

  void vm.openEdit(row)
}

function confirmEffectiveEdit(): void {
  const row = effectiveEditTarget.value
  effectiveEditTarget.value = null
  if (row) void vm.openEdit(row)
}

function requestDelete(row: CustomerListItem): void {
  deleteTarget.value = row
}

async function confirmDelete(): Promise<void> {
  const row = deleteTarget.value
  if (row && await vm.deleteCustomer(row)) deleteTarget.value = null
}
</script>

<template>
  <v-container fluid class="customer-page pa-5 pa-md-8">
    <v-alert
      v-if="vm.errorMessage"
      class="mb-4"
      icon="mdi-alert-circle-outline"
      type="error"
      variant="tonal"
    >
      {{ vm.errorMessage }}
    </v-alert>

    <BusinessObjectList
      :columns="vm.columns"
      :creatable="vm.canCreate"
      :deletable="vm.canDelete"
      :editable="vm.canEdit"
      empty-text="暂无客户数据"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      search-label="客户关键字"
      :total="vm.total"
      @create="vm.openCreate"
      @delete="requestDelete"
      @edit="requestEdit"
      @query="vm.search"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #cell-status="{ row }">
        <v-chip density="comfortable" size="small" variant="tonal">
          {{ vm.getStatusText(row.currentVersion.status) }}
        </v-chip>
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.drawerOpen"
    class="customer-drawer"
    location="end"
    temporary
    width="640"
  >
    <div class="customer-drawer__content">
      <BusinessObjectEditor
        :editing="true"
        :error-message="vm.editorErrorMessage"
        :fields="vm.editorFields"
        :loading="vm.editorLoading"
        :model-value="vm.editorModel"
        :reset-key="vm.editorResetKey"
        :saving="vm.saving"
        :title="vm.editorTitle"
        @cancel="vm.closeEditor"
        @save="vm.saveCustomer"
      />
    </div>
  </v-navigation-drawer>

  <v-dialog
    :model-value="Boolean(effectiveEditTarget)"
    max-width="520"
    @update:model-value="(value) => { if (!value) effectiveEditTarget = null }"
  >
    <v-card rounded="xl" title="确认编辑有效客户">
      <v-card-text>
        编辑有效客户会立即使当前有效版本失效，并创建一个需要重新审核的草稿版本。
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="effectiveEditTarget = null">取消</v-btn>
        <v-btn color="warning" @click="confirmEffectiveEdit">继续编辑</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(deleteTarget)"
    max-width="520"
    @update:model-value="(value) => { if (!value) deleteTarget = null }"
  >
    <v-card rounded="xl" title="确认删除客户草稿">
      <v-card-text>
        仅从未提交、从未生效且未被引用的首版草稿可以删除。此操作无法撤销。
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="deleteTarget = null">取消</v-btn>
        <v-btn
          color="error"
          :loading="vm.deletingObjectId === deleteTarget?.objectId"
          @click="confirmDelete"
        >
          删除草稿
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.customer-page {
  color: rgb(var(--v-theme-on-background));
}

.customer-drawer {
  background: rgb(var(--v-theme-background));
}

.customer-drawer__content {
  padding: 20px;
}

@media (max-width: 640px) {
  .customer-drawer__content {
    padding: 12px;
  }
}
</style>
