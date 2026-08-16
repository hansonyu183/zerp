<script setup lang="ts">
defineProps<{
  password: string | null
  saved: boolean
  copyErrorMessage: string | null
}>()

const emit = defineEmits<{
  'update:saved': [saved: boolean]
  close: []
  copy: []
}>()
</script>

<template>
  <v-dialog :model-value="Boolean(password)" max-width="480" persistent>
    <v-card title="临时密码">
      <v-card-text>
        <p>请立即安全保存，关闭后无法再次查看。</p>
        <v-text-field
          :model-value="password ?? ''"
          readonly
          label="临时密码"
          variant="outlined"
        />
        <v-alert v-if="copyErrorMessage" type="error" variant="tonal">
          {{ copyErrorMessage }}
        </v-alert>
        <v-checkbox
          :model-value="saved"
          label="我已安全保存临时密码"
          @update:model-value="emit('update:saved', $event)"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="!saved" @click="emit('close')">关闭</v-btn>
        <v-btn color="primary" @click="emit('copy')">复制</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
