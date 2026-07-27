<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useSaleSignoffViewModel } from './vm'

const vm = useSaleSignoffViewModel()
</script>

<template>
  <VoucherEntityPage :model="vm" />
</template>
