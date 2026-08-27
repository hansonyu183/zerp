<script setup lang="ts">
import type { components } from '@/api/generated/schema'
import {
  warehouseDocumentEntityLabel,
  warehouseDocumentStatusLabel,
} from './disable'
import type { DclWarehouseListItem } from './types'

const props = defineProps<{
  model: {
    warehouseDisableTarget: DclWarehouseListItem | null
    warehouseDisableBlockers:
      components['schemas']['DclWarehouseDisableBlockers'] | null
    actionLoading: string | null
    closeWarehouseDisableDialog: () => void
    confirmWarehouseDisable: () => Promise<boolean>
  }
}>()
const vm = props.model
</script>

<template>
  <v-dialog
    :model-value="Boolean(vm.warehouseDisableTarget)"
    max-width="620"
    persistent
  >
    <v-card
      rounded="xl"
      :title="
        vm.warehouseDisableBlockers ? '仓库停用申请不能批准' : '创建停用草稿'
      "
    >
      <v-card-text>
        <v-alert
          v-if="!vm.warehouseDisableBlockers"
          type="warning"
          variant="tonal"
        >
          确认后将创建停用草稿。候选获批准前，当前正式仓库仍可用于新的业务。
        </v-alert>
        <template v-else>
          <v-alert class="mb-4" type="warning" variant="tonal">
            请先处理以下阻断项；停用候选将保持待审核，当前正式仓库继续启用。
          </v-alert>
          <div v-if="vm.warehouseDisableBlockers.inventory.length" class="mb-4">
            <div class="text-subtitle-2 mb-1">非零库存</div>
            <div
              v-for="item in vm.warehouseDisableBlockers.inventory"
              :key="item.productObjectId"
            >
              {{ item.productCode }} · {{ item.productName }}：{{
                item.quantity
              }}
            </div>
          </div>
          <div v-if="vm.warehouseDisableBlockers.documents.length" class="mb-4">
            <div class="text-subtitle-2 mb-1">处理中单据</div>
            <div
              v-for="item in vm.warehouseDisableBlockers.documents"
              :key="item.documentId"
            >
              {{ item.documentNo }} ·
              {{ warehouseDocumentEntityLabel(item.entity) }} ·
              {{ warehouseDocumentStatusLabel(item.status) }}
            </div>
          </div>
          <div v-if="vm.warehouseDisableBlockers.sources.length" class="mb-4">
            <div class="text-subtitle-2 mb-1">仍可执行的来源单据</div>
            <div
              v-for="item in vm.warehouseDisableBlockers.sources"
              :key="item.documentId"
            >
              {{ item.documentNo }} ·
              {{ warehouseDocumentEntityLabel(item.entity) }}
            </div>
          </div>
          <div v-if="vm.warehouseDisableBlockers.references.length">
            <div class="text-subtitle-2 mb-1">当前业务对象引用</div>
            <div
              v-for="item in vm.warehouseDisableBlockers.references"
              :key="`${item.entity}:${item.field}`"
            >
              {{ item.entity }} · {{ item.field }}：{{ item.count }} 项
            </div>
          </div>
        </template>
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="vm.closeWarehouseDisableDialog">
          {{ vm.warehouseDisableBlockers ? '关闭' : '取消' }}
        </v-btn>
        <v-btn
          v-if="!vm.warehouseDisableBlockers"
          color="warning"
          :loading="
            vm.actionLoading ===
            `disable:${vm.warehouseDisableTarget?.objectId}`
          "
          @click="vm.confirmWarehouseDisable"
        >
          创建停用草稿
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
