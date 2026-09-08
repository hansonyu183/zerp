<script setup lang="ts" generic="Row extends object">
import { computed } from 'vue'

import FieldCol from './FieldCol.vue'
import type { ColumnField, DataField } from './types.ts'
import { validateRows } from './values.ts'

const props = withDefaults(
  defineProps<{
    fields: readonly ColumnField[]
    items: readonly Row[]
    loading?: boolean
    identityKey?: 'id' | 'documentId'
  }>(),
  { loading: false, identityKey: 'id' },
)

defineSlots<{
  actions(props: { item: Row }): unknown
}>()

const headers = computed(() =>
  props.fields.map((field) => ({
    title: field.caption,
    key: field.key,
    sortable: false,
  })),
)

const checkedItems = computed(() => validateRows(props.fields, props.items))
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
