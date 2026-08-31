<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  VoucherActionAvailability,
  VoucherLifecycleAction,
} from './types'
import { approvalActionPresentation } from '@/shared/approval'

defineOptions({ name: 'VoucherLifecycleActions' })

const props = withDefaults(
  defineProps<{
    availability: VoucherActionAvailability
    loadingAction?: string | null
    disabled?: boolean
    disabledReason?: string
  }>(),
  {
    loadingAction: null,
    disabled: false,
    disabledReason: '当前操作暂不可用。',
  },
)

const emit = defineEmits<{
  action: [action: VoucherLifecycleAction, reason?: string]
}>()

const reverseOpen = ref(false)
const reverseAction = ref<Extract<VoucherLifecycleAction, 'reject' | 'unapprove'>>(
  'reject',
)
const reason = ref('')
const reverseTitle = ref('')

function openReverse(
  action: Extract<VoucherLifecycleAction, 'reject' | 'unapprove'>,
): void {
  reverseAction.value = action
  reverseTitle.value = approvalActionPresentation[action].label
  reason.value = ''
  reverseOpen.value = true
}

function confirmReverse(): void {
  const normalized = reason.value.trim()
  if (!normalized || Array.from(normalized).length > 1000) return
  reverseOpen.value = false
  emit('action', reverseAction.value, normalized)
}

const actions = computed(() =>
  (Object.keys(approvalActionPresentation) as VoucherLifecycleAction[]).filter(
    (action) => props.availability[action],
  ),
)

function run(action: VoucherLifecycleAction): void {
  if (approvalActionPresentation[action].reasonRequired) {
    openReverse(action as Extract<VoucherLifecycleAction, 'reject' | 'unapprove'>)
    return
  }
  emit('action', action)
}
</script>

<template>
  <div class="voucher-lifecycle-actions">
    <v-btn
      v-for="action in actions"
      :key="action"
      :color="approvalActionPresentation[action].color"
      :disabled="disabled"
      :loading="loadingAction === action"
      :title="disabled ? disabledReason : undefined"
      :prepend-icon="approvalActionPresentation[action].icon"
      variant="tonal"
      @click="run(action)"
    >
      {{ approvalActionPresentation[action].label }}
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
