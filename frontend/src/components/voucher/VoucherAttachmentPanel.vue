<script setup lang="ts">
import { ref } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import type { VoucherAttachment } from './types'

defineOptions({ name: 'VoucherAttachmentPanel' })

const props = withDefaults(
  defineProps<{
    attachments: readonly VoucherAttachment[]
    draft?: boolean
    canUpload?: boolean
    canDownload?: boolean
    canRemove?: boolean
    loading?: boolean
    documentCreated?: boolean
    errorMessage?: string | null
  }>(),
  {
    draft: false,
    canUpload: false,
    canDownload: false,
    canRemove: false,
    loading: false,
    documentCreated: false,
    errorMessage: null,
  },
)

const emit = defineEmits<{
  upload: [files: File[]]
  download: [attachment: VoucherAttachment]
  remove: [attachment: VoucherAttachment]
}>()

const input = ref<HTMLInputElement | null>(null)
const localError = ref<string | null>(null)

function chooseFiles(): void {
  input.value?.click()
}

function selectFiles(event: Event): void {
  const target = event.target as HTMLInputElement
  const files = [...(target.files ?? [])]
  target.value = ''
  localError.value = null
  if (files.length === 0) return
  if (props.attachments.length + files.length > 10) {
    localError.value = '每张单据最多 10 个附件。'
    return
  }
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png'])
  const invalid = files.find(
    (file) => !allowed.has(file.type) || file.size < 1 || file.size > 10 << 20,
  )
  if (invalid) {
    localError.value = `${invalid.name} 不是有效的 PDF、JPEG 或 PNG，或大小超过 10 MiB。`
    return
  }
  emit('upload', files)
}

function sizeText(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / 1024 / 1024).toFixed(1)} MiB`
}
</script>

<template>
  <section class="voucher-attachments">
    <div class="voucher-attachments__toolbar">
      <div>
        <h3>附件</h3>
        <span>PDF、JPEG、PNG；每个不超过 10 MiB；最多 10 个</span>
      </div>
      <v-btn
        v-if="canUpload"
        :disabled="
          !documentCreated || !draft || loading || attachments.length >= 10
        "
        :loading="loading"
        prepend-icon="mdi-paperclip-plus"
        variant="tonal"
        @click="chooseFiles"
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

    <v-alert v-if="!documentCreated" class="mb-4" type="info" variant="tonal">
      请先保存草稿，再添加附件。
    </v-alert>
    <AppSnackbar :message="localError || errorMessage" />

    <v-list v-if="attachments.length" lines="two">
      <v-list-item
        v-for="attachment in attachments"
        :key="attachment.fileId"
        prepend-icon="mdi-file-outline"
        :subtitle="`${sizeText(attachment.size)} · ${attachment.contentType}`"
        :title="attachment.fileName"
      >
        <template #append>
          <v-chip
            class="mr-2"
            :color="attachment.status === 'READY' ? 'success' : 'warning'"
            size="small"
            variant="tonal"
          >
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
            v-if="canRemove && draft"
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
    <v-empty-state
      v-else-if="documentCreated"
      icon="mdi-paperclip"
      text="这张单据还没有附件"
      title="暂无附件"
    />
  </section>
</template>

<style scoped>
.voucher-attachments__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.voucher-attachments__toolbar h3 {
  margin: 0;
}
.voucher-attachments__toolbar span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
</style>
