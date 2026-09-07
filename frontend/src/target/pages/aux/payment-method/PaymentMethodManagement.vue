<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import type { paymentMethodListPage } from '../../../navigation/list-pages.ts'
import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import PaymentMethodEditor from './PaymentMethodEditor.vue'
import { usePaymentMethodManagementViewModel } from './vm.ts'
defineProps<{ definition: typeof paymentMethodListPage }>()
const vm = reactive(usePaymentMethodManagementViewModel())

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>
<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <PaymentMethodEditor
    v-bind="{
      open: vm.editorOpen,
      mode: vm.editorMode,
      title: '收款方式',
      name: vm.editor.name,
      description: vm.editor.description,
      defaultSalesSurcharge: vm.editor.defaultSalesSurcharge,
      error: vm.editorError,
      saving: vm.saving,
      loading: vm.editorLoading,
      canSave: vm.canSave,
    }"
    @update:open="$event || vm.closeEditor()"
    @update:name="vm.editor.name = $event"
    @update:description="vm.editor.description = $event"
    @update:default-sales-surcharge="vm.editor.defaultSalesSurcharge = $event"
    @save="vm.saveEditor"
  />
</template>
