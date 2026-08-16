<script setup lang="ts">
defineProps<{ open: boolean }>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="420"
    @update:model-value="!$event && emit('cancel')"
  >
    <v-card title="放弃修改？">
      <v-card-text>未保存的内容将被清除。</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('cancel')">继续编辑</v-btn>
        <v-btn color="error" @click="emit('confirm')">放弃</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
