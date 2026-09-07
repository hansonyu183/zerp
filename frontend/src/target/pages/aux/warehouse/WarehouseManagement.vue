<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { warehouseListPage } from '../../../navigation/list-pages.ts'
import WarehouseEditor from './WarehouseEditor.vue'
import { useWarehouseManagementViewModel } from './vm.ts'

defineProps<{ definition: typeof warehouseListPage }>()
const vm = reactive(useWarehouseManagementViewModel())
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <WarehouseEditor
    v-bind="{
      open: vm.editorOpen,
      mode: vm.editorMode,
      name: vm.editor.name,
      address: vm.editor.address,
      contactName: vm.editor.contactName,
      contactPhone: vm.editor.contactPhone,
      managerEmployeeId: vm.editor.managerEmployeeId,
      remark: vm.editor.remark,
      employees: vm.employees,
      error: vm.editorError,
      saving: vm.saving,
      loading: vm.editorLoading || vm.referenceLoading,
      canSave: vm.canSave,
    }"
    @update:open="$event || vm.closeEditor()"
    @update:name="vm.editor.name = $event"
    @update:address="vm.editor.address = $event"
    @update:contact-name="vm.editor.contactName = $event"
    @update:contact-phone="vm.editor.contactPhone = $event"
    @update:manager-employee-id="vm.editor.managerEmployeeId = $event"
    @update:remark="vm.editor.remark = $event"
    @save="vm.saveEditor"
  />
</template>
