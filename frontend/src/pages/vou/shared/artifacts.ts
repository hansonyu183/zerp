import { ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type {
  VoucherActionAvailability,
  VoucherAttachment,
  VoucherAuditEvent,
  VoucherDocumentView,
  VoucherEntityConfig,
} from '@/components/voucher'
import { downloadBlob } from '@/utils/download'

export function useVoucherArtifacts(
  config: VoucherEntityConfig,
  documentView: Ref<VoucherDocumentView | null>,
  actionAvailability: Readonly<Ref<VoucherActionAvailability>>,
  loadDocument: (documentId: string) => Promise<void>,
) {
  const attachmentLoading = ref(false)
  const attachmentError = ref<string | null>(null)
  const auditEvents = ref<VoucherAuditEvent[]>([])
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)
  const auditLoading = ref(false)
  const auditError = ref<string | null>(null)
  let auditSequence = 0

  async function sha256(file: File): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer(),
    )
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  async function loadAudit(nextPage = auditPage.value): Promise<void> {
    const current = documentView.value
    if (!current || !actionAvailability.value.audit) return
    const sequence = ++auditSequence
    auditLoading.value = true
    auditError.value = null
    try {
      const { data } = await apiClient.postContract(
        `vou/${config.entity}/audit-history`,
        {
          documentId: current.documentId,
          page: nextPage,
          pageSize: auditPageSize.value,
        },
      )
      if (
        sequence !== auditSequence ||
        documentView.value?.documentId !== current.documentId
      )
        return
      auditEvents.value = data.items ?? []
      auditTotal.value = data.total ?? 0
      auditPage.value = data.page ?? nextPage
      auditPageSize.value = data.pageSize ?? auditPageSize.value
    } catch (error) {
      if (sequence !== auditSequence) return
      auditError.value = getErrorMessage(error)
    } finally {
      if (sequence === auditSequence) auditLoading.value = false
    }
  }

  async function uploadAttachments(files: File[]): Promise<void> {
    const current = documentView.value
    if (!current || !actionAvailability.value.attachmentInitiate) return
    attachmentLoading.value = true
    attachmentError.value = null
    try {
      for (const file of files) {
        const hash = await sha256(file)
        const initiated = await apiClient.postContract(
          `vou/${config.entity}/attachment-initiate`,
          {
            documentId: current.documentId,
            revision: documentView.value!.revision,
            fileName: file.name,
            contentType: file.type,
            size: file.size,
            sha256: hash,
          },
        )
        documentView.value!.revision = initiated.data.revision
        try {
          await apiClient.uploadAttachment(initiated.data.uploadUrl, file)
        } catch (error) {
          await loadDocument(current.documentId)
          throw error
        }
        await loadDocument(current.documentId)
      }
      await loadAudit(1)
    } catch (error) {
      attachmentError.value = getErrorMessage(error)
    } finally {
      attachmentLoading.value = false
    }
  }

  async function downloadAttachment(
    attachment: VoucherAttachment,
  ): Promise<void> {
    const current = documentView.value
    if (!current || !actionAvailability.value.attachmentDownload) return
    attachmentLoading.value = true
    attachmentError.value = null
    try {
      const { data } = await apiClient.postContract(
        `vou/${config.entity}/attachment-download`,
        {
          documentId: current.documentId,
          fileId: attachment.fileId,
        },
      )
      const blob = await apiClient.fetchAttachment(data.downloadUrl)
      downloadBlob(blob, attachment.fileName)
    } catch (error) {
      attachmentError.value = getErrorMessage(error)
    } finally {
      attachmentLoading.value = false
    }
  }

  async function removeAttachment(
    attachment: VoucherAttachment,
  ): Promise<void> {
    const current = documentView.value
    if (!current || !actionAvailability.value.attachmentRemove) return
    attachmentLoading.value = true
    attachmentError.value = null
    try {
      await apiClient.postContract(`vou/${config.entity}/attachment-remove`, {
        documentId: current.documentId,
        revision: current.revision,
        fileId: attachment.fileId,
      })
      await Promise.all([loadDocument(current.documentId), loadAudit(1)])
    } catch (error) {
      attachmentError.value = getErrorMessage(error)
    } finally {
      attachmentLoading.value = false
    }
  }

  return {
    attachmentLoading,
    attachmentError,
    auditEvents,
    auditPage,
    auditPageSize,
    auditTotal,
    auditLoading,
    auditError,
    uploadAttachments,
    downloadAttachment,
    removeAttachment,
    loadAudit,
  }
}
