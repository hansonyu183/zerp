<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import type { roleListPage } from '../../../navigation/list-pages.ts'
import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import RoleEditorPresentation from './RoleEditorPresentation.vue'
import { useRoleManagementViewModel } from './vm.ts'

defineProps<{ definition: typeof roleListPage }>()
const vm = reactive(useRoleManagementViewModel())

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.dependencyNotice"
  />
  <RoleEditorPresentation
    :open="vm.editorOpen"
    :mode="vm.editorMode"
    :name="vm.editor.name"
    :description="vm.editor.description"
    :permission-ids="vm.editor.permissionIds"
    :permission-options="vm.permissionOptions"
    :error="vm.editorError"
    :saving="vm.saving"
    :loading="vm.editorLoading"
    :can-save="vm.canSave"
    @update:open="$event || vm.closeEditor()"
    @update:name="vm.editor.name = $event"
    @update:description="vm.editor.description = $event"
    @update:permission-ids="vm.editor.permissionIds = $event"
    @save="vm.saveEditor"
  />
</template>
