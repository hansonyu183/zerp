<script setup lang="ts">
import { userCreatableVouEntities, type VouEntity } from '@zerp/model'
import VouListPage from '../../components/vou-list-page/VouListPage.vue'
import type { VouPageRegistration } from '../../components/vou-list-page/vm.ts'
import type { OrderFilters } from '../../navigation/vou-pages.ts'
import SnapshotValue from './SnapshotValue.vue'
defineProps<{
  vouType: VouEntity
  definition: VouPageRegistration<OrderFilters>
}>()
</script>
<template>
  <section>
    <v-alert
      v-if="!userCreatableVouEntities.includes(vouType)"
      type="info"
      class="mb-4"
      >此类型由系统生成，不支持人工新建。</v-alert
    >
    <VouListPage :vou-type="vouType" :definition="definition">
      <template #detail="{ document }">
        <section data-testid="vou-catalog-snapshot">
          <SnapshotValue :value="document.payload" />
        </section>
      </template>
    </VouListPage>
  </section>
</template>
