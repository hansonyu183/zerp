<script setup lang="ts">
import { reactive, ref } from 'vue'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { useFeedbackViewModel } from './vm'

defineOptions({ name: 'FeedbackDialog' })

const vm = reactive(useFeedbackViewModel())
const fileInput = ref<HTMLInputElement | null>(null)
const categoryItems = [
  { title: '问题反馈', value: 'BUG' },
  { title: '功能建议', value: 'SUGGESTION' },
  { title: '其他', value: 'OTHER' },
]

function chooseFiles(): void {
  fileInput.value?.click()
}

function selectFiles(event: Event): void {
  const target = event.target as HTMLInputElement
  vm.addFiles([...(target.files ?? [])])
  target.value = ''
}

function pasteFiles(event: ClipboardEvent): void {
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile()
      return file ? [file] : []
    })
  if (files.length === 0) return
  event.preventDefault()
  vm.addFiles(files)
}

function dropFiles(event: DragEvent): void {
  vm.addFiles([...(event.dataTransfer?.files ?? [])])
}

function sizeText(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / 1024 / 1024).toFixed(1)} MiB`
}
</script>

<template>
  <v-btn
    aria-label="提交反馈"
    icon="mdi-message-alert-outline"
    title="提交反馈"
    variant="text"
    @click="vm.openDialog"
  />

  <v-dialog v-model="vm.opened" max-width="720">
    <v-card rounded="xl" @paste="pasteFiles">
      <template v-if="vm.created">
        <v-card-text class="feedback-success">
          <v-icon color="success" icon="mdi-check-circle-outline" size="58" />
          <h2>反馈已提交</h2>
          <p>我们已收到你的反馈，处理状态将在后台持续更新。</p>
          <v-chip color="primary" variant="tonal">
            反馈编号：{{ vm.created.feedbackId }}
          </v-chip>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn color="primary" @click="vm.closeDialog">完成</v-btn>
        </v-card-actions>
      </template>

      <template v-else>
        <v-card-title class="feedback-title">
          <v-icon icon="mdi-message-alert-outline" />
          提交反馈
        </v-card-title>
        <v-card-subtitle>
          请勿填写密码、Cookie、Token 或其他敏感信息。
        </v-card-subtitle>
        <v-card-text>
          <AppSnackbar :message="vm.errorMessage" />

          <v-select
            v-model="vm.category"
            :items="categoryItems"
            label="反馈类型"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.title"
            :counter="120"
            label="标题"
            maxlength="120"
            required
            variant="outlined"
          />
          <v-textarea
            v-model="vm.content"
            auto-grow
            :counter="4000"
            label="详细描述"
            maxlength="4000"
            placeholder="请描述发生了什么、期望结果以及复现步骤。"
            required
            rows="5"
            variant="outlined"
          />
          <section class="feedback-attachments">
            <div class="feedback-attachments__heading">
              <div>
                <strong>截图（可选）</strong>
                <span>PNG 或 JPEG，单张不超过 10 MiB，最多 3 张</span>
              </div>
              <v-btn
                :disabled="vm.attachments.length >= 3 || vm.submitting"
                prepend-icon="mdi-image-plus-outline"
                variant="tonal"
                @click="chooseFiles"
              >
                选择截图
              </v-btn>
              <input
                ref="fileInput"
                accept="image/png,image/jpeg"
                hidden
                multiple
                type="file"
                @change="selectFiles"
              />
            </div>

            <button
              class="feedback-dropzone"
              type="button"
              @click="chooseFiles"
              @dragover.prevent
              @drop.prevent="dropFiles"
            >
              <v-icon icon="mdi-content-paste" size="28" />
              <span>可粘贴截图，或将图片拖放到这里</span>
            </button>

            <AppSnackbar :message="vm.attachmentError" />

            <v-list
              v-if="vm.attachments.length"
              class="feedback-attachment-list"
            >
              <v-list-item
                v-for="attachment in vm.attachments"
                :key="attachment.key"
                :subtitle="`${sizeText(attachment.file.size)} · ${vm.attachmentStatusText(attachment.status)}`"
                :title="attachment.file.name || '粘贴的截图'"
              >
                <template #prepend>
                  <v-img
                    :alt="attachment.file.name || '截图预览'"
                    class="feedback-attachment-preview"
                    cover
                    :src="attachment.previewUrl"
                  />
                </template>
                <template #append>
                  <v-progress-circular
                    v-if="attachment.status === 'uploading'"
                    indeterminate
                    size="24"
                    width="2"
                  />
                  <v-btn
                    v-else
                    :aria-label="`移除 ${attachment.file.name || '截图'}`"
                    :disabled="vm.submitting"
                    icon="mdi-close"
                    variant="text"
                    @click="vm.removeAttachment(attachment)"
                  />
                </template>
                <template v-if="attachment.errorMessage" #subtitle>
                  <span class="text-error">{{ attachment.errorMessage }}</span>
                </template>
              </v-list-item>
            </v-list>
          </section>

          <v-alert class="mt-4" density="compact" type="info" variant="tonal">
            当前页面路径会随反馈提交；截图仅在点击提交后上传。
          </v-alert>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn
            :disabled="vm.submitting"
            variant="text"
            @click="vm.closeDialog"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!vm.canSubmit"
            :loading="vm.submitting"
            prepend-icon="mdi-send-outline"
            @click="vm.submit"
          >
            提交
          </v-btn>
        </v-card-actions>
      </template>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.feedback-title {
  display: flex;
  gap: 10px;
  align-items: center;
  padding-top: 24px;
}
.feedback-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 44px 28px 30px;
  text-align: center;
}
.feedback-success h2 {
  margin: 14px 0 6px;
}
.feedback-success p {
  margin: 0 0 20px;
  color: rgb(var(--v-theme-on-surface-variant));
}
.feedback-attachments {
  margin-top: 4px;
}
.feedback-attachments__heading {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.feedback-attachments__heading div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.feedback-attachments__heading span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}
.feedback-dropzone {
  display: flex;
  width: 100%;
  min-height: 88px;
  flex-direction: column;
  gap: 7px;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: rgb(var(--v-theme-on-surface-variant));
  background: rgba(var(--v-theme-primary), 0.04);
  border: 1px dashed rgba(var(--v-theme-primary), 0.5);
  border-radius: 12px;
  cursor: pointer;
}
.feedback-dropzone:hover,
.feedback-dropzone:focus-visible {
  background: rgba(var(--v-theme-primary), 0.09);
  outline: none;
}
.feedback-attachment-list {
  margin-top: 10px;
  padding: 0;
}
.feedback-attachment-preview {
  width: 54px;
  height: 42px;
  margin-right: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 7px;
}
@media (max-width: 600px) {
  .feedback-attachments__heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .feedback-attachments__heading .v-btn {
    width: 100%;
  }
}
</style>
