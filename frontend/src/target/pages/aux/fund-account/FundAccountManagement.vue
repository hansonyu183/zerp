<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { fundAccountListPage } from '../../../navigation/list-pages.ts'
import FundAccountEditor from './FundAccountEditor.vue'
import { useFundAccountManagementViewModel } from './vm.ts'

defineProps<{ definition: typeof fundAccountListPage }>()
const vm = reactive(useFundAccountManagementViewModel())
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <FundAccountEditor
    v-bind="{
      open: vm.editorOpen,
      mode: vm.editorMode,
      name: vm.editor.name,
      currency: vm.editor.currency,
      accountName: vm.editor.accountName,
      bank: vm.editor.bank,
      branch: vm.editor.branch,
      accountNumber: vm.editor.accountNumber,
      operatingEntityId: vm.editor.operatingEntityId,
      remark: vm.editor.remark,
      operatingEntities: vm.operatingEntities,
      error: vm.editorError,
      saving: vm.saving,
      loading: vm.editorLoading || vm.referenceLoading,
      canSave: vm.canSave,
    }"
    @update:open="$event || vm.closeEditor()"
    @update:name="vm.editor.name = $event"
    @update:currency="vm.editor.currency = $event"
    @update:account-name="vm.editor.accountName = $event"
    @update:bank="vm.editor.bank = $event"
    @update:branch="vm.editor.branch = $event"
    @update:account-number="vm.editor.accountNumber = $event"
    @update:operating-entity-id="vm.editor.operatingEntityId = $event"
    @update:remark="vm.editor.remark = $event"
    @save="vm.saveEditor"
  />
</template>
