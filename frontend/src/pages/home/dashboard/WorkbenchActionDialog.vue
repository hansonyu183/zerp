<script setup lang="ts">
import { computed } from 'vue'
import type { WorkbenchConfirmationAction, WorkbenchItem } from './vm'

const props = defineProps<{
  action: WorkbenchConfirmationAction | null
  target: WorkbenchItem | null
  comment: string
  loading: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: []
  'update:comment': [value: string]
}>()

const needsComment = computed(
  () => props.action === 'reject' || props.action === 'unsubmit',
)
const title = computed(() => {
  if (props.action === 'reject') return '驳回资料'
  if (props.action === 'unsubmit') return '撤回提交'
  return '反核对'
})
const prompt = computed(() => {
  if (!props.target) return ''
  if (props.action === 'reject' && props.target.category === 'BOB') {
    return `请输入驳回 ${props.target.code} 的审核意见。`
  }
  if (props.action === 'unsubmit' && props.target.category === 'BOB') {
    return `请输入撤回 ${props.target.code} 提交的原因。`
  }
  if (props.action === 'uncheck' && props.target.category === 'VOU') {
    return `确认将 ${props.target.documentNo} 退回草稿吗？`
  }
  return ''
})
const commentLabel = computed(() =>
  props.action === 'reject' ? '驳回意见' : '撤回原因',
)
const confirmLabel = computed(() => {
  if (props.action === 'reject') return '确认驳回'
  if (props.action === 'unsubmit') return '确认撤回'
  return '确认反核对'
})
const confirmColor = computed(() =>
  props.action === 'reject' ? 'error' : 'warning',
)

function close(value: boolean): void {
  if (!value) emit('close')
}

function updateComment(value: unknown): void {
  emit('update:comment', typeof value === 'string' ? value : '')
}
</script>

<template>
  <v-dialog
    :model-value="Boolean(action && target)"
    :max-width="needsComment ? 520 : 440"
    @update:model-value="close"
  >
    <v-card rounded="xl" :title="title">
      <v-card-text>
        <p :class="{ 'mb-4': needsComment }">{{ prompt }}</p>
        <v-textarea
          v-if="needsComment"
          autofocus
          counter="1000"
          :label="commentLabel"
          maxlength="1000"
          :model-value="comment"
          rows="4"
          variant="outlined"
          @update:model-value="updateComment"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('close')">取消</v-btn>
        <v-btn
          :color="confirmColor"
          :disabled="needsComment && !comment.trim()"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
