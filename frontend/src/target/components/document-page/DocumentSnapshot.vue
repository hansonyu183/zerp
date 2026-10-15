<script setup lang="ts">
import type { VouDetail } from './list-runtime.ts'
import OpeningSnapshot from './OpeningSnapshot.vue'
import OrderSnapshot from './OrderSnapshot.vue'
import SnapshotValue from './SnapshotValue.vue'
import AttachmentBlock from '../attachments/AttachmentBlock.vue'
defineProps<{ document: VouDetail }>()
</script>
<template>
  <section
    v-if="'priorFact' in document.payload && document.payload.priorFact"
    data-testid="vou-prior-fact-snapshot"
  >
    <h3>此前事实承接</h3>
    <p>已保存原单据事实；批准不会再次产生库存、会计或流程效果。</p>
    <SnapshotValue :value="document.payload.priorFact" />
  </section>
  <section
    v-if="'priorSaleDisposition' in document && document.priorSaleDisposition"
    data-testid="vou-prior-sale-disposition"
  >
    <h3>封存截止的销售履行</h3>
    <p>
      未证明的损耗和在途保持未知；这里保留此前事实，不代表迁入后的当前剩余量。
    </p>
    <SnapshotValue :value="document.priorSaleDisposition" />
  </section>
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
