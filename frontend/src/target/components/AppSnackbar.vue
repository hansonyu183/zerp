<script setup lang="ts">
defineProps<{
  message?: string | null
  type?: 'error' | 'success' | 'info'
  actionLabel?: string
}>()

defineEmits<{ action: []; dismiss: [] }>()
</script>

<template>
  <v-snackbar
    :model-value="Boolean(message)"
    :color="type ?? 'error'"
    timeout="-1"
  >
    {{ message }}
    <template #actions>
      <v-btn v-if="actionLabel" variant="text" @click="$emit('action')">{{
        actionLabel
      }}</v-btn>
      <v-btn
        icon="mdi-close"
        aria-label="关闭提示"
        variant="text"
        @click="$emit('dismiss')"
      />
    </template>
  </v-snackbar>
</template>
