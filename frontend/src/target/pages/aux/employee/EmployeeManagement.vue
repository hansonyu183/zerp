<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { employeeListPage } from '../../../navigation/list-pages.ts'
import EmployeeEditor from './EmployeeEditor.vue'
import { useEmployeeManagementViewModel } from './vm.ts'

defineProps<{ definition: typeof employeeListPage }>()
const vm = reactive(useEmployeeManagementViewModel())
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <EmployeeEditor
    v-bind="{
      open: vm.editorOpen,
      mode: vm.editorMode,
      identityKind: vm.editor.identityKind,
      legalName: vm.editor.legalName,
      displayName: vm.editor.displayName,
      legalIdentifier: vm.editor.legalIdentifier,
      contactName: vm.editor.contactName,
      phone: vm.editor.phone,
      address: vm.editor.address,
      employmentDate: vm.editor.employmentDate,
      workPhone: vm.editor.workPhone,
      workEmail: vm.editor.workEmail,
      remark: vm.editor.remark,
      operatingEntityId: vm.editor.operatingEntityId,
      employeeCategoryId: vm.editor.employeeCategoryId,
      departmentId: vm.editor.departmentId,
      positionId: vm.editor.positionId,
      operatingEntities: vm.operatingEntities,
      employeeCategories: vm.employeeCategories,
      departments: vm.departments,
      positions: vm.positions,
      error: vm.editorError,
      saving: vm.saving,
      loading: vm.editorLoading || vm.referenceLoading,
      canSave: vm.canSave,
    }"
    @update:open="$event || vm.closeEditor()"
    @update:identity-kind="vm.editor.identityKind = $event"
    @update:legal-name="vm.editor.legalName = $event"
    @update:display-name="vm.editor.displayName = $event"
    @update:legal-identifier="vm.editor.legalIdentifier = $event"
    @update:contact-name="vm.editor.contactName = $event"
    @update:phone="vm.editor.phone = $event"
    @update:address="vm.editor.address = $event"
    @update:employment-date="vm.editor.employmentDate = $event"
    @update:work-phone="vm.editor.workPhone = $event"
    @update:work-email="vm.editor.workEmail = $event"
    @update:remark="vm.editor.remark = $event"
    @update:operating-entity-id="vm.editor.operatingEntityId = $event"
    @update:employee-category-id="vm.editor.employeeCategoryId = $event"
    @update:department-id="vm.editor.departmentId = $event"
    @update:position-id="vm.editor.positionId = $event"
    @save="vm.saveEditor"
  />
</template>
