<script setup lang="ts">
import { ref, watch } from 'vue'
import type { VoucherDocumentView } from './types'

defineOptions({ name: 'VoucherWorkspace' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  document: VoucherDocumentView | null
  editing?: boolean
  dirty?: boolean
  busy?: boolean
  errorMessage?: string | null
  canReload?: boolean
}>(), {
  editing: false,
  dirty: false,
  busy: false,
  errorMessage: null,
  canReload: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
  reload: []
}>()

const tab = ref<'document' | 'attachments' | 'audit'>('document')
const closeConfirm = ref(false)

watch(() => props.modelValue, (open) => {
  if (open) tab.value = 'document'
})

function requestClose(): void {
  if (props.dirty || props.busy) {
    closeConfirm.value = true
    return
  }
  emit('close')
  emit('update:modelValue', false)
}

function forceClose(): void {
  closeConfirm.value = false
  emit('close')
  emit('update:modelValue', false)
}

function statusText(): string {
  if (!props.document) return props.editing ? '新建草稿' : '加载中'
  return {
    DRAFT: '草稿',
    REVIEWED: '已审核',
    APPROVED: '已批准',
    EXECUTED: '已执行',
  }[props.document.status]
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    persistent
    transition="dialog-bottom-transition"
  >
    <v-card class="voucher-workspace">
      <v-toolbar color="surface">
        <v-btn
          aria-label="关闭单据工作区"
          icon="mdi-close"
          @click="requestClose"
        />
        <v-toolbar-title>
          <div class="voucher-workspace__title">
            <strong>{{ title }}</strong>
            <span>{{ document?.documentNo || '尚未编号' }}</span>
          </div>
        </v-toolbar-title>
        <v-chip class="mr-3" color="primary" variant="tonal">
          {{ statusText() }}
        </v-chip>
        <span v-if="document" class="text-caption mr-4">
          Revision {{ document.revision }}
        </span>
        <slot name="actions" />
      </v-toolbar>
      <v-progress-linear v-if="busy" indeterminate />

      <v-tabs v-model="tab" color="primary">
        <v-tab value="document">单据</v-tab>
        <v-tab value="attachments">附件</v-tab>
        <v-tab value="audit">审计</v-tab>
      </v-tabs>
      <v-divider />

      <v-alert
        v-if="errorMessage"
        class="ma-4 mb-0"
        type="error"
        variant="tonal"
      >
        <div class="d-flex align-center justify-space-between ga-3">
          <span>{{ errorMessage }}</span>
          <v-btn v-if="canReload" size="small" variant="text" @click="emit('reload')">
            重新加载
          </v-btn>
        </div>
      </v-alert>

      <v-window v-model="tab" class="voucher-workspace__window">
        <v-window-item value="document">
          <div class="voucher-workspace__content"><slot name="document" /></div>
        </v-window-item>
        <v-window-item value="attachments">
          <div class="voucher-workspace__content"><slot name="attachments" /></div>
        </v-window-item>
        <v-window-item value="audit">
          <div class="voucher-workspace__content"><slot name="audit" /></div>
        </v-window-item>
      </v-window>
    </v-card>
  </v-dialog>

  <v-dialog v-model="closeConfirm" max-width="540">
    <v-card rounded="xl" title="确认关闭单据">
      <v-card-text>
        {{ busy ? '当前仍有操作正在进行。强制关闭不会取消后端已经受理的请求。' :
          '当前有未保存修改，关闭后这些修改将丢失。' }}
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="closeConfirm = false">继续编辑</v-btn>
        <v-btn color="warning" @click="forceClose">仍然关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.voucher-workspace { min-height: 100dvh; background: rgb(var(--v-theme-background)); }
.voucher-workspace__title { display: flex; flex-direction: column; line-height: 1.2; }
.voucher-workspace__title span { color: rgb(var(--v-theme-on-surface-variant)); font-size: 12px; }
.voucher-workspace__window { overflow-y: auto; }
.voucher-workspace__content { max-width: 1500px; margin: 0 auto; padding: 24px; }
@media (max-width: 600px) {
  .voucher-workspace__content { padding: 14px; }
  .voucher-workspace__title span { display: none; }
}
</style>
