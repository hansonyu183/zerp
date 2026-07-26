import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute } from 'vue-router'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'

const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg'])

export type FeedbackCategory = 'BUG' | 'SUGGESTION' | 'OTHER'
export type FeedbackAttachmentStatus = 'pending' | 'uploading' | 'ready' | 'error'

export interface FeedbackAttachmentDraft {
  key: string
  file: File
  previewUrl: string
  status: FeedbackAttachmentStatus
  fileId?: string
  errorMessage?: string
}

export interface FeedbackCreated {
  feedbackId: string
  status: 'PENDING'
  submittedAt: string
}

interface FeedbackAttachmentInitiated {
  fileId: string
  uploadUrl: string
  expiresAt: string
}

let attachmentSequence = 0

function characterCount(value: string): number {
  return [...value].length
}

function fileFingerprint(file: File): string {
  return `${file.name}/${file.type}/${file.size}/${file.lastModified}`
}

function attachmentStatusText(status: FeedbackAttachmentStatus): string {
  return {
    pending: '待提交',
    uploading: '上传中',
    ready: '已上传',
    error: '上传失败',
  }[status]
}

export function useFeedbackViewModel() {
  const route = useRoute()
  const opened = ref(false)
  const category = ref<FeedbackCategory>('BUG')
  const title = ref('')
  const content = ref('')
  const relatedRequestId = ref('')
  const pagePath = ref('')
  const attachments = ref<FeedbackAttachmentDraft[]>([])
  const submitting = ref(false)
  const errorMessage = ref('')
  const attachmentError = ref('')
  const created = ref<FeedbackCreated | null>(null)

  const titleLength = computed(() => characterCount(title.value.trim()))
  const contentLength = computed(() => characterCount(content.value.trim()))
  const requestIdValid = computed(() => {
    const value = relatedRequestId.value.trim()
    return value === '' || /^[\x21-\x7e]{1,128}$/.test(value)
  })
  const canSubmit = computed(
    () =>
      !submitting.value &&
      titleLength.value >= 1 &&
      titleLength.value <= 120 &&
      contentLength.value >= 1 &&
      contentLength.value <= 4000 &&
      requestIdValid.value &&
      attachments.value.every((attachment) => attachment.status !== 'uploading'),
  )

  function hasDraft(): boolean {
    return (
      category.value !== 'BUG' ||
      title.value !== '' ||
      content.value !== '' ||
      relatedRequestId.value !== '' ||
      attachments.value.length > 0
    )
  }

  function openDialog(): void {
    if (created.value) created.value = null
    if (!hasDraft()) pagePath.value = route.path
    errorMessage.value = ''
    attachmentError.value = ''
    opened.value = true
  }

  function closeDialog(): void {
    opened.value = false
  }

  function addFiles(files: readonly File[]): void {
    attachmentError.value = ''
    if (files.length === 0) return
    if (attachments.value.length + files.length > MAX_ATTACHMENTS) {
      attachmentError.value = `最多添加 ${MAX_ATTACHMENTS} 张截图。`
      return
    }

    const invalid = files.find(
      (file) =>
        !ALLOWED_IMAGE_TYPES.has(file.type) ||
        file.size < 1 ||
        file.size > MAX_ATTACHMENT_SIZE,
    )
    if (invalid) {
      attachmentError.value = `${invalid.name || '截图'} 不是有效的 PNG/JPEG，或大小超过 10 MiB。`
      return
    }

    const fingerprints = new Set(
      attachments.value.map((attachment) => fileFingerprint(attachment.file)),
    )
    const selectedFingerprints = new Set<string>()
    for (const file of files) {
      const fingerprint = fileFingerprint(file)
      if (fingerprints.has(fingerprint) || selectedFingerprints.has(fingerprint)) {
        attachmentError.value = '同一张截图不能重复添加。'
        return
      }
      selectedFingerprints.add(fingerprint)
    }

    for (const file of files) {
      attachments.value.push({
        key: `feedback-attachment-${++attachmentSequence}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'pending',
      })
    }
  }

  async function removeServerAttachment(fileId: string): Promise<void> {
    await apiClient.post<Record<string, never>, { fileId: string }>(
      'app/feedback/attachment-remove',
      { fileId },
    )
  }

  async function removeAttachment(attachment: FeedbackAttachmentDraft): Promise<void> {
    if (submitting.value || attachment.status === 'uploading') return

    attachment.errorMessage = undefined
    try {
      if (attachment.fileId) await removeServerAttachment(attachment.fileId)
      URL.revokeObjectURL(attachment.previewUrl)
      attachments.value = attachments.value.filter((item) => item.key !== attachment.key)
    } catch (error) {
      attachment.status = 'error'
      attachment.errorMessage = getErrorMessage(error)
    }
  }

  async function sha256(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  async function uploadAttachment(attachment: FeedbackAttachmentDraft): Promise<void> {
    attachment.status = 'uploading'
    attachment.errorMessage = undefined
    try {
      if (attachment.fileId) {
        await removeServerAttachment(attachment.fileId)
        attachment.fileId = undefined
      }

      const hash = await sha256(attachment.file)
      const { data } = await apiClient.post<
        FeedbackAttachmentInitiated,
        { fileName: string; contentType: string; size: number; sha256: string }
      >('app/feedback/attachment-initiate', {
        fileName: attachment.file.name || 'screenshot.png',
        contentType: attachment.file.type,
        size: attachment.file.size,
        sha256: hash,
      })
      attachment.fileId = data.fileId
      await apiClient.uploadFeedbackAttachment(data.uploadUrl, attachment.file)
      attachment.status = 'ready'
    } catch (error) {
      attachment.status = 'error'
      attachment.errorMessage = getErrorMessage(error)
      throw error
    }
  }

  function releasePreviews(): void {
    for (const attachment of attachments.value) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }

  function clearDraft(): void {
    releasePreviews()
    category.value = 'BUG'
    title.value = ''
    content.value = ''
    relatedRequestId.value = ''
    pagePath.value = ''
    attachments.value = []
    attachmentError.value = ''
  }

  async function submit(): Promise<void> {
    if (!canSubmit.value) return

    submitting.value = true
    errorMessage.value = ''
    try {
      for (const attachment of attachments.value) {
        if (attachment.status !== 'ready') await uploadAttachment(attachment)
      }

      const { data } = await apiClient.post<
        FeedbackCreated,
        {
          category: FeedbackCategory
          title: string
          content: string
          pagePath: string
          clientVersion: string
          relatedRequestId: string
          attachmentIds: string[]
        }
      >('app/feedback/create', {
        category: category.value,
        title: title.value.trim(),
        content: content.value.trim(),
        pagePath: pagePath.value,
        clientVersion: '',
        relatedRequestId: relatedRequestId.value.trim(),
        attachmentIds: attachments.value.flatMap((attachment) =>
          attachment.fileId ? [attachment.fileId] : [],
        ),
      })
      created.value = data
      clearDraft()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      submitting.value = false
    }
  }

  onBeforeUnmount(releasePreviews)

  return {
    opened,
    category,
    title,
    content,
    relatedRequestId,
    pagePath,
    attachments,
    submitting,
    errorMessage,
    attachmentError,
    created,
    titleLength,
    contentLength,
    requestIdValid,
    canSubmit,
    attachmentStatusText,
    openDialog,
    closeDialog,
    addFiles,
    removeAttachment,
    submit,
  }
}
