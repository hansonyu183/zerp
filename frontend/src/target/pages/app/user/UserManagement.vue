<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { ListIdentity } from '../../../components/list-page/vm.ts'
import UserEditorPresentation from './UserEditorPresentation.vue'
import { useUserManagementViewModel, type UserListItem } from './vm.ts'

const vm = reactive(useUserManagementViewModel())

function userItem(item: ListIdentity): UserListItem {
  return item as UserListItem
}

function canEdit(item: ListIdentity): boolean {
  return vm.list.canAction('edit', userItem(item))
}

function canEnable(item: ListIdentity): boolean {
  return vm.list.canAction('enable', userItem(item))
}

function canDisable(item: ListIdentity): boolean {
  return vm.list.canAction('disable', userItem(item))
}

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    title="用户管理"
    create-label="新增用户"
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
    @edit="vm.list.edit(userItem($event))"
    @enable="vm.list.enable(userItem($event))"
    @disable="vm.list.disable(userItem($event))"
    @page="vm.list.goToPage"
    @dismiss-feedback="vm.list.dismissFeedback"
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
