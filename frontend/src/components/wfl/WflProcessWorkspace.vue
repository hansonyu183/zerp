<script setup lang="ts">
import { ref, watch } from 'vue'

export interface WflWorkspaceTab {
  value: string | number
  title: string
  icon: string
}

const props = defineProps<{
  modelValue: boolean
  title: string
  statusLabel: string
  revision?: number
  tabs: readonly WflWorkspaceTab[]
  activeTab: string | number
  busy?: boolean
  dirty?: boolean
  errorMessage?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:activeTab': [value: string | number]
  close: []
  reload: []
}>()

const closeConfirm = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) closeConfirm.value = false
  },
)

function requestClose(): void {
  if (props.busy || props.dirty) {
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
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    persistent
    transition="dialog-bottom-transition"
  >
    <v-card class="wfl-workspace">
      <v-toolbar class="wfl-workspace__toolbar" color="surface">
        <div class="wfl-workspace__summary">
          <v-btn
            aria-label="关闭流程工作区"
            icon="mdi-close"
            :disabled="busy"
            @click="requestClose"
          />
          <v-toolbar-title>{{ title }}</v-toolbar-title>
          <v-chip color="primary" variant="tonal">
            {{ statusLabel
            }}<template v-if="revision"> · r{{ revision }}</template>
          </v-chip>
          <v-btn
            v-if="revision"
            aria-label="重新加载流程"
            icon="mdi-refresh"
            :loading="busy"
            @click="emit('reload')"
          />
        </div>
        <div class="wfl-workspace__actions">
          <slot name="toolbar" />
        </div>
      </v-toolbar>
      <v-progress-linear v-if="busy" indeterminate />
      <v-alert
        v-if="errorMessage"
        class="ma-4 mb-0"
        type="error"
        variant="tonal"
      >
        <div class="d-flex align-center justify-space-between ga-3">
          <span>{{ errorMessage }}</span>
          <v-btn v-if="revision" variant="text" @click="emit('reload')">
            重新加载
          </v-btn>
        </div>
      </v-alert>
      <v-tabs
        color="primary"
        :model-value="activeTab"
        show-arrows
        @update:model-value="emit('update:activeTab', $event)"
      >
        <v-tab
          v-for="tab in tabs"
          :key="tab.value"
          :prepend-icon="tab.icon"
          :value="tab.value"
        >
          {{ tab.title }}
        </v-tab>
      </v-tabs>
      <v-divider />
      <div class="wfl-workspace__content">
        <slot />
      </div>
    </v-card>
  </v-dialog>

  <v-dialog v-model="closeConfirm" max-width="540">
    <v-card rounded="xl" title="确认关闭流程">
      <v-card-text>
        {{
          busy
            ? '当前仍有操作正在进行，关闭不会取消后端已经受理的请求。'
            : '当前存在未保存修改，关闭后修改将丢失。'
        }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="closeConfirm = false">继续编辑</v-btn>
        <v-btn color="warning" @click="forceClose">仍然关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.wfl-workspace {
  height: 100dvh;
  overflow: hidden;
  background: rgb(var(--v-theme-background));
}
.wfl-workspace__summary {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.wfl-workspace__summary .v-toolbar-title {
  min-width: 0;
}
.wfl-workspace__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding-inline-end: 12px;
}
.wfl-workspace > .v-tabs {
  flex: 0 0 var(--v-tabs-height);
}
.wfl-workspace > .v-divider {
  flex: 0 0 auto;
}
.wfl-workspace__content {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  overflow-y: auto;
  padding: 20px;
}
@media (max-width: 600px) {
  .wfl-workspace__toolbar {
    height: auto;
    padding-top: env(safe-area-inset-top);
  }
  .wfl-workspace__toolbar :deep(.v-toolbar__content) {
    height: auto !important;
    min-height: 64px;
    flex-direction: column;
    align-items: stretch;
  }
  .wfl-workspace__summary {
    width: 100%;
    min-height: 56px;
    gap: 8px;
    padding-inline-end: 8px;
  }
  .wfl-workspace__summary .v-chip {
    flex: 0 0 auto;
    max-width: 38vw;
  }
  .wfl-workspace__summary .v-chip :deep(.v-chip__content) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wfl-workspace__actions {
    width: 100%;
    min-height: 44px;
    justify-content: flex-end;
    padding: 4px 12px 8px 56px;
  }
  .wfl-workspace__content {
    padding: 12px;
  }
}
</style>
