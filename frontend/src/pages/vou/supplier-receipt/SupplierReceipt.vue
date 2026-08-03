<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
const vm = useVoucherEntityViewModel(voucherEntityConfigs['supplier-receipt'])
</script>
<template><VoucherEntityPage :model="vm" /></template>
