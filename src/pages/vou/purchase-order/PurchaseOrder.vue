<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { usePurchaseOrderViewModel } from './vm'
const vm = usePurchaseOrderViewModel()
</script>
<template><VoucherEntityPage :model="vm" /></template>
