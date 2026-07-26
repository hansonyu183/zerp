<script setup lang="ts">
import { ledgerEntityConfigs, LedgerWorkspace } from '@/components/ledger'
</script>

<template>
  <LedgerWorkspace :config="ledgerEntityConfigs.inventory" />
</template>
