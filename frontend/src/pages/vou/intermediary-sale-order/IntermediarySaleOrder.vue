<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useIntermediarySaleOrderViewModel } from './vm'

const vm = useIntermediarySaleOrderViewModel()
</script>

<template>
  <VoucherEntityPage :model="vm" />
</template>
