import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type {
  VoucherActionAvailability,
  VoucherAttachment,
  VoucherDocumentView,
} from '@/components/voucher'
import { voucherEntityConfigs } from '@/pages/vou/shared/config'
import { useVoucherArtifacts } from '@/pages/vou/shared/artifacts'
import { downloadBlob } from '@/utils/download'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    uploadAttachment: vi.fn(),
    fetchAttachment: vi.fn(),
  },
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: vi.fn(),
}))

const mockedPost = vi.mocked(apiClient.post)
const mockedUpload = vi.mocked(apiClient.uploadAttachment)
const mockedFetch = vi.mocked(apiClient.fetchAttachment)
const mockedDownload = vi.mocked(downloadBlob)

const attachment: VoucherAttachment = {
  fileId: 'FILE-1',
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  size: 3,
  sha256: '0102',
  status: 'READY',
  createdAt: '2026-07-26T00:00:00Z',
  createdBy: 'USER-1',
}

function documentView(): VoucherDocumentView {
  return {
    documentId: 'DOCUMENT-1',
    entity: 'sales-receipt',
    documentNo: 'REC-1',
    status: 'DRAFT',
    revision: 1,
    amount: '10.00',
    data: {
      businessDate: '2026-07-26',
      currency: 'CNY',
    },
    attachments: [attachment],
    createdAt: '2026-07-26T00:00:00Z',
    createdBy: 'USER-1',
    updatedAt: '2026-07-26T00:00:00Z',
    updatedBy: 'USER-1',
  }
}

const allowed: VoucherActionAvailability = {
  get: true,
  save: true,
  check: true,
  uncheck: true,
  approve: true,
  unapprove: true,
  delete: true,
  shortCloseRequest: true,
  shortCloseCancel: true,
  shortCloseConfirm: true,
  shortCloseUnconfirm: true,
  audit: true,
  attachmentInitiate: true,
  attachmentDownload: true,
  attachmentRemove: true,
}

describe('VOU attachment and audit artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2]).buffer),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads audit data and completes attachment lifecycle actions', async () => {
    const current = ref<VoucherDocumentView | null>(documentView())
    const availability = computed(() => allowed)
    const loadDocument = vi.fn().mockResolvedValue(undefined)
    mockedPost.mockImplementation(async (path) => {
      if (path.endsWith('/audit-history')) {
        return {
          data: {
            items: [
              {
                id: 'EVENT-1',
                eventType: 'ATTACHMENT_ADDED',
                fromStatus: 'DRAFT',
                toStatus: 'DRAFT',
                actorId: 'USER-1',
                occurredAt: '2026-07-26T00:00:00Z',
                reason: null,
                requestId: 'REQUEST-1',
                summary: null,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        }
      }
      if (path.endsWith('/attachment-initiate')) {
        return {
          data: {
            fileId: 'FILE-2',
            uploadUrl: 'https://upload.example.test/file',
            expiresAt: '2026-07-26T01:00:00Z',
            revision: 2,
          },
        }
      }
      if (path.endsWith('/attachment-download')) {
        return {
          data: {
            downloadUrl: 'https://download.example.test/file',
            expiresAt: '2026-07-26T01:00:00Z',
          },
        }
      }
      return {
        data: {
          documentId: 'DOCUMENT-1',
          documentNo: 'REC-1',
          status: 'DRAFT',
          revision: 3,
        },
      }
    })
    mockedUpload.mockResolvedValue(undefined)
    const blob = new Blob(['pdf'])
    mockedFetch.mockResolvedValue(blob)
    const artifacts = useVoucherArtifacts(
      voucherEntityConfigs['sales-receipt'],
      current,
      availability,
      loadDocument,
    )

    await artifacts.loadAudit()
    expect(artifacts.auditEvents.value).toHaveLength(1)
    expect(artifacts.auditTotal.value).toBe(1)

    const file = {
      name: 'invoice.pdf',
      type: 'application/pdf',
      size: 3,
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([3, 4]).buffer),
    } as unknown as File
    await artifacts.uploadAttachments([file])
    expect(mockedPost).toHaveBeenCalledWith(
      'vou/sales-receipt/attachment-initiate',
      expect.objectContaining({
        documentId: 'DOCUMENT-1',
        revision: 1,
        fileName: 'invoice.pdf',
        sha256: '0102',
      }),
    )
    expect(current.value?.revision).toBe(2)
    expect(mockedUpload).toHaveBeenCalledWith(
      'https://upload.example.test/file',
      file,
    )
    expect(loadDocument).toHaveBeenCalledWith('DOCUMENT-1')

    await artifacts.downloadAttachment(attachment)
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://download.example.test/file',
    )
    expect(mockedDownload).toHaveBeenCalledWith(blob, 'invoice.pdf')

    await artifacts.removeAttachment(attachment)
    expect(mockedPost).toHaveBeenCalledWith(
      'vou/sales-receipt/attachment-remove',
      {
        documentId: 'DOCUMENT-1',
        revision: 2,
        fileId: 'FILE-1',
      },
    )
    expect(artifacts.attachmentLoading.value).toBe(false)
    expect(artifacts.attachmentError.value).toBeNull()
  })

  it('reports audit, upload, download, and removal failures', async () => {
    const current = ref<VoucherDocumentView | null>(documentView())
    const availability = computed(() => allowed)
    const loadDocument = vi.fn().mockResolvedValue(undefined)
    const artifacts = useVoucherArtifacts(
      voucherEntityConfigs['sales-receipt'],
      current,
      availability,
      loadDocument,
    )

    mockedPost.mockRejectedValueOnce(new Error('audit unavailable'))
    await artifacts.loadAudit(2)
    expect(artifacts.auditError.value).toBe('操作失败，请稍后重试。')
    expect(artifacts.auditLoading.value).toBe(false)

    mockedPost.mockResolvedValueOnce({
      data: {
        fileId: 'FILE-2',
        uploadUrl: 'https://upload.example.test/file',
        expiresAt: '2026-07-26T01:00:00Z',
        revision: 2,
      },
    })
    mockedUpload.mockRejectedValueOnce(new Error('upload unavailable'))
    const file = {
      name: 'invoice.pdf',
      type: 'application/pdf',
      size: 3,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as File
    await artifacts.uploadAttachments([file])
    expect(loadDocument).toHaveBeenCalledWith('DOCUMENT-1')
    expect(artifacts.attachmentError.value).toBe('操作失败，请稍后重试。')

    mockedPost.mockRejectedValueOnce(new Error('download unavailable'))
    await artifacts.downloadAttachment(attachment)
    expect(artifacts.attachmentError.value).toBe('操作失败，请稍后重试。')

    mockedPost.mockRejectedValueOnce(new Error('remove unavailable'))
    await artifacts.removeAttachment(attachment)
    expect(artifacts.attachmentError.value).toBe('操作失败，请稍后重试。')
    expect(artifacts.attachmentLoading.value).toBe(false)
  })

  it('does not perform artifact actions without a document or permission', async () => {
    const current = ref<VoucherDocumentView | null>(null)
    const availability = computed(
      () =>
        Object.fromEntries(
          Object.keys(allowed).map((key) => [key, false]),
        ) as unknown as VoucherActionAvailability,
    )
    const artifacts = useVoucherArtifacts(
      voucherEntityConfigs['sales-receipt'],
      current,
      availability,
      vi.fn(),
    )

    await artifacts.loadAudit()
    await artifacts.uploadAttachments([])
    await artifacts.downloadAttachment(attachment)
    await artifacts.removeAttachment(attachment)
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('keeps the newest audit result when requests finish out of order', async () => {
    const current = ref<VoucherDocumentView | null>(documentView())
    const availability = computed(() => allowed)
    const artifacts = useVoucherArtifacts(
      voucherEntityConfigs['sales-receipt'],
      current,
      availability,
      vi.fn(),
    )
    let resolveFirst!: (value: unknown) => void
    let rejectSecond!: (reason: unknown) => void
    let resolveThird!: (value: unknown) => void
    mockedPost
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((_, reject) => (rejectSecond = reject)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveThird = resolve)))

    const first = artifacts.loadAudit(1)
    const second = artifacts.loadAudit(2)
    const third = artifacts.loadAudit(3)
    resolveThird({
      data: { items: [{ id: 'NEWEST' }], total: 1, page: 3, pageSize: 20 },
    })
    await third
    rejectSecond(new Error('stale failure'))
    await second
    resolveFirst({
      data: { items: [{ id: 'STALE' }], total: 1, page: 1, pageSize: 20 },
    })
    await first

    expect(artifacts.auditEvents.value[0]?.id).toBe('NEWEST')
    expect(artifacts.auditPage.value).toBe(3)
    expect(artifacts.auditError.value).toBeNull()
    expect(artifacts.auditLoading.value).toBe(false)
  })
})
