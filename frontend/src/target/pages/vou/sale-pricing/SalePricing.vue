<script setup lang="ts">
import VouWorkspace from '../shared/VouWorkspace.vue'
import { useVouPageController } from '../shared/vm.ts'
import PriceLinesEditor from '../shared/editors/PriceLinesEditor.vue'
import PricingDraftEditor from '../shared/editors/PricingDraftEditor.vue'

const model = useVouPageController('sale-pricing')
</script>

<template>
  <div data-vou-page="vou-sale-pricing-page">
    <VouWorkspace entity="sale-pricing" :model="model">
      <template #draft="{ draft, referenceOptions }">
        <PricingDraftEditor
          entity="sale-pricing"
          :draft="draft"
          :product-options="referenceOptions.product ?? []"
          :supplier-options="[]"
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
