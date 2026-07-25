<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { VoucherListItem } from '@/components/voucher'
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import IntermediaryWorkflowPage from './v2/IntermediaryWorkflowPage.vue'
import { useIntermediarySaleOrderViewModel } from './vm'

const legacyVm = useIntermediarySaleOrderViewModel()
const legacyMode = ref(false)

async function openLegacy(row: VoucherListItem): Promise<void> {
  legacyMode.value = true
  await nextTick()
  await legacyVm.openDocument(row)
}
</script>

<template>
  <IntermediaryWorkflowPage
    v-if="!legacyMode"
    @open-legacy="openLegacy"
  />
  <div v-else>
    <v-container fluid class="pb-0">
      <v-btn prepend-icon="mdi-arrow-left" variant="text" @click="legacyMode = false">
        返回居间订单 V2
      </v-btn>
    </v-container>
    <VoucherEntityPage
      :model="legacyVm"
      :auto-query="false"
      :show-list="false"
    />
  </div>
</template>
