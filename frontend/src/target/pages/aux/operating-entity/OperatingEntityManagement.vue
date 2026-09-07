<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { operatingEntityListPage } from '../../../navigation/list-pages.ts'
import OperatingEntityEditor from './OperatingEntityEditor.vue'
import { useOperatingEntityManagementViewModel } from './vm.ts'

defineProps<{ definition: typeof operatingEntityListPage }>()
const vm = reactive(useOperatingEntityManagementViewModel())
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <OperatingEntityEditor
    v-bind="{
      open: vm.editorOpen,
      mode: vm.editorMode,
      legalName: vm.editor.legalName,
      shortName: vm.editor.shortName,
      legalIdentifier: vm.editor.legalIdentifier,
      registeredAddress: vm.editor.registeredAddress,
      contactName: vm.editor.contactName,
      contactPhone: vm.editor.contactPhone,
      invoiceTitle: vm.editor.invoiceTitle,
      invoiceAddress: vm.editor.invoiceAddress,
      invoicePhone: vm.editor.invoicePhone,
      invoiceBank: vm.editor.invoiceBank,
      invoiceAccount: vm.editor.invoiceAccount,
      remark: vm.editor.remark,
      error: vm.editorError,
      saving: vm.saving,
      loading: vm.editorLoading,
      canSave: vm.canSave,
    }"
    @update:open="$event || vm.closeEditor()"
    @update:legal-name="vm.editor.legalName = $event"
    @update:short-name="vm.editor.shortName = $event"
    @update:legal-identifier="vm.editor.legalIdentifier = $event"
    @update:registered-address="vm.editor.registeredAddress = $event"
    @update:contact-name="vm.editor.contactName = $event"
    @update:contact-phone="vm.editor.contactPhone = $event"
    @update:invoice-title="vm.editor.invoiceTitle = $event"
    @update:invoice-address="vm.editor.invoiceAddress = $event"
    @update:invoice-phone="vm.editor.invoicePhone = $event"
    @update:invoice-bank="vm.editor.invoiceBank = $event"
    @update:invoice-account="vm.editor.invoiceAccount = $event"
    @update:remark="vm.editor.remark = $event"
    @save="vm.saveEditor"
  />
</template>
