import { ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import type { VoucherAttachment } from '@/components/voucher'
import { downloadBlob } from '@/utils/download'
import {
  intermediaryWorkflowApi,
  type IntermediaryAction,
  type IntermediaryChildPrefix,
} from './api'
import type {
  IntermediaryChildDetail,
  IntermediaryChildStage,
  IntermediaryChildSummary,
  IntermediaryWorkflowDocument,
} from './types'

interface IntermediaryAttachmentDependencies {
  document: Ref<IntermediaryWorkflowDocument | null>
  stageChild: Ref<IntermediaryChildSummary | null>
  stageDetail: Ref<IntermediaryChildDetail | null>
  stageEditing: Ref<IntermediaryChildStage>
  can: (action: IntermediaryAction) => boolean
  childPrefix: (stage: IntermediaryChildStage) => IntermediaryChildPrefix
  getChild: (
    stage: IntermediaryChildStage,
    child?: IntermediaryChildSummary,
  ) => Promise<IntermediaryChildDetail>
  loadDocument: () => Promise<void>
  loadAudit: (page?: number) => Promise<void>
  errorMessage: (error: unknown) => string
}

export function useIntermediaryAttachments(
  dependencies: IntermediaryAttachmentDependencies,
) {
  const {
    document,
    stageChild,
    stageDetail,
    stageEditing,
    can,
    childPrefix,
    getChild,
    loadDocument,
    loadAudit,
    errorMessage,
  } = dependencies
  const childAttachmentLoading = ref(false)
  const childAttachmentError = ref<string | null>(null)

  async function sha256(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  async function reloadStageDetail(): Promise<void> {
    if (!document.value || !stageChild.value) return
    const current = document.value.children.find(
      (item) => item.childId === stageChild.value?.childId,
    )
    if (!current) return
    stageChild.value = current
    stageDetail.value = await getChild(stageEditing.value, current)
  }

  async function uploadChildAttachments(files: File[]): Promise<void> {
    if (
      !document.value ||
      !stageChild.value ||
      stageChild.value.status !== 'DRAFT'
    ) {
      return
    }
    const prefix = childPrefix(stageEditing.value)
    const action = `${prefix}-attachment-initiate` as IntermediaryAction
    if (!can(action)) return
    childAttachmentLoading.value = true
    childAttachmentError.value = null
    try {
      for (const file of files) {
        const initiated =
          await intermediaryWorkflowApi.initiateChildAttachment(prefix, {
            processId: document.value.processId,
            processRevision: document.value.rootRevision,
            documentId: stageChild.value.childId,
            documentRevision: stageChild.value.revision,
            fileName: file.name,
            contentType: file.type,
            size: file.size,
            sha256: await sha256(file),
          })
        document.value.rootRevision = initiated.data.processRevision
        stageChild.value.revision = initiated.data.documentRevision
        try {
          await apiClient.uploadAttachment(initiated.data.uploadUrl, file)
        } catch (error) {
          await loadDocument()
          await reloadStageDetail()
          throw error
        }
        await loadDocument()
        await reloadStageDetail()
      }
      await loadAudit(1)
    } catch (error) {
      childAttachmentError.value = errorMessage(error)
    } finally {
      childAttachmentLoading.value = false
    }
  }

  async function downloadChildAttachment(
    attachment: VoucherAttachment,
  ): Promise<void> {
    if (!document.value || !stageChild.value) return
    const prefix = childPrefix(stageEditing.value)
    const action = `${prefix}-attachment-download` as IntermediaryAction
    if (!can(action)) return
    childAttachmentLoading.value = true
    childAttachmentError.value = null
    try {
      const { data } =
        await intermediaryWorkflowApi.getChildAttachmentDownload(prefix, {
          processId: document.value.processId,
          documentId: stageChild.value.childId,
          fileId: attachment.fileId,
        })
      const blob = await apiClient.fetchAttachment(data.downloadUrl)
      downloadBlob(blob, attachment.fileName)
    } catch (error) {
      childAttachmentError.value = errorMessage(error)
    } finally {
      childAttachmentLoading.value = false
    }
  }

  async function removeChildAttachment(
    attachment: VoucherAttachment,
  ): Promise<void> {
    if (
      !document.value ||
      !stageChild.value ||
      stageChild.value.status !== 'DRAFT'
    ) {
      return
    }
    const prefix = childPrefix(stageEditing.value)
    const action = `${prefix}-attachment-remove` as IntermediaryAction
    if (!can(action)) return
    childAttachmentLoading.value = true
    childAttachmentError.value = null
    try {
      await intermediaryWorkflowApi.removeChildAttachment(prefix, {
        processId: document.value.processId,
        processRevision: document.value.rootRevision,
        documentId: stageChild.value.childId,
        documentRevision: stageChild.value.revision,
        fileId: attachment.fileId,
      })
      await Promise.all([loadDocument(), loadAudit(1)])
      await reloadStageDetail()
    } catch (error) {
      childAttachmentError.value = errorMessage(error)
    } finally {
      childAttachmentLoading.value = false
    }
  }

  return {
    childAttachmentLoading,
    childAttachmentError,
    uploadChildAttachments,
    downloadChildAttachment,
    removeChildAttachment,
  }
}
