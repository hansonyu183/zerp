<script setup lang="ts">
import DynamicCols from '../dynamic-fields/DynamicCols.vue'
import RowActions from '../dynamic-fields/RowActions.vue'
import type { RowAction } from '../dynamic-fields/types.ts'
defineProps<{
  rows:
    | {
        kind: 'current'
        items: readonly {
          objectId: string
          code: string
          name: string
          enabled: boolean
          actions: readonly RowAction[]
        }[]
      }
    | {
        kind: 'submissions'
        items: readonly {
          subjectId: string
          code: string
          candidateStatus: string
          approvedVersion: string
          actions: readonly RowAction[]
        }[]
      }
  loading: boolean
}>()
const emit = defineEmits<{
  currentAction: [key: string, objectId: string]
  candidate: [subjectId: string]
}>()
</script>
<template>
  <DynamicCols
    v-if="rows.kind === 'current'"
    identity-key="objectId"
    :items="rows.items"
    :loading="loading"
    :fields="[
      { key: 'code', type: 'text', caption: '编码' },
      { key: 'name', type: 'text', caption: '名称' },
      {
        key: 'enabled',
        type: 'boolean',
        caption: '状态',
        trueCaption: '启用',
        falseCaption: '停用',
      },
      { key: '$actions', type: 'actions', caption: '操作' },
    ]"
    ><template #actions="{ item }">
      <RowActions
        :actions="item.actions"
        @action="emit('currentAction', $event, item.objectId)" /></template
  ></DynamicCols>
  <DynamicCols
    v-else
    identity-key="subjectId"
    :items="rows.items"
    :loading="loading"
    :fields="[
      { key: 'code', type: 'text', caption: '编码' },
      { key: 'candidateStatus', type: 'text', caption: '候选版本' },
      { key: 'approvedVersion', type: 'text', caption: '最新批准' },
      { key: '$actions', type: 'actions', caption: '操作' },
    ]"
    ><template #actions="{ item }"
      ><RowActions
        :actions="item.actions"
        @action="emit('candidate', item.subjectId)" /></template
  ></DynamicCols>
</template>
