<script setup lang="ts">
import { ledgerEntityConfigs, LedgerWorkspace } from '@/pages/led/shared'
</script>

<template>
  <LedgerWorkspace :config="ledgerEntityConfigs.fund" />
</template>
