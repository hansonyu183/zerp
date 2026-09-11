<script setup lang="ts">
import type { VouDetail } from './list-runtime.ts'
import OpeningSnapshot from './OpeningSnapshot.vue'
import OrderSnapshot from './OrderSnapshot.vue'
import SnapshotValue from './SnapshotValue.vue'
import AttachmentBlock from '../attachments/AttachmentBlock.vue'
defineProps<{ document: VouDetail }>()
</script>
<template>
  <OpeningSnapshot v-if="document.entity === 'opening'" :document="document" />
  <OrderSnapshot
    v-else-if="
      document.entity === 'sale-order' || document.entity === 'purchase-order'
    "
    :payload="document.payload"
  />
  <section v-else data-testid="vou-catalog-snapshot">
    <SnapshotValue :value="document.payload" />
  </section>
  <AttachmentBlock
    v-if="document.entity !== 'opening'"
    caption="附件"
    :model-value="document.payload.attachments"
    mode="read"
    :source="{
      source: 'voucher',
      entity: document.entity,
      documentId: document.documentId,
      submissionId: document.submissionId,
    }"
  />
</template>
