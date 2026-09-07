<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { ListIdentity } from '../../../components/list-page/vm.ts'
import RoleEditorPresentation from './RoleEditorPresentation.vue'
import { useRoleManagementViewModel, type RoleListItem } from './vm.ts'

const vm = reactive(useRoleManagementViewModel())

function roleItem(item: ListIdentity): RoleListItem {
  return item as RoleListItem
}

function canEdit(item: ListIdentity): boolean {
  return vm.list.canAction('edit', roleItem(item))
}

function canEnable(item: ListIdentity): boolean {
  return vm.list.canAction('enable', roleItem(item))
}

function canDisable(item: ListIdentity): boolean {
  return vm.list.canAction('disable', roleItem(item))
}

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    title="角色管理"
    create-label="新增角色"
    :items="vm.list.items"
    :total="vm.list.total"
    :page="vm.list.page"
    :keyword="vm.list.keyword"
    :loading="vm.list.loading"
    :query-error="vm.list.queryError"
    :notice="vm.dependencyNotice"
    :feedback="vm.list.feedback"
    show-enabled
    :can-search="vm.list.searchable"
    :can-create="vm.list.canAction('create')"
    :action-pending="vm.list.actionPending"
    :action-blocked="vm.list.actionBlocked"
    :can-edit="canEdit"
    :can-enable="canEnable"
    :can-disable="canDisable"
    :is-row-pending="vm.list.isRowPending"
    :is-row-blocked="vm.list.isRowBlocked"
    @update:keyword="vm.list.keyword = $event"
    @search="vm.list.submitSearch"
    @create="vm.list.create"
    @edit="vm.list.edit(roleItem($event))"
    @enable="vm.list.enable(roleItem($event))"
    @disable="vm.list.disable(roleItem($event))"
    @page="vm.list.goToPage"
    @dismiss-feedback="vm.list.dismissFeedback"
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
