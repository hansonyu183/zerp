<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useOtherIncomeViewModel } from './vm'
const vm = useOtherIncomeViewModel()
</script>
<template><VoucherEntityPage :model="vm" /></template>
