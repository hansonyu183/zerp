<script setup lang="ts">
import { computed, reactive } from 'vue'
import { VoucherLifecycleActions } from '@/components/voucher'
import { useSessionStore } from '@/stores/session'
import type { VoucherEntityViewModel } from './view-model'

const props = defineProps<{
  model: VoucherEntityViewModel
}>()
const emit = defineEmits<{
  save: []
  secondary: [action: 'delete', title: string]
}>()

const vm = reactive(props.model)
const session = useSessionStore()
const lifecycleDisabledReason = computed(() => {
  if (vm.busy) return '正在处理或刷新单据，请稍候。'
  if (vm.dirty) return '请先保存或取消当前修改。'
  return ''
})
</script>

<template>
  <div class="voucher-workspace-actions">
    <template v-if="vm.editing">
      <v-btn
        v-if="vm.documentView"
        :disabled="vm.saving"
        variant="text"
        @click="vm.cancelEditing"
      >
        取消编辑
      </v-btn>
      <v-btn
        color="primary"
        :loading="vm.saving"
        prepend-icon="mdi-content-save-outline"
        @click="emit('save')"
      >
        保存
      </v-btn>
    </template>
    <v-btn
      v-else-if="vm.actionAvailability.save"
      color="primary"
      prepend-icon="mdi-pencil-outline"
      variant="tonal"
      @click="vm.startEditing"
    >
      编辑草稿
    </v-btn>
    <VoucherLifecycleActions
      v-if="vm.documentView && !vm.editing"
      :availability="vm.actionAvailability"
      :disabled="vm.busy || vm.dirty"
      :disabled-reason="lifecycleDisabledReason"
      :loading-action="vm.actionLoading"
      @action="vm.lifecycleAction"
    />
    <span
      v-if="vm.documentView && !vm.editing && lifecycleDisabledReason"
      class="voucher-workspace-actions__reason text-caption"
    >
      <v-icon icon="mdi-information-outline" size="small" />
      {{ lifecycleDisabledReason }}
    </span>
    <v-btn
      v-if="
        vm.documentView &&
        vm.config.entity === 'sale-signoff' &&
        ['APPROVED'].includes(vm.documentView.approval.status) &&
        session.can('/vou/sale-return/create')
      "
      :to="{
        path: '/vou/sale-return',
        query: { sourceDocumentIds: vm.documentView.documentId },
      }"
      prepend-icon="mdi-keyboard-return"
      variant="tonal"
    >
      发起退货
    </v-btn>
    <v-btn
      v-if="
        vm.documentView &&
        vm.config.entity === 'purchase-inbound' &&
        ['APPROVED'].includes(vm.documentView.approval.status) &&
        session.can('/vou/purchase-return/create')
      "
      :to="{
        path: '/vou/purchase-return',
        query: { sourceDocumentIds: vm.documentView.documentId },
      }"
      prepend-icon="mdi-keyboard-return"
      variant="tonal"
    >
      发起退货
    </v-btn>
    <v-btn
      v-if="!vm.editing && vm.actionAvailability.delete"
      color="error"
      prepend-icon="mdi-delete-outline"
      variant="tonal"
      @click="emit('secondary', 'delete', '删除草稿')"
    >
      删除草稿
    </v-btn>
  </div>
</template>

<style scoped>
.voucher-workspace-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 12px;
}

.voucher-workspace-actions__reason {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
