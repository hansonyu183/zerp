<script setup lang="ts">
defineProps<{
  documentNo: string
  entityLabel: string
  status: string
  statusLabel: string
  revision: number
  parentDocumentId?: string
}>()
</script>

<template>
  <div class="voucher-document-header">
    <div>
      <div class="voucher-document-header__eyebrow">{{ entityLabel }}</div>
      <div class="voucher-document-header__number">{{ documentNo }}</div>
      <div
        v-if="parentDocumentId"
        class="voucher-document-header__parent"
      >
        父单：{{ parentDocumentId }}
      </div>
    </div>
    <v-chip color="primary" variant="tonal">
      {{ statusLabel }} · r{{ revision }}
    </v-chip>
  </div>
</template>

<style scoped>
.voucher-document-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.voucher-document-header__eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.voucher-document-header__number {
  margin-top: 2px;
  font-size: 20px;
  font-weight: 600;
}

.voucher-document-header__parent {
  margin-top: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
</style>
