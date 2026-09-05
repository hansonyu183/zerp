<script setup lang="ts">
import VouWorkspace from '../shared/VouWorkspace.vue'
import { useVouPageController } from '../shared/vm.ts'
import PricingDraftEditor from '../shared/editors/PricingDraftEditor.vue'
import PriceLinesEditor from '../shared/editors/PriceLinesEditor.vue'

const model = useVouPageController('purchase-inquiry')
</script>

<template>
  <div data-vou-page="vou-purchase-inquiry-page">
    <VouWorkspace entity="purchase-inquiry" :model="model">
      <template #draft="{ draft, referenceOptions }">
        <PricingDraftEditor
          entity="purchase-inquiry"
          :draft="draft"
          :product-options="referenceOptions.product ?? []"
          :supplier-options="referenceOptions.supplier ?? []"
          @save="model.saveFamilyDraft"
        />
      </template>
      <template #detail="{ view, referenceOptions }">
        <PriceLinesEditor
          :model-value="view.payload.priceLines"
          :product-options="referenceOptions.product ?? []"
          :editable="false"
        />
      </template>
    </VouWorkspace>
  </div>
</template>
