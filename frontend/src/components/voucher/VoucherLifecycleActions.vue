<script setup lang="ts">
import { ref } from 'vue'
import type {
  VoucherActionAvailability,
  VoucherLifecycleLabels,
  VoucherStatus,
} from './types'

defineOptions({ name: 'VoucherLifecycleActions' })

const props = withDefaults(
  defineProps<{
    status: VoucherStatus
    availability: VoucherActionAvailability
    loadingAction?: string | null
    disabled?: boolean
    disabledReason?: string
    labels: VoucherLifecycleLabels
  }>(),
  {
    loadingAction: null,
    disabled: false,
    disabledReason: '当前操作暂不可用。',
  },
)

const emit = defineEmits<{
  action: [
    action:
      'check' | 'approve' | 'finalize' | 'uncheck' | 'unapprove' | 'unfinalize',
    reason?: string,
  ]
}>()

const reverseOpen = ref(false)
const reverseAction = ref<'uncheck' | 'unapprove' | 'unfinalize'>('uncheck')
const reason = ref('')
const reverseTitle = ref('')

function openReverse(
  action: 'uncheck' | 'unapprove' | 'unfinalize',
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
      v-if="status === 'DRAFT' && availability.check"
      color="primary"
      :disabled="disabled"
      :loading="loadingAction === 'check'"
      :title="disabled ? disabledReason : undefined"
      prepend-icon="mdi-account-check-outline"
      @click="emit('action', 'check')"
    >
      {{ labels.check }}
    </v-btn>
    <template v-if="status === 'CHECKED'">
      <v-btn
        v-if="availability.uncheck"
        :disabled="disabled"
        :loading="loadingAction === 'uncheck'"
        :title="disabled ? disabledReason : undefined"
        prepend-icon="mdi-undo-variant"
        variant="tonal"
        @click="openReverse('uncheck', labels.uncheck)"
      >
        {{ labels.uncheck }}
      </v-btn>
      <v-btn
        v-if="availability.approve"
        color="primary"
        :disabled="disabled"
        :loading="loadingAction === 'approve'"
        :title="disabled ? disabledReason : undefined"
        prepend-icon="mdi-check-decagram-outline"
        @click="emit('action', 'approve')"
      >
        {{ labels.approve }}
      </v-btn>
    </template>
    <template v-if="status === 'APPROVED'">
      <v-btn
        v-if="availability.unapprove"
        :disabled="disabled"
        :loading="loadingAction === 'unapprove'"
        :title="disabled ? disabledReason : undefined"
        prepend-icon="mdi-undo-variant"
        variant="tonal"
        @click="openReverse('unapprove', labels.unapprove)"
      >
        {{ labels.unapprove }}
      </v-btn>
      <v-btn
        v-if="availability.finalize"
        color="primary"
        :disabled="disabled"
        :loading="loadingAction === 'finalize'"
        :title="disabled ? disabledReason : undefined"
        prepend-icon="mdi-play-circle-outline"
        @click="emit('action', 'finalize')"
      >
        {{ labels.finalize }}
      </v-btn>
    </template>
    <v-btn
      v-if="status === 'FINALIZED' && availability.unfinalize"
      color="warning"
      :disabled="disabled"
      :loading="loadingAction === 'unfinalize'"
      :title="disabled ? disabledReason : undefined"
      prepend-icon="mdi-backup-restore"
      variant="tonal"
      @click="openReverse('unfinalize', labels.unfinalize)"
    >
      {{ labels.unfinalize }}
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
            (value: string) =>
              Array.from(value ?? '').length <= 1000 ||
              '原因不能超过 1000 字。',
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
