<script setup lang="ts">
import { ref } from 'vue'
import type {
  VoucherActionAvailability,
  VoucherStatus,
} from './types'

defineOptions({ name: 'VoucherLifecycleActions' })

const props = withDefaults(defineProps<{
  status: VoucherStatus
  availability: VoucherActionAvailability
  loadingAction?: string | null
  disabled?: boolean
}>(), {
  loadingAction: null,
  disabled: false,
})

const emit = defineEmits<{
  action: [
    action: 'review' | 'approve' | 'execute' |
      'unreview' | 'unapprove' | 'unexecute',
    reason?: string,
  ]
}>()

const reverseOpen = ref(false)
const reverseAction = ref<'unreview' | 'unapprove' | 'unexecute'>('unreview')
const reason = ref('')
const reverseTitle = ref('')

function openReverse(
  action: 'unreview' | 'unapprove' | 'unexecute',
  title: string,
): void {
  reverseAction.value = action
  reverseTitle.value = title
  reason.value = ''
  reverseOpen.value = true
}

function confirmReverse(): void {
  const normalized = reason.value.trim()
  if (!normalized || Array.from(normalized).length > 1000) return
  reverseOpen.value = false
  emit('action', reverseAction.value, normalized)
}
</script>

<template>
  <div class="voucher-lifecycle-actions">
    <v-btn
      v-if="status === 'DRAFT' && availability.review"
      color="primary"
      :disabled="disabled"
      :loading="loadingAction === 'review'"
      prepend-icon="mdi-account-check-outline"
      @click="emit('action', 'review')"
    >
      审核
    </v-btn>
    <template v-if="status === 'REVIEWED'">
      <v-btn
        v-if="availability.unreview"
        :disabled="disabled"
        :loading="loadingAction === 'unreview'"
        prepend-icon="mdi-undo-variant"
        variant="tonal"
        @click="openReverse('unreview', '反审核')"
      >
        反审核
      </v-btn>
      <v-btn
        v-if="availability.approve"
        color="primary"
        :disabled="disabled"
        :loading="loadingAction === 'approve'"
        prepend-icon="mdi-check-decagram-outline"
        @click="emit('action', 'approve')"
      >
        批准
      </v-btn>
    </template>
    <template v-if="status === 'APPROVED'">
      <v-btn
        v-if="availability.unapprove"
        :disabled="disabled"
        :loading="loadingAction === 'unapprove'"
        prepend-icon="mdi-undo-variant"
        variant="tonal"
        @click="openReverse('unapprove', '反批准')"
      >
        反批准
      </v-btn>
      <v-btn
        v-if="availability.execute"
        color="primary"
        :disabled="disabled"
        :loading="loadingAction === 'execute'"
        prepend-icon="mdi-play-circle-outline"
        @click="emit('action', 'execute')"
      >
        执行
      </v-btn>
    </template>
    <v-btn
      v-if="status === 'EXECUTED' && availability.unexecute"
      color="warning"
      :disabled="disabled"
      :loading="loadingAction === 'unexecute'"
      prepend-icon="mdi-backup-restore"
      variant="tonal"
      @click="openReverse('unexecute', '反执行')"
    >
      反执行
    </v-btn>
  </div>

  <v-dialog v-model="reverseOpen" max-width="560">
    <v-card rounded="xl" :title="reverseTitle">
      <v-card-text>
        <v-textarea
          v-model="reason"
          autofocus
          counter="1000"
          label="原因"
          :rules="[
            (value: string) => Boolean(value?.trim()) || '请输入原因。',
            (value: string) => Array.from(value ?? '').length <= 1000 || '原因不能超过 1000 字。',
          ]"
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="reverseOpen = false">取消</v-btn>
        <v-btn
          color="warning"
          :disabled="!reason.trim() || Array.from(reason).length > 1000"
          @click="confirmReverse"
        >
          确认{{ reverseTitle }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.voucher-lifecycle-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
