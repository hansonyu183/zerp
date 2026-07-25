<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  reason: string
  loading?: boolean
  warning?: string
  confirmLabel?: string
}>()

const reasonLength = computed(() => Array.from(props.reason.trim()).length)
const reasonError = computed(() => {
  if (reasonLength.value === 0) return '原因不能为空。'
  if (reasonLength.value > 1000) return '原因不能超过 1000 字。'
  return ''
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:reason': [value: string]
  confirm: []
}>()
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card :title="title">
      <v-card-text>
        <v-alert v-if="warning" class="mb-4" type="warning" variant="tonal">
          {{ warning }}
        </v-alert>
        <v-textarea
          counter="1000"
          :error-messages="reasonError ? [reasonError] : []"
          label="原因"
          :model-value="reason"
          variant="outlined"
          @update:model-value="emit('update:reason', $event ?? '')"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">
          取消
        </v-btn>
        <v-btn
          color="error"
          :disabled="Boolean(reasonError)"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmLabel || '确认' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
