import { describe, expect, it, vi } from 'vitest'

import { archiveReferencePermissions } from '@/target/archive-presentation.ts'
import {
  createCustomerViewModel,
  type CustomerDraft,
} from '@/target/pages/dcl/customer/vm.ts'

function completeRequiredSubunit(draft: CustomerDraft) {
  const subunit = draft.snapshot.subunits[0]!
  subunit.customerType = { id: 'type-1', code: 'DIRECT', name: '直客' }
  subunit.transportPolicy = {
    methodCode: 'DELIVERY',
    methodName: '送货',
    surcharge: '0.00',
  }
  subunit.primarySalesAttribution = {
    type: 'INTERNAL_EMPLOYEE',
    objectId: 'employee-1',
    approvalEntryId: 'employee-entry-1',
    code: 'EMP-0001',
    name: '业务员',
  }
}

function ports() {
  return {
    drafts: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    attachments: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    api: {
      query: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      get: vi.fn(),
      versions: vi.fn(),
      audit: vi.fn(),
      submit: vi.fn().mockResolvedValue({ status: 'PENDING' }),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
      auxReference: vi.fn().mockResolvedValue([]),
      bobReference: vi.fn().mockResolvedValue([]),
      stageAttachment: vi
        .fn()
        .mockResolvedValue({ expiresAt: '2026-09-06T00:00:00.000Z' }),
    },
    now: () => '2026-09-05T10:00:00.000Z',
  }
}

describe('Customer DCL public view-model seam', () => {
  it('copies typed settlement and payment facts from AUX candidates', async () => {
    const dependencies = ports()
    dependencies.api.auxReference.mockImplementation(
      async (_csrf: string, entity: string) => {
        if (entity === 'dictionary-item')
          return [{ objectId: 'type-1', code: 'DIRECT', name: '直客' }]
        if (entity === 'settlement-method')
          return [
            {
              objectId: 'settlement-1',
              code: 'MONTHLY_30',
              name: '月结 30 天',
              termCode: 'MONTHLY_30',
              ruleType: 'MONTH_END',
              monthOffset: 1,
              dayOfMonth: 0,
              dayOffset: 0,
              defaultSalesSurcharge: '0.10',
            },
          ]
        if (entity === 'payment-method')
          return [
            {
              objectId: 'payment-1',
              code: 'TRANSFER',
              name: '转账',
              defaultSalesSurcharge: '0.05',
            },
          ]
        return []
      },
    )
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-new',
          '/dcl/customer/save-subunits',
          '/dcl/customer/attachment-stage',
          ...archiveReferencePermissions('customer'),
        ],
      },
      dependencies,
    )
    await vm.loadReferences()
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    const subunit = draft.snapshot.subunits[0]!

    vm.selectCustomerType(draft, subunit.id, 'type-1')
    vm.selectSettlementMethod(draft, subunit.id, 'settlement-1')
    vm.selectPaymentMethod(draft, subunit.id, 'payment-1')

    expect(subunit.customerType).toEqual({
      id: 'type-1',
      code: 'DIRECT',
      name: '直客',
    })
    expect(subunit.settlementMethod).toEqual({
      id: 'settlement-1',
      code: 'MONTHLY_30',
      name: '月结 30 天',
      termCode: 'MONTHLY_30',
      ruleType: 'MONTH_END',
      monthOffset: 1,
      dayOfMonth: 0,
      dayOffset: 0,
      defaultSalesSurcharge: '0.10',
    })
    expect(subunit.paymentMethod).toEqual({
      id: 'payment-1',
      code: 'TRANSFER',
      name: '转账',
      defaultSalesSurcharge: '0.05',
    })
  })

  it('stages local Blob bytes only at submit and sends staging metadata', async () => {
    const dependencies = ports()
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-new',
          '/dcl/customer/save-subunits',
          '/dcl/customer/attachment-stage',
          ...archiveReferencePermissions('customer'),
        ],
      },
      dependencies,
    )

    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    completeRequiredSubunit(draft)
    const attachment = {
      attachmentId: '01J00000000000000000000001',
      fileName: '执照.pdf',
      mimeType: 'application/pdf',
      size: 3,
      digest: 'a'.repeat(64),
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
    }
    dependencies.attachments.list.mockResolvedValue([attachment])
    await vm.addLocalAttachment(draft, attachment)

    expect(dependencies.api.stageAttachment).not.toHaveBeenCalled()
    await vm.submitDraft(draft)

    expect(vm.error.value).toBe('')
    expect(dependencies.api.stageAttachment).toHaveBeenCalledWith(
      'csrf',
      expect.objectContaining({
        stagingId: expect.stringMatching(/^.{26}$/),
        fileId: '01J00000000000000000000001',
        contentBase64: 'cGRm',
      }),
    )
    expect(dependencies.api.submit).toHaveBeenCalledWith(
      'csrf',
      expect.objectContaining({
        entity: 'customer',
        input: expect.objectContaining({
          snapshot: expect.objectContaining({
            identityAttachments: [
              expect.objectContaining({
                id: '01J00000000000000000000001',
                stagingId: expect.stringMatching(/^.{26}$/),
              }),
            ],
          }),
        }),
      }),
    )
    expect(dependencies.drafts.delete).toHaveBeenCalled()
  })

  it('retains the local Draft and Blob when attachment staging fails', async () => {
    const dependencies = ports()
    dependencies.api.stageAttachment.mockRejectedValue(
      new Error('附件暂存失败'),
    )
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-new',
          '/dcl/customer/save-subunits',
          '/dcl/customer/attachment-stage',
          ...archiveReferencePermissions('customer'),
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    completeRequiredSubunit(draft)
    const attachment = {
      attachmentId: '01J00000000000000000000002',
      fileName: '执照.pdf',
      mimeType: 'application/pdf',
      size: 3,
      digest: 'b'.repeat(64),
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
    }
    dependencies.attachments.list.mockResolvedValue([attachment])
    await vm.addLocalAttachment(draft, attachment)

    await vm.submitDraft(draft)

    expect(vm.error.value).toBe('附件暂存失败')
    expect(vm.drafts.value).toHaveLength(1)
    expect(dependencies.drafts.delete).not.toHaveBeenCalled()
    expect(dependencies.api.submit).not.toHaveBeenCalled()
  })

  it('rejects attachment metadata drift before creating any server staging object', async () => {
    const dependencies = ports()
    dependencies.attachments.list.mockResolvedValue([
      {
        attachmentId: '01J00000000000000000000006',
        fileName: '孤儿附件.pdf',
        mimeType: 'application/pdf',
        size: 3,
        digest: 'f'.repeat(64),
        blob: new Blob(['pdf'], { type: 'application/pdf' }),
      },
    ])
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-new',
          '/dcl/customer/save-subunits',
          '/dcl/customer/attachment-stage',
          ...archiveReferencePermissions('customer'),
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    completeRequiredSubunit(draft)

    await vm.submitDraft(draft)

    expect(vm.error.value).toBe('本地附件与草稿元数据不一致。')
    expect(dependencies.api.stageAttachment).not.toHaveBeenCalled()
    expect(dependencies.api.submit).not.toHaveBeenCalled()
  })

  it('rejects attachment metadata without local bytes before any server request', async () => {
    const dependencies = ports()
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-new',
          '/dcl/customer/save-subunits',
          '/dcl/customer/attachment-stage',
          ...archiveReferencePermissions('customer'),
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    completeRequiredSubunit(draft)
    draft.snapshot.identityAttachments.push({
      id: '01J00000000000000000000007',
      fileName: '遗失字节.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      sha256: 'a'.repeat(64),
    })

    await vm.submitDraft(draft)

    expect(vm.error.value).toBe('本地附件与草稿元数据不一致。')
    expect(dependencies.api.stageAttachment).not.toHaveBeenCalled()
    expect(dependencies.api.submit).not.toHaveBeenCalled()
  })

  it('removes a NEW subunit and all of its attachment bytes in one persistence request', async () => {
    const dependencies = ports()
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-new',
          '/dcl/customer/save-subunits',
          '/dcl/customer/attachment-stage',
          ...archiveReferencePermissions('customer'),
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    const subunit = draft.snapshot.subunits[0]!
    const attachment = {
      attachmentId: '01J00000000000000000000003',
      fileName: '业务附件.pdf',
      mimeType: 'application/pdf',
      size: 3,
      digest: 'c'.repeat(64),
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      subunitId: subunit.id,
    }
    await vm.addLocalAttachment(draft, attachment)

    await vm.removeSubunit(draft, 0)

    expect(dependencies.attachments.remove).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({ subunits: [] }),
      }),
      [attachment.attachmentId],
    )
    expect(draft.snapshot.subunits).toEqual([])
  })

  it('does not accept local attachment bytes without attachment-stage permission', async () => {
    const dependencies = ports()
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-new',
          '/dcl/customer/save-subunits',
          ...archiveReferencePermissions('customer'),
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!

    await vm.addLocalAttachment(draft, {
      attachmentId: '01J00000000000000000000005',
      fileName: '执照.pdf',
      mimeType: 'application/pdf',
      size: 3,
      digest: 'e'.repeat(64),
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
    })

    expect(vm.canStageAttachments).toBe(false)
    expect(dependencies.attachments.save).not.toHaveBeenCalled()
    expect(draft.snapshot.identityAttachments).toEqual([])
    expect(vm.error.value).toContain('附件权限')
  })

  it('removes one root attachment metadata and Blob atomically', async () => {
    const dependencies = ports()
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-new',
          '/dcl/customer/save-subunits',
          '/dcl/customer/attachment-stage',
          ...archiveReferencePermissions('customer'),
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    const attachment = {
      attachmentId: '01J00000000000000000000004',
      fileName: '执照.pdf',
      mimeType: 'application/pdf',
      size: 3,
      digest: 'd'.repeat(64),
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
    }
    await vm.addLocalAttachment(draft, attachment)

    await vm.removeAttachment(draft, attachment.attachmentId)

    expect(dependencies.attachments.remove).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({ identityAttachments: [] }),
      }),
      [attachment.attachmentId],
    )
    expect(draft.snapshot.identityAttachments).toEqual([])
  })

  it('keeps root editing separate from the save-subunits capability', () => {
    const vm = createCustomerViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          '/dcl/customer/submit-change',
          ...archiveReferencePermissions('customer'),
        ],
      },
      ports(),
    )

    expect(vm.canEditRoot).toBe(true)
    expect(vm.canEditSubunits).toBe(false)
  })
})
