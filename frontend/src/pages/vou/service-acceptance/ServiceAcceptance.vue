<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { voucherEntityConfigs } from '../shared/config'
import { useVoucherEntityViewModel } from '../shared/vm'

const model = useVoucherEntityViewModel(
  voucherEntityConfigs['service-acceptance'],
)
</script>

<template>
  <VoucherEntityPage :model="model" />
</template>
