<script setup lang="ts">
import type { VouVersionedReferenceInput } from '@zerp/model'

import type { VouDraftFor, VouReferenceOption } from '../vm.ts'
import ProductLinesEditor, {
  type ProductLineDraft,
} from './ProductLinesEditor.vue'
import ReferenceSelect from './ReferenceSelect.vue'

type Entity = 'sale-order' | 'purchase-order'
const props = defineProps<{
  entity: Entity
  draft: VouDraftFor<'sale-order'> | VouDraftFor<'purchase-order'>
  referenceOptions: Partial<Record<string, VouReferenceOption[]>>
  lineId: () => string
}>()

const emit = defineEmits<{
  save: [draft: VouDraftFor<'sale-order'> | VouDraftFor<'purchase-order'>]
}>()

function payload() {
  const value = props.draft.payload
  if (!('productLines' in value)) throw new Error('订单编辑器收到非订单单据。')
  return value
}

function salePayload() {
  if (props.draft.entity !== 'sale-order')
    throw new Error('销售订单编辑器收到非销售订单。')
  return props.draft.payload
}

function purchasePayload() {
  if (props.draft.entity !== 'purchase-order')
    throw new Error('采购订单编辑器收到非采购订单。')
  return props.draft.payload
}

function change(field: 'businessDate' | 'currency' | 'remark', value: string) {
  payload()[field] = value
  emit('save', props.draft)
}

function changeCreditReason(value: string) {
  const valuePayload = payload()
  if ('creditOverrideReason' in valuePayload)
    valuePayload.creditOverrideReason = value
  emit('save', props.draft)
}

function changeReference(
  field: string,
  value: VouVersionedReferenceInput | undefined,
) {
  const reference = value ?? {
    objectId: '',
    approvalEntryId: '',
    selectionOrigin: 'CURRENT' as const,
  }
  const valuePayload = payload()
  if (field === 'customerSubunit' && 'customerSubunit' in valuePayload)
    valuePayload.customerSubunit = reference
  else if (field === 'operatingEntity' && 'operatingEntity' in valuePayload)
    valuePayload.operatingEntity = reference
  else if (field === 'salesperson' && 'salesperson' in valuePayload)
    valuePayload.salesperson = value
  else if (field === 'supplier' && 'supplier' in valuePayload)
    valuePayload.supplier = reference
  else if (field === 'purchaser' && 'purchaser' in valuePayload)
    valuePayload.purchaser = value
  else if (field === 'warehouse' && 'warehouse' in valuePayload)
    valuePayload.warehouse = reference
  emit('save', props.draft)
}

function changeLines(value: ProductLineDraft[]) {
  if (props.draft.entity === 'sale-order') {
    props.draft.payload = { ...props.draft.payload, productLines: value }
  } else {
    props.draft.payload = { ...props.draft.payload, productLines: value }
  }
  emit('save', props.draft)
}
</script>

<template>
  <div class="draft-editor">
    <v-row>
      <v-col cols="12" md="3">
        <v-text-field
          label="业务日期"
          type="date"
          variant="outlined"
          :model-value="payload().businessDate"
          @update:model-value="change('businessDate', $event)"
        />
      </v-col>
      <v-col cols="12" md="3">
        <v-select
          label="币种"
          variant="outlined"
          :items="[{ title: '人民币', value: 'CNY' }]"
          :model-value="payload().currency"
          @update:model-value="change('currency', $event)"
        />
      </v-col>
      <v-col v-if="entity === 'sale-order'" cols="12" md="3">
        <ReferenceSelect
          label="客户子户"
          required
          :model-value="salePayload().customerSubunit"
          :options="referenceOptions['customer-subunit'] ?? []"
          @update:model-value="changeReference('customerSubunit', $event)"
        />
      </v-col>
      <v-col v-if="entity === 'sale-order'" cols="12" md="3">
        <ReferenceSelect
          label="经营主体"
          required
          :model-value="salePayload().operatingEntity"
          :options="referenceOptions['operating-entity'] ?? []"
          @update:model-value="changeReference('operatingEntity', $event)"
        />
      </v-col>
      <v-col v-if="entity === 'sale-order'" cols="12" md="3">
        <ReferenceSelect
          label="销售员"
          :model-value="salePayload().salesperson"
          :options="referenceOptions.employee ?? []"
          @update:model-value="changeReference('salesperson', $event)"
        />
      </v-col>
      <v-col v-if="entity === 'purchase-order'" cols="12" md="3">
        <ReferenceSelect
          label="供应商"
          required
          :model-value="purchasePayload().supplier"
          :options="referenceOptions.supplier ?? []"
          @update:model-value="changeReference('supplier', $event)"
        />
      </v-col>
      <v-col v-if="entity === 'purchase-order'" cols="12" md="3">
        <ReferenceSelect
          label="采购员"
          :model-value="purchasePayload().purchaser"
          :options="referenceOptions.employee ?? []"
          @update:model-value="changeReference('purchaser', $event)"
        />
      </v-col>
      <v-col cols="12" md="3">
        <ReferenceSelect
          label="仓库"
          required
          :model-value="payload().warehouse"
          :options="referenceOptions.warehouse ?? []"
          @update:model-value="changeReference('warehouse', $event)"
        />
      </v-col>
      <v-col v-if="entity === 'sale-order'" cols="12" md="6">
        <v-text-field
          label="超信用额度原因"
          maxlength="1000"
          variant="outlined"
          :model-value="salePayload().creditOverrideReason ?? ''"
          @update:model-value="changeCreditReason"
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-text-field
          label="备注"
          maxlength="1000"
          variant="outlined"
          :model-value="payload().remark ?? ''"
          @update:model-value="change('remark', $event)"
        />
      </v-col>
    </v-row>
    <ProductLinesEditor
      :line-id="lineId"
      :model-value="payload().productLines"
      :product-options="referenceOptions.product ?? []"
      :unit-options="referenceOptions['measurement-unit'] ?? []"
      @update:model-value="changeLines"
    />
  </div>
</template>
