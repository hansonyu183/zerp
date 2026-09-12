<script setup lang="ts">
import { computed, ref } from 'vue'
import ReferencePicker from '../dynamic-fields/ReferencePicker.vue'
import CollectionBlock from '../dynamic-fields/CollectionBlock.vue'
import type { EditOption } from '../dynamic-fields/edit-fields.ts'
import type { DetailFields } from '../details/detail-fields.ts'
import type * as api from '../../api.ts'
import OpeningLineEditor from './OpeningLineEditor.vue'
import OpeningAssetEditor from './OpeningAssetEditor.vue'
import OpeningBillEditor from './OpeningBillEditor.vue'
import OpeningContainerEditor from './OpeningContainerEditor.vue'
import { emptyOpening, type OpeningDraft } from './opening-data.ts'
import {
  createOpeningLine,
  createOpeningAsset,
  createOpeningBill,
  createOpeningContainer,
} from './opening-fields.ts'
const props = defineProps<{ modelValue: OpeningDraft; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: OpeningDraft] }>()
const books = ref<
  Awaited<ReturnType<typeof api.queryTargetBookOptions>>['items']
>([])
function adoptBooks(items: readonly EditOption[]) {
  books.value = items.flatMap((item) =>
    item.snapshot ? [item.snapshot as (typeof books.value)[number]] : [],
  )
}
function update(value: Partial<OpeningDraft>) {
  if (!props.disabled)
    emit('update:modelValue', { ...props.modelValue, ...value })
}
function selectBook(bookId: string) {
  if (!props.disabled && bookId !== props.modelValue.bookId)
    emit('update:modelValue', { ...emptyOpening(), bookId })
}
const localOptions = computed(() => ({
  ASSET: props.modelValue.assets.map((row) => ({
    id: row.assetId!,
    name: row.name || row.assetNo || '所选资产',
  })),
  BILL: props.modelValue.bills.map((row) => ({
    id: row.billId!,
    name: row.billNo || '所选票据',
  })),
}))
const lineFields = [
  { key: 'currency', type: 'text', caption: '币种' },
  {
    key: 'direction',
    type: 'enum',
    caption: '借贷方向',
    options: [
      { value: 'DEBIT', caption: '借方' },
      { value: 'CREDIT', caption: '贷方' },
    ],
  },
  { key: 'amount', type: 'text', caption: '金额' },
] as const satisfies DetailFields<OpeningDraft['lines'][number]>
const assetFields = [
  { key: 'name', type: 'text', caption: '名称' },
  { key: 'currency', type: 'text', caption: '币种' },
  { key: 'originalValue', type: 'text', caption: '原值' },
  { key: 'accumulatedDepreciation', type: 'text', caption: '累计折旧' },
] as const satisfies DetailFields<OpeningDraft['assets'][number]>
const billFields = [
  { key: 'billNo', type: 'text', caption: '票据号码' },
  { key: 'currency', type: 'text', caption: '币种' },
  { key: 'valueAmount', type: 'text', caption: '账面金额' },
] as const satisfies DetailFields<OpeningDraft['bills'][number]>
const containerFields = [
  {
    key: 'subunit',
    type: 'group',
    caption: '客户子单位',
    fields: [{ key: 'name', type: 'text', caption: '名称' }],
  },
  { key: 'quantity', type: 'integer', caption: '数量' },
] as const satisfies DetailFields<OpeningDraft['containers'][number]>
</script>
<template>
  <section aria-label="期初分类录入">
    <ReferencePicker
      :source="{ kind: 'book' }"
      caption="账簿"
      :model-value="modelValue.bookId"
      :existing="[]"
      :multiple="false"
      :disabled="disabled"
      @resolved="adoptBooks"
      @update:model-value="selectBook(($event as string) ?? '')"
    />
    <p v-if="!modelValue.lines.length" class="my-3">
      尚无余额明细；无其他登记时将提交零期初。
    </p>
    <CollectionBlock
      caption="期初明细"
      :fields="lineFields"
      :model-value="modelValue.lines"
      mode="edit"
      :disabled="disabled || !modelValue.bookId"
      :create="
        () =>
          createOpeningLine(
            books.find((book) => book.id === modelValue.bookId)?.baseCurrency ??
              'CNY',
          )
      "
      @update:model-value="update({ lines: $event })"
    >
      <template #editor="{ value, disabled: locked, update: updateLine }"
        ><OpeningLineEditor
          :model-value="value"
          :book-id="modelValue.bookId"
          :local-options="localOptions"
          :disabled="locked"
          @update:model-value="updateLine"
      /></template>
      <template #viewer="{ value }"
        ><OpeningLineEditor
          :model-value="value"
          :book-id="modelValue.bookId"
          :local-options="localOptions"
          disabled
      /></template>
    </CollectionBlock>
    <CollectionBlock
      caption="固定资产登记"
      :fields="assetFields"
      :model-value="modelValue.assets"
      mode="edit"
      :disabled="disabled"
      @update:model-value="update({ assets: $event })"
    >
      <template #actions="{ create, disabled: locked }"
        ><div class="collection-create">
          <v-btn
            icon="mdi-plus"
            aria-label="新增资产登记"
            :disabled="locked"
            @click="create(createOpeningAsset())"
            ><v-icon icon="mdi-plus" /><v-tooltip activator="parent"
              >新增资产登记</v-tooltip
            ></v-btn
          ><v-btn
            icon="mdi-link-plus"
            aria-label="关联已有资产"
            :disabled="locked"
            @click="create(createOpeningAsset(true))"
            ><v-icon icon="mdi-link-plus" /><v-tooltip activator="parent"
              >关联已有资产</v-tooltip
            ></v-btn
          >
        </div></template
      >
      <template #editor="{ value, disabled: locked, update: updateAsset }"
        ><OpeningAssetEditor
          :model-value="value"
          :disabled="locked"
          @update:model-value="updateAsset"
      /></template>
      <template #viewer="{ value }"
        ><OpeningAssetEditor :model-value="value" disabled
      /></template>
    </CollectionBlock>
    <CollectionBlock
      caption="票据登记"
      :fields="billFields"
      :model-value="modelValue.bills"
      mode="edit"
      :disabled="disabled"
      @update:model-value="update({ bills: $event })"
    >
      <template #actions="{ create, disabled: locked }"
        ><div class="collection-create">
          <v-btn
            icon="mdi-plus"
            aria-label="新增票据登记"
            :disabled="locked"
            @click="create(createOpeningBill())"
            ><v-icon icon="mdi-plus" /><v-tooltip activator="parent"
              >新增票据登记</v-tooltip
            ></v-btn
          ><v-btn
            icon="mdi-link-plus"
            aria-label="关联已有票据"
            :disabled="locked"
            @click="create(createOpeningBill(true))"
            ><v-icon icon="mdi-link-plus" /><v-tooltip activator="parent"
              >关联已有票据</v-tooltip
            ></v-btn
          >
        </div></template
      >
      <template #editor="{ value, disabled: locked, update: updateBill }"
        ><OpeningBillEditor
          :model-value="value"
          :disabled="locked"
          @update:model-value="updateBill"
      /></template>
      <template #viewer="{ value }"
        ><OpeningBillEditor :model-value="value" disabled
      /></template>
    </CollectionBlock>
    <CollectionBlock
      caption="空桶登记"
      :fields="containerFields"
      :model-value="modelValue.containers"
      mode="edit"
      :disabled="disabled"
      :create="createOpeningContainer"
      @update:model-value="update({ containers: $event })"
    >
      <template #editor="{ value, disabled: locked, update: updateContainer }"
        ><OpeningContainerEditor
          :model-value="value"
          :disabled="locked"
          @update:model-value="updateContainer"
      /></template>
      <template #viewer="{ value }"
        ><OpeningContainerEditor :model-value="value" disabled
      /></template>
    </CollectionBlock>
  </section>
</template>
<style scoped>
.collection-create {
  display: flex;
  gap: 8px;
}
</style>
