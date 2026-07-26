<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useReceiptViewModel } from './vm'
const vm = useReceiptViewModel()
</script>
<template><VoucherEntityPage :model="vm" /></template>
