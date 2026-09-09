<script setup lang="ts">
import { ulid } from 'ulid'
import FormBlock from '../version-page/FormBlock.vue'
import SourceLinePicker from './SourceLinePicker.vue'
import VouReference from './VouReference.vue'
import { fulfillmentFields, type FulfillmentDraft } from './fulfillment-data.ts'
const props = defineProps<{ modelValue: FulfillmentDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: FulfillmentDraft] }>()
function update(patch: Partial<FulfillmentDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...patch })
}
function line(id: string, patch: Partial<FulfillmentDraft['lines'][number]>) {
  update({
    lines: props.modelValue.lines.map((row) =>
      row.id === id ? { ...row, ...patch } : row,
    ),
  })
}
</script>
<template>
  <FormBlock
    :fields="fulfillmentFields"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <VouReference
    v-if="modelValue.entity !== 'sale-return'"
    entity="supplier"
    caption="供应商"
    :model-value="modelValue.supplier"
    :disabled="disabled"
    @update:model-value="
      update({ supplier: $event, selectionOrigin: 'CURRENT' })
    "
  />
  <VouReference
    entity="warehouse"
    caption="仓库"
    :model-value="modelValue.warehouse"
    :disabled="disabled"
    @update:model-value="update({ warehouse: $event })"
  />
  <FormBlock
    v-if="modelValue.entity !== 'purchase-inbound'"
    :fields="[
      {
        key: 'returnReason',
        type: 'textarea',
        caption: '退货原因',
        required: true,
      },
    ]"
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <section aria-label="来源明细">
    <v-card v-for="row in modelValue.lines" :key="row.id" class="pa-3 my-2">
      <SourceLinePicker
        :entity="modelValue.entity"
        :model-value="row.source"
        :disabled="disabled"
        @update:model-value="line(row.id, { source: $event })"
      />
      <FormBlock
        :fields="[
          {
            key: 'baseQuantity',
            type: 'decimal',
            scale: 6,
            caption: '基准数量',
            required: true,
          },
          { key: 'remark', type: 'text', caption: '行备注' },
        ]"
        :model-value="row"
        :disabled="disabled"
        @update:model-value="line(row.id, $event)"
      />
      <v-btn
        :disabled="disabled"
        @click="
          update({
            lines: modelValue.lines.filter((item) => item.id !== row.id),
          })
        "
        >移除来源行</v-btn
      >
    </v-card>
    <v-btn
      :disabled="disabled"
      @click="
        update({
          lines: [
            ...modelValue.lines,
            { id: ulid(), source: null, baseQuantity: '', remark: '' },
          ],
        })
      "
      >添加来源行</v-btn
    >
  </section>
</template>
