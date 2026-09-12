<script setup lang="ts">
import type { getTargetOpening } from '../../api.ts'
import SnapshotValue from './SnapshotValue.vue'
defineProps<{ document: Awaited<ReturnType<typeof getTargetOpening>> }>()
</script>
<template>
  <section data-testid="opening-snapshot">
    <p>账簿：{{ document.bookName }} · 起始日期：{{ document.businessDate }}</p>
    <p v-if="!document.payload.lines.length">零余额期初。</p>
    <SnapshotValue v-else :value="document.payload.lines" field="lines" />
    <h3 class="text-subtitle-1">固定资产登记</h3>
    <SnapshotValue :value="document.payload.assets" field="assets" />
    <h3 class="text-subtitle-1">票据登记</h3>
    <SnapshotValue :value="document.payload.bills" field="bills" />
    <h3 class="text-subtitle-1">空桶登记</h3>
    <SnapshotValue :value="document.payload.containers" field="containers" />
  </section>
</template>
