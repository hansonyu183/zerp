<script setup lang="ts">
import { actionIcons } from '../../presentation/action-icons.ts'
export type ListPagination =
  | { mode: 'total'; page: number; pageSize: number; total: number }
  | { mode: 'more'; page: number; hasMore: boolean }
defineProps<{ pagination: ListPagination; disabled?: boolean }>()
const emit = defineEmits<{ page: [value: number] }>()
</script>
<template>
  <div class="d-flex flex-wrap align-center ga-2">
    <template v-if="pagination.mode === 'total'">
      <span>共 {{ pagination.total }} 项</span>
      <v-pagination
        v-if="pagination.total > pagination.pageSize"
        :model-value="pagination.page"
        :length="Math.ceil(pagination.total / pagination.pageSize)"
        :disabled="disabled"
        :prev-icon="actionIcons.previous"
        :next-icon="actionIcons.next"
        @update:model-value="emit('page', $event)"
      />
    </template>
    <template v-else>
      <v-btn
        :prepend-icon="actionIcons.previous"
        :disabled="disabled || pagination.page <= 1"
        @click="emit('page', pagination.page - 1)"
        >上一页</v-btn
      >
      <span>第 {{ pagination.page }} 页</span>
      <v-btn
        :append-icon="actionIcons.next"
        :disabled="disabled || !pagination.hasMore"
        @click="emit('page', pagination.page + 1)"
        >下一页</v-btn
      >
    </template>
  </div>
</template>
