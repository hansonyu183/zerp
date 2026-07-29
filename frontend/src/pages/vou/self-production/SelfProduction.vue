<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useSelfProductionViewModel } from './vm'

const vm = useSelfProductionViewModel()
</script>

<template><VoucherEntityPage :model="vm" /></template>
