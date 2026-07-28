<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { usePurchaseInboundViewModel } from './vm'

const vm = usePurchaseInboundViewModel()
</script>

<template>
  <VoucherEntityPage :model="vm" />
</template>
