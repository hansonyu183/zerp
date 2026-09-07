<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import type { userListPage } from '../../../navigation/list-pages.ts'
import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import UserEditorPresentation from './UserEditorPresentation.vue'
import { useUserManagementViewModel } from './vm.ts'

defineProps<{ definition: typeof userListPage }>()
const vm = reactive(useUserManagementViewModel())

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.dependencyNotice"
  />
  <UserEditorPresentation
    :open="vm.editorOpen"
    :mode="vm.editorMode"
    :code="vm.editor.code"
    :name="vm.editor.name"
    :password="vm.editor.password"
    :role-ids="vm.editor.roleIds"
    :role-options="vm.roleOptions"
    :error="vm.editorError"
    :saving="vm.saving"
    :loading="vm.editorLoading"
    :can-save="vm.canSave"
    :roles-disabled="vm.rolesDisabled"
    @update:open="$event || vm.closeEditor()"
    @update:code="vm.editor.code = $event"
    @update:name="vm.editor.name = $event"
    @update:password="vm.editor.password = $event"
    @update:role-ids="vm.editor.roleIds = $event"
    @save="vm.saveEditor"
  />
</template>
