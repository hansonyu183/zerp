<script setup lang="ts" generic="Row extends object">
import { computed } from 'vue'

import FieldCol from './FieldCol.vue'
import type { ColumnField, DataField } from './types.ts'
import { FieldContractError } from './contract.ts'
import { validateRows } from './values.ts'

const props = withDefaults(
  defineProps<{
    fields: readonly ColumnField[]
    items: readonly Row[]
    loading?: boolean
    identityKey?: Extract<keyof Row, string>
  }>(),
  { loading: false, identityKey: 'id' as Extract<keyof Row, string> },
)

defineSlots<{
  actions?(props: { item: Row }): unknown
}>()

const headers = computed(() =>
  props.fields.map((field) => ({
    title: field.caption,
    key: field.key,
    sortable: false,
    width: field.width,
    minWidth: field.width,
  })),
)

const checkedItems = computed(() => {
  const rows = validateRows(props.fields, props.items, {
    requireActions: false,
  })
  const keys = new Set<string>()
  for (const row of rows) {
    const key = row[props.identityKey as keyof Row]
    if (typeof key !== 'string' || !key || keys.has(key))
      throw new FieldContractError('列表行身份必须非空且唯一')
    keys.add(key)
  }
  return rows
})
</script>

<template>
  <v-data-table
    :headers="headers"
    :items="checkedItems"
    :item-value="identityKey"
    :loading="loading"
    :items-per-page="-1"
    disable-sort
    hide-default-footer
  >
    <template
      v-for="field in fields"
      :key="field.key"
      #[`item.${field.key}`]="{ item }"
    >
      <slot v-if="field.type === 'actions'" name="actions" :item="item" />
      <FieldCol
        v-else
        :field="field as DataField"
        :value="item[field.key as keyof Row]"
      />
    </template>
    <template #no-data>暂无数据。</template>
  </v-data-table>
</template>
