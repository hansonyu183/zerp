<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { customerAttachmentScope } from './customer-attachments.ts'
import type { CustomerSnapshot } from './customer-data.ts'
import {
  readTargetCustomerAttachment,
  type TargetCustomerAttachmentReadInput,
  TargetApiError,
} from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
type Attachment = CustomerSnapshot['identityAttachments'][number]
type Source =
  | Omit<
      Extract<TargetCustomerAttachmentReadInput, { source: 'current' }>,
      'fileId'
    >
  | Omit<
      Extract<TargetCustomerAttachmentReadInput, { source: 'submission' }>,
      'fileId'
    >
const props = defineProps<{
  caption: string
  modelValue: readonly Attachment[]
  mode: 'edit' | 'read'
  disabled?: boolean
  source?: Source
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Attachment[]]
  pending: [value: boolean]
}>()
const scope = inject(customerAttachmentScope, null),
  session = useTargetSession()
const generation = session.generation
let active = true
const reading = ref(false),
  error = ref(''),
  downloading = ref('')
const owns = () => active && session.generation === generation
const canStage = computed(() => session.can('/bob/customer/attachment-stage'))
const canRead = computed(
  () =>
    props.source &&
    session.can('/bob/customer/attachment-read') &&
    session.can(
      props.source.source === 'current'
        ? '/bob/customer/get'
        : '/bob/customer/submission-get',
    ),
)
async function add(value: File | readonly File[] | null) {
  const file = Array.isArray(value) ? value[0] : value
  if (
    !(file instanceof File) ||
    !scope ||
    props.disabled ||
    !canStage.value ||
    reading.value
  )
    return
  reading.value = true
  error.value = ''
  emit('pending', true)
  try {
    const attachment = await scope.add(file)
    if (owns()) emit('update:modelValue', [...props.modelValue, attachment])
  } catch (cause) {
    if (owns())
      error.value = cause instanceof Error ? cause.message : '附件读取失败。'
  } finally {
    if (owns()) {
      reading.value = false
      emit('pending', false)
    }
  }
}
async function download(file: Attachment) {
  if (
    !canRead.value ||
    !props.source ||
    !session.csrfToken ||
    downloading.value
  )
    return
  downloading.value = file.id
  error.value = ''
  try {
    const result = await readTargetCustomerAttachment(session.csrfToken, {
      ...props.source,
      fileId: file.id,
    })
    if (!owns()) return
    const bytes = Uint8Array.from(atob(result.contentBase64), (value) =>
      value.charCodeAt(0),
    )
    const url = URL.createObjectURL(
      new Blob([bytes], { type: result.mimeType }),
    )
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = result.fileName
      link.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch (cause) {
    if (owns())
      error.value =
        cause instanceof TargetApiError
          ? ({
              customer_attachment_not_found: '附件不存在或不属于此版本。',
              customer_attachment_invalid_content: '附件内容校验失败。',
              forbidden: '当前账号没有附件读取权限。',
            }[cause.errorKey] ?? '附件读取失败。')
          : cause instanceof Error
            ? cause.message
            : '附件读取失败。'
  } finally {
    if (owns()) downloading.value = ''
  }
}
function remove(id: string) {
  if (!props.disabled)
    emit(
      'update:modelValue',
      props.modelValue.filter((item) => item.id !== id),
    )
}
onBeforeUnmount(() => {
  active = false
  emit('pending', false)
})
</script>
<template>
  <section class="attachment-block" :aria-label="caption">
    <h3>{{ caption }}</h3>
    <v-alert v-if="error" type="error">{{ error }}</v-alert
    ><v-progress-linear v-if="reading" indeterminate />
    <div v-for="file in modelValue" :key="file.id" class="attachment-row">
      <span>{{ file.fileName }}（{{ file.sizeBytes }} 字节）</span
      ><template v-if="mode === 'edit'"
        ><span>{{ scope?.status(file.id) }}</span
        ><v-progress-linear
          v-if="scope?.status(file.id) === '正在上传'"
          indeterminate
        /><v-btn :disabled="disabled" @click="remove(file.id)"
          >移除附件</v-btn
        ></template
      ><v-btn
        v-if="canRead"
        :loading="downloading === file.id"
        :disabled="Boolean(downloading)"
        @click="download(file)"
        >下载附件</v-btn
      >
    </div>
    <v-file-input
      v-if="mode === 'edit' && canStage"
      :label="`添加${caption}`"
      accept=".pdf,.jpg,.jpeg,.png"
      :disabled="disabled || reading"
      :loading="reading"
      @update:model-value="add"
    />
    <p v-if="!modelValue.length">无附件</p>
    <p v-if="mode === 'read' && modelValue.length && !canRead">
      当前账号没有附件正文读取权限。
    </p>
  </section>
</template>
<style scoped>
.attachment-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.attachment-block {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
