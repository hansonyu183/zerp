<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import type { measurementUnitListPage } from '../../../navigation/list-pages.ts'
import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import MeasurementUnitEditor from './MeasurementUnitEditor.vue'
import { useMeasurementUnitManagementViewModel } from './vm.ts'
defineProps<{ definition: typeof measurementUnitListPage }>()
const vm = reactive(useMeasurementUnitManagementViewModel())

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>
<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <MeasurementUnitEditor
    v-bind="{
      open: vm.editorOpen,
      mode: vm.editorMode,
      title: '计量单位',
      name: vm.editor.name,
      symbol: vm.editor.symbol,
      quantityScale: vm.editor.quantityScale,
      error: vm.editorError,
      saving: vm.saving,
      loading: vm.editorLoading,
      canSave: vm.canSave,
    }"
    @update:open="$event || vm.closeEditor()"
    @update:name="vm.editor.name = $event"
    @update:symbol="vm.editor.symbol = $event"
    @update:quantityScale="vm.editor.quantityScale = $event"
    @save="vm.saveEditor"
  />
</template>
