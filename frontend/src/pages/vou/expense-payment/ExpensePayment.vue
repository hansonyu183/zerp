<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useExpensePaymentViewModel } from './vm'

const vm = useExpensePaymentViewModel()
</script>

<template><VoucherEntityPage :model="vm" /></template>
