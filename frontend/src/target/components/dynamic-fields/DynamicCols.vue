<script setup lang="ts" generic="Row extends object">
import { computed } from 'vue'

import FieldCol from './FieldCol.vue'
import ListSurface from './ListSurface.vue'
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
  <ListSurface
    :headers="headers"
    :items="checkedItems"
    :identity-key="identityKey as Extract<keyof Row, string>"
    :loading="loading"
  >
    <template #cell="{ item, column }">
      <slot v-if="column === '$actions'" name="actions" :item="item" />
      <FieldCol
        v-else
        :field="fields.find((field) => field.key === column) as DataField"
        :value="item[column as keyof Row]"
      />
    </template>
  </ListSurface>
</template>
