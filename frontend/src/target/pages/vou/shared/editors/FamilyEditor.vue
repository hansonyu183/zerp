<script setup lang="ts">
import type { VouEntity, VouPayload, VouSourceLineCandidate } from '@zerp/model'

import type { VouEditorKind } from '../config.ts'
import type { VouReferenceOption } from '../vm.ts'
import AssetEditor from './AssetEditor.vue'
import BillEditor from './BillEditor.vue'
import ExpenseEditor from './ExpenseEditor.vue'
import FlowEditor from './FlowEditor.vue'
import FundsEditor from './FundsEditor.vue'
import IntermediaryEditor from './IntermediaryEditor.vue'
import ProductionInventoryEditor from './ProductionInventoryEditor.vue'
import ServiceEditor from './ServiceEditor.vue'

withDefaults(
  defineProps<{
    entity: VouEntity
    editor: VouEditorKind
    payload: VouPayload
    referenceOptions: Partial<Record<string, VouReferenceOption[]>>
    sourceLineOptions?: readonly VouSourceLineCandidate[]
    editable?: boolean
  }>(),
  { editable: true, sourceLineOptions: () => [] },
)
const emit = defineEmits<{ change: []; 'source-search': [keyword: string] }>()

const flowEditors: readonly VouEditorKind[] = [
  'source-lines',
  'signoff-lines',
  'return-lines',
]
</script>

<template>
  <FlowEditor
    v-if="flowEditors.includes(editor)"
    :entity="entity"
    :payload="payload"
    :reference-options="referenceOptions"
    :source-line-options="sourceLineOptions"
    :editable="editable"
    @change="emit('change')"
    @source-search="emit('source-search', $event)"
  />
  <ProductionInventoryEditor
    v-else-if="
      editor === 'production-lines' || editor === 'inventory-count-lines'
    "
    :entity="entity"
    :payload="payload"
    :reference-options="referenceOptions"
    :source-line-options="sourceLineOptions"
    :editable="editable"
    @change="emit('change')"
    @source-search="emit('source-search', $event)"
  />
  <FundsEditor
    v-else-if="editor === 'amount'"
    :entity="entity"
    :payload="payload"
    :reference-options="referenceOptions"
    :editable="editable"
    @change="emit('change')"
  />
  <ExpenseEditor
    v-else-if="editor === 'expense-lines'"
    :payload="payload"
    :reference-options="referenceOptions"
    :editable="editable"
    @change="emit('change')"
  />
  <AssetEditor
    v-else-if="
      editor === 'asset-acquisition-lines' ||
      editor === 'asset-sale-lines' ||
      editor === 'asset-liquidation-lines'
    "
    :payload="payload"
    :reference-options="referenceOptions"
    :editable="editable"
    @change="emit('change')"
  />
  <BillEditor
    v-else-if="editor === 'bill-lines'"
    :entity="entity"
    :payload="payload"
    :reference-options="referenceOptions"
    :editable="editable"
    @change="emit('change')"
  />
  <IntermediaryEditor
    v-else-if="editor === 'intermediary-calculation'"
    :payload="payload"
    :editable="editable"
    @change="emit('change')"
  />
  <ServiceEditor
    v-else-if="editor === 'service-contract' || editor === 'service-acceptance'"
    :payload="payload"
    :reference-options="referenceOptions"
    :editable="editable"
    @change="emit('change')"
  />
  <v-alert v-else type="error">该业务家族尚未登记专属编辑器。</v-alert>
</template>
