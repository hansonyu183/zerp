<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useInventoryCountViewModel } from './vm'

const model = useInventoryCountViewModel()
</script>

<template><VoucherEntityPage :model="model" /></template>
