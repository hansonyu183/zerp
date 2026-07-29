<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useSaleReturnViewModel } from './vm'

const vm = useSaleReturnViewModel()
</script>

<template>
  <VoucherEntityPage :model="vm" />
</template>
