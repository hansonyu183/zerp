<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useExpenseReimbursementViewModel } from './vm'
const vm = useExpenseReimbursementViewModel()
</script>
<template><VoucherEntityPage :model="vm" /></template>
