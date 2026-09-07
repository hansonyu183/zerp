<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import type { assetCategoryListPage } from '../../../navigation/list-pages.ts'
import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import AssetCategoryEditor from './AssetCategoryEditor.vue'
import { useAssetCategoryManagementViewModel } from './vm.ts'

defineProps<{ definition: typeof assetCategoryListPage }>()
const vm = reactive(useAssetCategoryManagementViewModel())

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <AssetCategoryEditor
    v-bind="{
      open: vm.editorOpen,
      mode: vm.editorMode,
      name: vm.editor.name,
      description: vm.editor.description,
      defaultUsefulLifeMonths: vm.editor.defaultUsefulLifeMonths,
      defaultResidualRate: vm.editor.defaultResidualRate,
      error: vm.editorError,
      saving: vm.saving,
      loading: vm.editorLoading,
      canSave: vm.canSave,
    }"
    @update:open="$event || vm.closeEditor()"
    @update:name="vm.editor.name = $event"
    @update:description="vm.editor.description = $event"
    @update:default-useful-life-months="
      vm.editor.defaultUsefulLifeMonths = $event
    "
    @update:default-residual-rate="vm.editor.defaultResidualRate = $event"
    @save="vm.saveEditor"
  />
</template>
