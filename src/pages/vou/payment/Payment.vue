<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { usePaymentViewModel } from './vm'
const vm = usePaymentViewModel()
</script>
<template><VoucherEntityPage :model="vm" /></template>
