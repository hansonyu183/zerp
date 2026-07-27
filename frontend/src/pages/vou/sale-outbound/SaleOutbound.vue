<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useSaleOutboundViewModel } from './vm'

const vm = useSaleOutboundViewModel()
</script>

<template>
  <VoucherEntityPage :model="vm" />
</template>
