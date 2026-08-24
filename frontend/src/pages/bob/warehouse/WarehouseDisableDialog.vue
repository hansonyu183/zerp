<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  warehouseDocumentEntityLabel,
  warehouseDocumentStatusLabel,
} from './disable'
import type { WarehouseViewModel } from './vm'

const props = defineProps<{ model: WarehouseViewModel }>()
const vm = reactive(props.model)
const clear = computed(
  () =>
    (vm.warehouseDisablePrecheck?.inventory.length ?? 0) === 0 &&
    (vm.warehouseDisablePrecheck?.inProgressDocuments.length ?? 0) === 0 &&
    (vm.warehouseDisablePrecheck?.executableSources.length ?? 0) === 0,
)
</script>

<template>
  <v-dialog
    :model-value="Boolean(vm.warehouseDisableTarget)"
    max-width="620"
    persistent
  >
    <v-card rounded="xl" title="仓库停用预检">
      <v-card-text>
        <v-alert v-if="clear" type="success" variant="tonal">
          当前仓库库存为零，且没有处理中或仍可执行库存动作的单据。确认后仍会在事务内重新校验。
        </v-alert>
        <template v-else>
          <v-alert class="mb-4" type="warning" variant="tonal">
            请先处理以下阻断项；仓库将保持启用。
          </v-alert>
          <div
            v-if="vm.warehouseDisablePrecheck?.inventory.length"
            class="mb-4"
          >
            <div class="text-subtitle-2 mb-1">非零库存</div>
            <div
              v-for="item in vm.warehouseDisablePrecheck.inventory"
              :key="item.productObjectId"
            >
              {{ item.productCode }} · {{ item.productName }}：{{
                item.quantity
              }}
            </div>
          </div>
          <div
            v-if="vm.warehouseDisablePrecheck?.inProgressDocuments.length"
            class="mb-4"
          >
            <div class="text-subtitle-2 mb-1">处理中单据</div>
            <div
              v-for="item in vm.warehouseDisablePrecheck.inProgressDocuments"
              :key="item.documentId"
            >
              {{ item.documentNo }} ·
              {{ warehouseDocumentEntityLabel(item.entity) }} ·
              {{ warehouseDocumentStatusLabel(item.status) }}
            </div>
          </div>
          <div v-if="vm.warehouseDisablePrecheck?.executableSources.length">
            <div class="text-subtitle-2 mb-1">仍可执行的来源单据</div>
            <div
              v-for="item in vm.warehouseDisablePrecheck.executableSources"
              :key="item.documentId"
            >
              {{ item.documentNo }} ·
              {{ warehouseDocumentEntityLabel(item.entity) }}
            </div>
          </div>
        </template>
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="vm.closeWarehouseDisablePrecheck">
          关闭
        </v-btn>
        <v-btn
          v-if="clear"
          color="warning"
          :loading="
            vm.actionLoading ===
            `disable:${vm.warehouseDisableTarget?.objectId}`
          "
          @click="vm.confirmWarehouseDisable"
        >
          确认停用
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
