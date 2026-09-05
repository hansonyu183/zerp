<script setup lang="ts">
import VouWorkspace from '../shared/VouWorkspace.vue'
import { useVouPageController } from '../shared/vm.ts'
import OrderDraftEditor from '../shared/editors/OrderDraftEditor.vue'
import ProductLinesEditor from '../shared/editors/ProductLinesEditor.vue'

const model = useVouPageController('sale-order')
</script>

<template>
  <div data-vou-page="vou-sale-order-page">
    <VouWorkspace entity="sale-order" :model="model">
      <template #draft="{ draft, referenceOptions }">
        <OrderDraftEditor
          entity="sale-order"
          :draft="draft"
          :line-id="model.createId"
          :reference-options="referenceOptions"
          @save="model.saveFamilyDraft"
        />
      </template>
      <template #detail="{ view, referenceOptions }">
        <ProductLinesEditor
          :line-id="model.createId"
          :model-value="view.payload.productLines"
          :product-options="referenceOptions.product ?? []"
          :unit-options="referenceOptions['measurement-unit'] ?? []"
          :editable="false"
        />
      </template>
    </VouWorkspace>
  </div>
</template>
