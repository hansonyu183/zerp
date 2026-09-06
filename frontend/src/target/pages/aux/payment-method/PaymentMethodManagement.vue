<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'
import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { ListIdentity } from '../../../components/list-page/vm.ts'
import PaymentMethodEditor from './PaymentMethodEditor.vue'
import {
  usePaymentMethodManagementViewModel,
  type PaymentMethodListItem,
} from './vm.ts'
const vm = reactive(usePaymentMethodManagementViewModel())
const item = (value: ListIdentity) => value as PaymentMethodListItem
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>
<template>
  <ListPageShell
    title="收款方式"
    create-label="新增收款方式"
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
    :can-edit="(v) => vm.list.canAction('edit', item(v))"
    :can-enable="(v) => vm.list.canAction('enable', item(v))"
    :can-disable="(v) => vm.list.canAction('disable', item(v))"
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
