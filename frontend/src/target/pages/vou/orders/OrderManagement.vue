<script setup lang="ts">
import type { VouEntity } from '@zerp/model'
import VouListPage from '../../../components/vou-list-page/VouListPage.vue'
import type { VouPageRegistration } from '../../../components/vou-list-page/vm.ts'
import type { OrderFilters } from '../../../navigation/vou-pages.ts'
import OrderSnapshot from './OrderSnapshot.vue'
defineProps<{
  vouType: VouEntity
  definition: VouPageRegistration<OrderFilters>
}>()
</script>
<template>
  <VouListPage :vou-type="vouType" :definition="definition">
    <template #detail="{ document }"
      ><OrderSnapshot :payload="document.payload"
    /></template>
  </VouListPage>
</template>
