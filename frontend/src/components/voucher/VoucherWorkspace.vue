<script setup lang="ts">
import { ref, watch } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import type { VoucherDocumentView } from './types'
import { approvalStatusLabel } from '@/shared/approval'

defineOptions({ name: 'VoucherWorkspace' })

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title: string
    document: VoucherDocumentView | null
    editing?: boolean
    dirty?: boolean
    busy?: boolean
    errorMessage?: string | null
    successMessage?: string | null
    canReload?: boolean
  }>(),
  {
    editing: false,
    dirty: false,
    busy: false,
    errorMessage: null,
    successMessage: null,
    canReload: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
  reload: []
}>()

const tab = ref<'document' | 'attachments' | 'audit'>('document')
const closeConfirm = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) tab.value = 'document'
  },
)

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
  if (!props.document) return props.editing ? '新增草稿' : '加载中'
  return approvalStatusLabel(props.document.approval.status)
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
      <v-toolbar class="voucher-workspace__toolbar" color="surface">
        <div class="voucher-workspace__summary">
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
          <v-chip color="primary" variant="tonal">
            {{ statusText() }}
          </v-chip>
          <span
            v-if="document"
            class="voucher-workspace__revision text-caption"
          >
            Revision {{ document.approval.revision }}
          </span>
        </div>
        <div class="voucher-workspace__actions">
          <slot name="actions" />
        </div>
      </v-toolbar>
      <v-progress-linear v-if="busy" indeterminate />

      <v-tabs v-model="tab" color="primary">
        <v-tab value="document">单据</v-tab>
        <v-tab value="attachments">附件</v-tab>
        <v-tab value="audit">审计</v-tab>
      </v-tabs>
      <v-divider />

      <AppSnackbar
        diagnostics
        :action-label="canReload ? '重新加载' : undefined"
        :message="errorMessage"
        @action="emit('reload')"
      />
      <AppSnackbar :message="successMessage" type="success" />

      <v-window v-model="tab" class="voucher-workspace__window">
        <v-window-item value="document">
          <div class="voucher-workspace__content"><slot name="document" /></div>
        </v-window-item>
        <v-window-item value="attachments">
          <div class="voucher-workspace__content">
            <slot name="attachments" />
          </div>
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
        {{
          busy
            ? '当前仍有操作正在进行。强制关闭不会取消后端已经受理的请求。'
            : '当前有未保存修改，关闭后这些修改将丢失。'
        }}
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
.voucher-workspace {
  min-height: 100dvh;
  background: rgb(var(--v-theme-background));
}
.voucher-workspace__summary {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.voucher-workspace__summary .v-toolbar-title {
  min-width: 0;
}
.voucher-workspace__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding-inline-end: 12px;
}
.voucher-workspace__title {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.voucher-workspace__title span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.voucher-workspace__window {
  overflow-y: auto;
}
.voucher-workspace__content {
  max-width: 1500px;
  margin: 0 auto;
  padding: 24px;
}
@media (max-width: 600px) {
  .voucher-workspace__toolbar {
    height: auto;
    padding-top: env(safe-area-inset-top);
  }
  .voucher-workspace__toolbar :deep(.v-toolbar__content) {
    height: auto !important;
    min-height: 64px;
    flex-direction: column;
    align-items: stretch;
  }
  .voucher-workspace__summary {
    width: 100%;
    min-height: 56px;
    gap: 8px;
    padding-inline-end: 10px;
  }
  .voucher-workspace__summary .v-chip {
    flex: 0 0 auto;
    max-width: 34vw;
  }
  .voucher-workspace__summary .v-chip :deep(.v-chip__content) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .voucher-workspace__actions {
    width: 100%;
    min-height: 48px;
    justify-content: flex-end;
    overflow: visible;
    padding: 4px 12px 8px 56px;
  }
  .voucher-workspace__actions :deep(.voucher-lifecycle-actions) {
    justify-content: flex-end;
  }
  .voucher-workspace__revision {
    display: none;
  }
  .voucher-workspace__content {
    padding: 14px;
  }
  .voucher-workspace__title span {
    display: none;
  }
}
</style>
