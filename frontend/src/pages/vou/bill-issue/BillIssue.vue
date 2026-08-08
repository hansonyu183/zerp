<script setup lang="ts">
import BillVoucherPage from '../shared/bill/BillVoucherPage.vue'
import { billVoucherConfigs } from '../shared/bill/config'
</script>

<template>
  <BillVoucherPage :config="billVoucherConfigs['bill-issue']" />
</template>
