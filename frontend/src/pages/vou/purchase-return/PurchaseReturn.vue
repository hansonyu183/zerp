<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { usePurchaseReturnViewModel } from './vm'

const vm = usePurchaseReturnViewModel()
</script>

<template>
  <VoucherEntityPage :model="vm" />
</template>
