<script setup lang="ts">
import type { VouVersionedReferenceInput } from '@zerp/model'

import type { VouDraftFor, VouReferenceOption } from '../vm.ts'
import PriceLinesEditor, { type PriceLineDraft } from './PriceLinesEditor.vue'
import ReferenceSelect from './ReferenceSelect.vue'

type Entity = 'sale-pricing' | 'purchase-inquiry'

const props = defineProps<{
  entity: Entity
  draft: VouDraftFor<'sale-pricing'> | VouDraftFor<'purchase-inquiry'>
  productOptions: readonly VouReferenceOption[]
  supplierOptions: readonly VouReferenceOption[]
}>()

const emit = defineEmits<{
  save: [draft: VouDraftFor<'sale-pricing'> | VouDraftFor<'purchase-inquiry'>]
}>()

function payload() {
  const value = props.draft.payload
  if (!('priceLines' in value)) throw new Error('定价编辑器收到非定价单据。')
  return value
}

function change(field: 'businessDate' | 'currency' | 'remark', value: string) {
  payload()[field] = value
  emit('save', props.draft)
}

function changeSupplier(value: VouVersionedReferenceInput | undefined) {
  if (props.draft.entity !== 'purchase-inquiry') return
  props.draft.payload.supplier = value ?? {
    objectId: '',
    approvalEntryId: '',
    selectionOrigin: 'CURRENT',
  }
  emit('save', props.draft)
}

function changeLines(value: PriceLineDraft[]) {
  if (props.draft.entity === 'sale-pricing') {
    props.draft.payload = { ...props.draft.payload, priceLines: value }
  } else {
    props.draft.payload = { ...props.draft.payload, priceLines: value }
  }
  emit('save', props.draft)
}
</script>

<template>
  <div class="draft-editor">
    <v-row>
      <v-col cols="12" md="4">
        <v-text-field
          label="业务日期"
          type="date"
          variant="outlined"
          :model-value="payload().businessDate"
          @update:model-value="change('businessDate', $event)"
        />
      </v-col>
      <v-col cols="12" md="4">
        <v-select
          label="币种"
          variant="outlined"
          :items="[{ title: '人民币', value: 'CNY' }]"
          :model-value="payload().currency"
          @update:model-value="change('currency', $event)"
        />
      </v-col>
      <v-col v-if="entity === 'purchase-inquiry'" cols="12" md="4">
        <ReferenceSelect
          label="供应商"
          required
          :model-value="
            draft.entity === 'purchase-inquiry'
              ? draft.payload.supplier
              : undefined
          "
          :options="supplierOptions"
          @update:model-value="changeSupplier"
        />
      </v-col>
      <v-col cols="12">
        <v-text-field
          label="备注"
          maxlength="1000"
          variant="outlined"
          :model-value="payload().remark ?? ''"
          @update:model-value="change('remark', $event)"
        />
      </v-col>
    </v-row>
    <PriceLinesEditor
      :model-value="payload().priceLines"
      :product-options="productOptions"
      @update:model-value="changeLines"
    />
  </div>
</template>
