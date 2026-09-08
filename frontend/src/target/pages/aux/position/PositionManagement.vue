<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import type { positionListPage } from '../../../navigation/list-pages.ts'
import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import SimpleAuxEditorPresentation from '../simple/SimpleAuxEditorPresentation.vue'
import { usePositionManagementViewModel } from '../simple/vm.ts'

defineProps<{ definition: typeof positionListPage }>()
const vm = reactive(usePositionManagementViewModel())

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <SimpleAuxEditorPresentation
    :open="vm.editorOpen"
    :mode="vm.editorMode"
    title="岗位"
    :name="vm.editor.name"
    :description="vm.editor.description"
    :error="vm.editorError"
    :saving="vm.saving"
    :loading="vm.editorLoading"
    :can-save="vm.canSave"
    @update:open="$event || vm.closeEditor()"
    @update:name="vm.editor.name = $event"
    @update:description="vm.editor.description = $event"
    @save="vm.saveEditor"
  />
</template>
