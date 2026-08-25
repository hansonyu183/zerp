<script setup lang="ts">
import { ref } from 'vue'
import { MAX_ATTACHMENT_BYTES } from '@/constants/attachments'
import type { CustomerAttachment } from './types'

const props = defineProps<{
  title: string
  attachments: readonly CustomerAttachment[]
  created: boolean
  editable: boolean
  canUpload: boolean
  canDownload: boolean
  canRemove: boolean
  categorySelected: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  upload: [files: File[]]
  download: [attachment: CustomerAttachment]
  remove: [attachment: CustomerAttachment]
}>()

const input = ref<HTMLInputElement | null>(null)
const localError = ref('')

function selectFiles(event: Event): void {
  const target = event.target as HTMLInputElement
  const files = [...(target.files ?? [])]
  target.value = ''
  localError.value = ''
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png'])
  const invalid = files.find(
    (file) =>
      !allowed.has(file.type) ||
      file.size < 1 ||
      file.size > MAX_ATTACHMENT_BYTES,
  )
  if (props.attachments.length + files.length > 10) {
    localError.value = '每个资料范围最多 10 个附件。'
  } else if (invalid) {
    localError.value = `${invalid.name} 不是有效的 PDF、JPEG 或 PNG，或大小超过 10 MiB。`
  } else if (files.length) {
    emit('upload', files)
  }
}

function sizeText(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / 1024 / 1024).toFixed(1)} MiB`
}
</script>

<template>
  <section class="customer-attachment-section">
    <div class="customer-attachment-section__header">
      <div>
        <h4>{{ title }}</h4>
        <span>PDF、JPEG、PNG；每个不超过 10 MiB；最多 10 个</span>
      </div>
      <v-btn
        v-if="canUpload"
        :disabled="
          !created ||
          !editable ||
          !categorySelected ||
          loading ||
          attachments.length >= 10
        "
        :loading="loading"
        prepend-icon="mdi-paperclip-plus"
        variant="tonal"
        @click="input?.click()"
      >
        添加附件
      </v-btn>
      <input
        ref="input"
        accept="application/pdf,image/jpeg,image/png"
        hidden
        multiple
        type="file"
        @change="selectFiles"
      />
    </div>
    <v-alert v-if="!created" density="compact" type="info" variant="tonal">
      请先保存客户，再添加附件。
    </v-alert>
    <v-alert
      v-else-if="localError"
      density="compact"
      type="error"
      variant="tonal"
    >
      {{ localError }}
    </v-alert>
    <v-list v-if="attachments.length" lines="two">
      <v-list-item
        v-for="attachment in attachments"
        :key="attachment.fileId"
        prepend-icon="mdi-file-outline"
        :subtitle="`${attachment.categoryName} · ${sizeText(attachment.size)}`"
        :title="attachment.fileName"
      >
        <template #append>
          <v-chip class="mr-2" size="small" variant="tonal">
            {{ attachment.status === 'READY' ? '已上传' : '待上传' }}
          </v-chip>
          <v-btn
            v-if="canDownload && attachment.status === 'READY'"
            :aria-label="`下载 ${attachment.fileName}`"
            :disabled="loading"
            icon="mdi-download-outline"
            variant="text"
            @click="emit('download', attachment)"
          />
          <v-btn
            v-if="canRemove && editable"
            :aria-label="`移除 ${attachment.fileName}`"
            color="error"
            :disabled="loading"
            icon="mdi-delete-outline"
            variant="text"
            @click="emit('remove', attachment)"
          />
        </template>
      </v-list-item>
    </v-list>
    <div v-else-if="created" class="text-medium-emphasis py-4">暂无附件</div>
  </section>
</template>

<style scoped>
.customer-attachment-section {
  margin-top: 18px;
}
.customer-attachment-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.customer-attachment-section__header h4 {
  margin: 0;
}
.customer-attachment-section__header span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
</style>
