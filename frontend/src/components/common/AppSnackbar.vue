<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { containsChineseText, sanitizeUserMessage } from '@/api/types'

defineOptions({ name: 'AppSnackbar' })

const props = withDefaults(
  defineProps<{
    message?: string | null
    type?: 'error' | 'success' | 'info' | 'warning'
    timeout?: number
    actionLabel?: string
  }>(),
  {
    message: null,
    type: 'error',
    timeout: 5000,
  },
)

const emit = defineEmits<{ action: []; dismiss: [] }>()
const open = ref(false)
const displayMessage = computed(() => {
  const message = sanitizeUserMessage(props.message ?? '')
  if (props.type === 'error' && message && !containsChineseText(message)) {
    return '操作失败，请稍后重试。'
  }
  return message
})

watch(
  displayMessage,
  (message) => {
    open.value = Boolean(message)
  },
  { immediate: true },
)

function changeOpen(value: boolean): void {
  open.value = value
  if (!value) emit('dismiss')
}
</script>

<template>
  <v-snackbar
    color="surface"
    location="top end"
    :model-value="open"
    :timeout="timeout"
    @update:model-value="changeOpen"
  >
    <div class="app-snackbar__content">
      <v-icon
        :color="type"
        :icon="
          type === 'success'
            ? 'mdi-check-circle-outline'
            : type === 'warning'
              ? 'mdi-alert-outline'
              : type === 'info'
                ? 'mdi-information-outline'
                : 'mdi-alert-circle-outline'
        "
      />
      <span>{{ displayMessage }}</span>
    </div>
    <template #actions>
      <v-btn v-if="actionLabel" variant="text" @click="emit('action')">
        {{ actionLabel }}
      </v-btn>
      <v-btn
        aria-label="关闭提示"
        icon="mdi-close"
        @click="changeOpen(false)"
      />
    </template>
  </v-snackbar>
</template>

<style scoped>
.app-snackbar__content {
  display: flex;
  gap: 10px;
  align-items: center;
}
</style>
