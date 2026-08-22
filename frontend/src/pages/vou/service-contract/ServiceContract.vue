<script setup lang="ts">
import VoucherEntityPage from '../shared/VoucherEntityPage.vue'
import { voucherEntityConfigs } from '../shared/config'
import { useVoucherEntityViewModel } from '../shared/vm'

const model = useVoucherEntityViewModel(
  voucherEntityConfigs['service-contract'],
)
</script>

<template>
  <VoucherEntityPage :model="model" />
</template>
