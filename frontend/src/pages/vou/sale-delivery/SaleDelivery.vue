<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useSaleDeliveryViewModel } from './vm'

const vm = useSaleDeliveryViewModel()
</script>

<template>
  <VoucherEntityPage :model="vm" />
</template>
