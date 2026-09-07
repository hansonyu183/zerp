<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { ListIdentity } from '../../../components/list-page/vm.ts'
import SimpleAuxEditorPresentation from '../simple/SimpleAuxEditorPresentation.vue'
import {
  useEmployeeCategoryManagementViewModel,
  type EmployeeCategoryListItem,
} from '../simple/vm.ts'

const vm = reactive(useEmployeeCategoryManagementViewModel())

function item(value: ListIdentity): EmployeeCategoryListItem {
  return value as EmployeeCategoryListItem
}

onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    title="员工分类"
    create-label="新增员工分类"
    :items="vm.list.items"
    :total="vm.list.total"
    :page="vm.list.page"
    :keyword="vm.list.keyword"
    :loading="vm.list.loading"
    :query-error="vm.list.queryError"
    :notice="vm.creationNotice"
    :feedback="vm.list.feedback"
    show-enabled
    :can-search="vm.list.searchable"
    :can-create="vm.list.canAction('create')"
    :action-pending="vm.list.actionPending"
    :action-blocked="vm.list.actionBlocked"
    :can-edit="(value) => vm.list.canAction('edit', item(value))"
    :can-enable="(value) => vm.list.canAction('enable', item(value))"
    :can-disable="(value) => vm.list.canAction('disable', item(value))"
    :is-row-pending="vm.list.isRowPending"
    :is-row-blocked="vm.list.isRowBlocked"
    @update:keyword="vm.list.keyword = $event"
    @search="vm.list.submitSearch"
    @create="vm.list.create"
    @edit="vm.list.edit(item($event))"
    @enable="vm.list.enable(item($event))"
    @disable="vm.list.disable(item($event))"
    @page="vm.list.goToPage"
    @dismiss-feedback="vm.list.dismissFeedback"
  />
  <SimpleAuxEditorPresentation
    :open="vm.editorOpen"
    :mode="vm.editorMode"
    title="员工分类"
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
