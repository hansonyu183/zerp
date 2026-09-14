<script setup lang="ts">
import { computed, ref, onBeforeUnmount, nextTick } from 'vue'
import type { TaxInformationSnapshot } from '@zerp/model'
import * as api from '../../api.ts'
import { documentError } from './errors.ts'
import FormBlock from '../dynamic-fields/FormBlock.vue'
import FieldInput from '../dynamic-fields/FieldInput.vue'
import VouReference from './VouReference.vue'
import type { InvoiceDraft } from './invoice-data.ts'
const props = defineProps<{ modelValue: InvoiceDraft; disabled: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: InvoiceDraft]
  pending: [value: boolean]
}>()
const taxes = ref<TaxInformationSnapshot[]>([])
const sources = ref<
  Awaited<ReturnType<typeof api.queryTargetInvoiceSources>>['items']
>([])
const error = ref(''),
  busy = ref(false)
let generation = 0,
  active = true
onBeforeUnmount(() => {
  active = false
  generation++
  emit('pending', false)
})
const partyEntity = computed(() =>
  props.modelValue.entity === 'sale-invoice' ? 'customer' : 'supplier',
)
function patch(value: Partial<InvoiceDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
async function refresh() {
  const request = ++generation,
    value = props.modelValue
  taxes.value = []
  sources.value = []
  error.value = ''
  patch({ taxInformation: null, invoiceLines: [] })
  if (!value.party) {
    busy.value = false
    emit('pending', false)
    return
  }
  busy.value = true
  emit('pending', true)
  try {
    const options = await api.queryTargetInvoiceTaxOptions(
      value.entity,
      value.party.objectId,
    )
    if (!active || request !== generation) return
    if (
      !('approvalEntryId' in value.party) ||
      value.party.approvalEntryId !== options.approvalEntryId
    )
      throw new Error('正式资料已变化，请重新选择客户或供应商。')
    taxes.value = options.items
    patch({
      taxInformation: options.items.length === 1 ? options.items[0]! : null,
    })
    if (!options.items.length)
      error.value = '没有启用的税务信息，请先维护并批准关联。'
    if (value.operatingEntity) {
      const available = await api.queryTargetInvoiceSources(value.entity, {
        objectId: value.party.objectId,
        operatingEntityId: value.operatingEntity.objectId,
        businessDate: value.businessDate,
        currency: value.currency,
      })
      if (active && request === generation) sources.value = available.items
    }
  } catch (cause) {
    if (active && request === generation) error.value = documentError(cause)
  } finally {
    if (active && request === generation) {
      busy.value = false
      emit('pending', false)
    }
  }
}
function fieldsChanged(value: InvoiceDraft) {
  if (
    value.businessDate !== props.modelValue.businessDate ||
    value.currency !== props.modelValue.currency
  )
    void changed(value)
  else patch(value)
}
async function changed(value: Partial<InvoiceDraft>) {
  patch(value)
  busy.value = true
  emit('pending', true)
  await nextTick()
  if (active) await refresh()
}
function add(index: number) {
  const source = sources.value[index]!
  if (
    props.modelValue.invoiceLines.some(
      (line) =>
        line.sourceDocumentId === source.sourceDocumentId &&
        line.sourceLineId === source.sourceLineId,
    )
  )
    return
  patch({
    invoiceLines: [
      ...props.modelValue.invoiceLines,
      {
        sourceDocumentId: source.sourceDocumentId,
        sourceApprovalEntryId: source.sourceApprovalEntryId,
        sourceLineId: source.sourceLineId,
        amount: source.availableAmount,
        documentNo: source.documentNo,
      },
    ],
  })
}
</script>
<template>
  <div class="form-stack">
    <FormBlock
      :fields="[
        {
          key: 'businessDate',
          type: 'date',
          caption: '开票日期',
          required: true,
        },
        { key: 'currency', type: 'text', caption: '币种', required: true },
        { key: 'remark', type: 'textarea', caption: '备注' },
      ]"
      :model-value="modelValue"
      :disabled="disabled || busy"
      @update:model-value="fieldsChanged"
    />
    <VouReference
      :entity="partyEntity"
      :caption="partyEntity === 'customer' ? '客户' : '供应商'"
      :model-value="modelValue.party"
      :disabled="disabled || busy"
      @update:model-value="changed({ party: $event })"
    />
    <VouReference
      entity="operating-entity"
      caption="经营主体"
      :model-value="modelValue.operatingEntity"
      :disabled="disabled || busy"
      @update:model-value="changed({ operatingEntity: $event })"
    />
    <v-btn :disabled="disabled || busy || !modelValue.party" @click="refresh"
      >刷新开票资料</v-btn
    >
    <v-alert v-if="error" type="warning">{{ error }}</v-alert>
    <FieldInput
      usage="edit"
      :field="{
        key: 'taxInformation',
        type: 'choice',
        caption: '税务信息',
        options: taxes.map((item) => ({
          value: item.id,
          caption: `${item.name} · ${item.taxNumber}`,
        })),
      }"
      :model-value="modelValue.taxInformation?.id ?? ''"
      :disabled="disabled || busy"
      @update:model-value="
        patch({
          taxInformation: taxes.find((item) => item.id === $event) ?? null,
        })
      "
    />
    <p v-if="modelValue.taxInformation">
      注册地址：{{
        modelValue.taxInformation.registeredAddress || '—'
      }}；电话：{{ modelValue.taxInformation.phone || '—' }}；开户行：{{
        modelValue.taxInformation.bank || '—'
      }}；账号：{{ modelValue.taxInformation.accountNumber || '—' }}
    </p>
    <section aria-label="待开票来源">
      <h3>待开票来源</h3>
      <p v-if="!sources.length">当前没有可选来源。</p>
      <div
        v-for="(source, index) in sources"
        :key="`${source.sourceDocumentId}:${source.sourceLineId}`"
      >
        {{ source.documentNo }} · {{ source.businessDate }} · 可开票
        {{ source.availableAmount }} {{ source.currency }}
        <v-btn :disabled="disabled || busy" @click="add(index)">添加来源</v-btn>
      </div>
    </section>
    <section
      v-for="(line, index) in modelValue.invoiceLines"
      :key="`${line.sourceDocumentId}:${line.sourceLineId}`"
      :aria-label="`开票来源 ${index + 1}`"
    >
      <p>{{ line.documentNo }}</p>
      <FieldInput
        usage="edit"
        :field="{
          key: 'amount',
          type: 'decimal',
          scale: 2,
          caption: '本次开票金额',
        }"
        :model-value="line.amount"
        :disabled="disabled || busy"
        @update:model-value="
          patch({
            invoiceLines: modelValue.invoiceLines.map((row, i) =>
              i === index ? { ...row, amount: $event } : row,
            ),
          })
        "
      />
      <v-btn
        :disabled="disabled || busy"
        @click="
          patch({
            invoiceLines: modelValue.invoiceLines.filter((_, i) => i !== index),
          })
        "
        >移除来源</v-btn
      >
    </section>
  </div>
</template>
