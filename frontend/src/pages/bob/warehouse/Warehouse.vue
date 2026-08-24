<script setup lang="ts">
import BobEntityPage from '../shared/BobEntityPage.vue'
import WarehouseDisableDialog from './WarehouseDisableDialog.vue'
import { useWarehouseViewModel } from './vm'

const model = useWarehouseViewModel()
</script>

<template>
  <BobEntityPage :model="model">
    <WarehouseDisableDialog :model="model" />
  </BobEntityPage>
</template>
