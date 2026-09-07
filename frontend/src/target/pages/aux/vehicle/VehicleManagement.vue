<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive } from 'vue'

import ListPageShell from '../../../components/list-page/ListPageShell.vue'
import type { vehicleListPage } from '../../../navigation/list-pages.ts'
import VehicleEditor from './VehicleEditor.vue'
import { useVehicleManagementViewModel } from './vm.ts'

defineProps<{ definition: typeof vehicleListPage }>()
const vm = reactive(useVehicleManagementViewModel())
onMounted(() => void vm.list.initialize())
onBeforeUnmount(vm.dispose)
</script>

<template>
  <ListPageShell
    :definition="definition"
    :vm="vm.list"
    :notice="vm.creationNotice"
  />
  <VehicleEditor
    v-bind="{
      open: vm.editorOpen,
      mode: vm.editorMode,
      name: vm.editor.name,
      plateNumber: vm.editor.plateNumber,
      vehicleTypeId: vm.editor.vehicleTypeId,
      carrierKind: vm.editor.carrierKind,
      carrierOperatingEntityId: vm.editor.carrierOperatingEntityId,
      carrierOtherUnitId: vm.editor.carrierOtherUnitId,
      vin: vm.editor.vin,
      engineNumber: vm.editor.engineNumber,
      ratedLoadKg: vm.editor.ratedLoadKg,
      bulkWaterCarrier: vm.editor.bulkWaterCarrier,
      remark: vm.editor.remark,
      vehicleTypes: vm.vehicleTypes,
      operatingEntities: vm.operatingEntities,
      otherUnits: vm.otherUnits,
      error: vm.editorError,
      saving: vm.saving,
      loading: vm.editorLoading || vm.referenceLoading,
      canSave: vm.canSave,
    }"
    @update:open="$event || vm.closeEditor()"
    @update:name="vm.editor.name = $event"
    @update:plate-number="vm.editor.plateNumber = $event"
    @update:vehicle-type-id="vm.editor.vehicleTypeId = $event"
    @update:carrier-kind="vm.editor.carrierKind = $event"
    @update:carrier-operating-entity-id="
      vm.editor.carrierOperatingEntityId = $event
    "
    @update:carrier-other-unit-id="vm.editor.carrierOtherUnitId = $event"
    @update:vin="vm.editor.vin = $event"
    @update:engine-number="vm.editor.engineNumber = $event"
    @update:rated-load-kg="vm.editor.ratedLoadKg = $event"
    @update:bulk-water-carrier="vm.editor.bulkWaterCarrier = $event"
    @update:remark="vm.editor.remark = $event"
    @save="vm.saveEditor"
  />
</template>
