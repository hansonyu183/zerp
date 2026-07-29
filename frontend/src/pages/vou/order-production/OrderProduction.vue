<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useOrderProductionViewModel } from './vm'

const vm = useOrderProductionViewModel()
</script>

<template><VoucherEntityPage :model="vm" /></template>
