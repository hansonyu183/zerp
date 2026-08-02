<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { usePurchaseInquiryViewModel } from './vm'
const vm = usePurchaseInquiryViewModel()
</script>
<template><VoucherEntityPage :model="vm" /></template>
