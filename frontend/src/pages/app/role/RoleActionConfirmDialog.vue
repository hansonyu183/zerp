<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  message: string
  loading: boolean
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
</script>

<template>
  <v-dialog :model-value="open" max-width="480" persistent>
    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-card-text>{{ message }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="loading" @click="emit('cancel')">取消</v-btn>
        <v-btn color="primary" :loading="loading" @click="emit('confirm')">
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
