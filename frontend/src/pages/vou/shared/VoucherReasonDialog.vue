<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: boolean
    reason: string
    title: string
    confirmLabel?: string
    loading?: boolean
    errorMessage?: string | null
  }>(),
  {
    confirmLabel: '确认',
    loading: false,
  },
)

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
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card rounded="xl" :title="title">
      <v-card-text>
        <v-alert
          v-if="errorMessage"
          class="mb-3"
          type="error"
          variant="tonal"
        >
          {{ errorMessage }}
        </v-alert>
        <v-textarea
          autofocus
          counter="1000"
          label="原因"
          :model-value="reason"
          :rules="[
            (value: string) => Boolean(value?.trim()) || '请输入原因。',
            (value: string) =>
              Array.from(value ?? '').length <= 1000 ||
              '原因不能超过 1000 字。',
          ]"
          variant="outlined"
          @update:model-value="emit('update:reason', $event)"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">
          取消
        </v-btn>
        <v-btn
          color="warning"
          :disabled="!reason.trim() || Array.from(reason).length > 1000"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
