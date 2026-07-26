<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useSaleOrderViewModel } from './vm'
const vm = useSaleOrderViewModel()
</script>
<template><VoucherEntityPage :model="vm" /></template>
