<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useSalePricingViewModel } from './vm'
const vm = useSalePricingViewModel()
</script>
<template><VoucherEntityPage :model="vm" /></template>
