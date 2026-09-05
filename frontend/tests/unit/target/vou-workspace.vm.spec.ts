import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import {
  createVouDraftPayload,
  systemGeneratedVouEntities,
  userCreatableVouEntities,
  vouEntities,
  vouEntityInputDescriptors,
} from '@zerp/model'

import { vouPageConfigs } from '@/target/pages/vou/shared/config.ts'
import {
  createVouWorkspaceViewModel,
  initializeVouWorkspace,
} from '@/target/pages/vou/shared/vm.ts'

const id = (letter: string) => letter.repeat(26)

function ports() {
  return {
    drafts: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      listAttachments: vi.fn().mockResolvedValue([]),
      saveAndAddAttachment: vi.fn().mockResolvedValue(undefined),
      saveAndDeleteAttachments: vi.fn().mockResolvedValue(undefined),
    },
    api: {
      query: vi.fn(),
      get: vi.fn(),
      submit: vi.fn(),
      review: vi.fn(),
      deleteDocument: vi.fn(),
      stageAttachment: vi.fn().mockResolvedValue({}),
      readAttachment: vi.fn(),
      reference: vi.fn().mockResolvedValue({ items: [] }),
      sourceLine: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      }),
    },
    id: vi
      .fn()
      .mockReturnValueOnce(id('D'))
      .mockReturnValueOnce(id('O'))
      .mockReturnValueOnce(id('S'))
      .mockReturnValue(id('L')),
    now: () => '2026-09-05T09:00:00.000Z',
  }
}

describe('VOU public workspace view-model seam', () => {
  it('loads approved service contracts for the acceptance selector', async () => {
    const dependencies = ports()
    const vm = createVouWorkspaceViewModel(
      'service-acceptance',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/reference/query'],
      },
      dependencies,
    )
    await initializeVouWorkspace(vm)
    expect(dependencies.api.reference).toHaveBeenCalledWith('csrf-token', {
      entity: 'service-contract',
    })
  })
  it('serializes autosave before submission while preserving the local revision', async () => {
    const dependencies = ports()
    const vm = createVouWorkspaceViewModel(
      'sale-order',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-order/submit-new'],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    draft.payload = reactive(draft.payload)
    let release!: () => void
    dependencies.drafts.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const first = vm.saveFamilyDraft(draft)
    const second = vm.saveFamilyDraft(draft)
    const submit = vm.submitDraft(draft)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(dependencies.api.submit).not.toHaveBeenCalled()
    expect(dependencies.drafts.save).toHaveBeenCalledTimes(2)
    release()
    await Promise.all([first, second, submit])
    expect(dependencies.api.submit).toHaveBeenCalledTimes(1)
    expect(vm.draftSaving.value).toBe(false)
  })

  it('serializes attachment add and remove behind an in-flight autosave', async () => {
    const dependencies = ports()
    const order: string[] = []
    let releaseAutosave!: () => void
    dependencies.drafts.save.mockImplementation(async (candidate) => {
      if (candidate.localRevision === undefined) {
        candidate.localRevision = 1
        return
      }
      order.push(`autosave:${candidate.localRevision}`)
      await new Promise<void>((resolve) => {
        releaseAutosave = resolve
      })
      candidate.localRevision += 1
    })
    dependencies.drafts.saveAndAddAttachment.mockImplementation(
      async (candidate) => {
        order.push(`add:${candidate.localRevision}`)
        candidate.localRevision = (candidate.localRevision ?? 0) + 1
      },
    )
    dependencies.drafts.saveAndDeleteAttachments.mockImplementation(
      async (candidate) => {
        order.push(`remove:${candidate.localRevision}`)
        candidate.localRevision = (candidate.localRevision ?? 0) + 1
      },
    )
    const vm = createVouWorkspaceViewModel(
      'sale-pricing',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-pricing/submit-new'],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    const attachment = {
      attachmentId: id('F'),
      fileName: '报价.pdf',
      mimeType: 'application/pdf',
      size: 3,
      digest: 'a'.repeat(64),
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
    }

    draft.payload.remark = '自动保存中的修改'
    const autosave = vm.saveFamilyDraft(draft)
    const add = vm.addLocalAttachment(draft, attachment)
    const remove = vm.deleteLocalAttachment(draft, attachment.attachmentId)

    await vi.waitFor(() => expect(releaseAutosave).toBeTypeOf('function'))
    expect(dependencies.drafts.saveAndAddAttachment).not.toHaveBeenCalled()
    expect(dependencies.drafts.saveAndDeleteAttachments).not.toHaveBeenCalled()
    releaseAutosave()
    await Promise.all([autosave, add, remove])

    expect(order).toEqual(['autosave:1', 'add:2', 'remove:3'])
    expect(draft.localRevision).toBe(4)
    expect(draft.payload.attachments).toEqual([])
    expect(vm.drafts.value[0]).toBe(draft)
  })

  it('registers all 36 entities, exactly 32 local-create pages and four read-only generated pages', () => {
    expect(Object.keys(vouPageConfigs)).toEqual(vouEntities)
    expect(
      Object.values(vouPageConfigs)
        .filter((config) => config.creatable)
        .map((config) => config.entity),
    ).toEqual(userCreatableVouEntities)
    expect(
      Object.values(vouPageConfigs)
        .filter((config) => !config.creatable)
        .map((config) => config.entity),
    ).toEqual(systemGeneratedVouEntities)

    for (const entity of vouEntities) {
      const config = vouPageConfigs[entity]
      expect(config.route).toBe(`/vou/${entity}`)
      expect(config.useCaseKey).toBe(`vou/${entity}`)

      // Descriptors are a coverage oracle only. Runtime editors are selected by
      // an explicit business-family key and never rendered from this metadata.
      expect([...config.coveredPayloadFields].sort()).toEqual(
        vouEntityInputDescriptors[entity].map((field) => field.key).sort(),
      )
    }
  })

  it('sends fixed-page typed filters/sort and ignores an older response that arrives last', async () => {
    const dependencies = ports()
    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    dependencies.api.query
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))
    const vm = createVouWorkspaceViewModel(
      'sale-order',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-order/query'],
      },
      dependencies,
    )

    vm.filters.keyword = '旧订单'
    const first = vm.query(1)
    vm.filters.keyword = '新订单'
    vm.filters.status = ['PENDING', 'REJECTED']
    vm.filters.dateFrom = '2026-09-01'
    vm.filters.dateTo = '2026-09-05'
    vm.filters.counterpartyObjectId = id('C')
    vm.sort.value = { field: 'businessDate', order: 'asc' }
    const second = vm.query(2)
    resolveSecond({ items: [], total: 21, page: 2, pageSize: 20 })
    await second
    resolveFirst({ items: [], total: 1, page: 1, pageSize: 20 })
    await first

    expect(dependencies.api.query).toHaveBeenNthCalledWith(
      2,
      'csrf-token',
      'sale-order',
      {
        page: 2,
        pageSize: 20,
        filters: {
          keyword: '新订单',
          status: ['PENDING', 'REJECTED'],
          dateFrom: '2026-09-01',
          dateTo: '2026-09-05',
          counterpartyObjectId: id('C'),
        },
        sort: [{ field: 'businessDate', order: 'asc' }],
      },
    )
    expect(vm.page.value).toBe(2)
    expect(vm.total.value).toBe(21)
    expect(vm.loading.value).toBe(false)
  })

  it('creates a browser-only typed order draft but refuses generated entities', async () => {
    const orderPorts = ports()
    const order = createVouWorkspaceViewModel(
      'sale-order',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-order/submit-new'],
      },
      orderPorts,
    )

    await order.newDraft()

    expect(orderPorts.drafts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sale-order',
        draftId: id('D'),
        documentId: id('O'),
        submissionId: id('S'),
        stableRevision: null,
        payload: expect.objectContaining({
          businessDate: '2026-09-05',
          currency: 'CNY',
          operatingEntity: expect.any(Object),
          customerSubunit: expect.any(Object),
          warehouse: expect.any(Object),
          productLines: expect.any(Array),
        }),
      }),
    )

    const generatedPorts = ports()
    const generated = createVouWorkspaceViewModel(
      'sale-outbound',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-outbound/submit-new'],
      },
      generatedPorts,
    )
    await generated.newDraft()
    expect(generatedPorts.drafts.save).not.toHaveBeenCalled()
    expect(generated.error.value).toContain('系统生成')
  })

  it('loads source lines through the server-owned target eligibility seam', async () => {
    const dependencies = ports()
    dependencies.api.sourceLine.mockResolvedValue({
      items: [
        {
          sourceDocumentId: id('D'),
          sourceDocumentNo: 'CG2026090001',
          sourceEntity: 'purchase-order',
          rootDocumentId: id('D'),
          rootEntity: 'purchase-order',
          businessDate: '2026-09-05',
          sourceLineId: id('L'),
          product: { objectId: id('P'), code: 'P-01', name: '树脂' },
          availableBaseQuantity: '8.000000',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const vm = createVouWorkspaceViewModel(
      'purchase-inbound',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: [],
      },
      dependencies,
    )

    await vm.loadSourceLines('树脂', id('D'))

    expect(dependencies.api.sourceLine).toHaveBeenCalledWith('csrf-token', {
      targetEntity: 'purchase-inbound',
      page: 1,
      pageSize: 20,
      keyword: '树脂',
      sourceDocumentId: id('D'),
    })
    expect(vm.sourceLineOptions.value[0]?.product.name).toBe('树脂')
  })

  it('deletes only the submitted local draft after success and retains it after failure', async () => {
    const dependencies = ports()
    dependencies.api.submit.mockResolvedValue({})
    dependencies.api.query.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    const vm = createVouWorkspaceViewModel(
      'sale-pricing',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: [
          '/vou/sale-pricing/query',
          '/vou/sale-pricing/submit-new',
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    const submitted = vm.drafts.value[0]!
    await vm.submitDraft(submitted)

    expect(dependencies.api.submit).toHaveBeenCalledWith(
      'csrf-token',
      'sale-pricing',
      'NEW',
      expect.objectContaining({
        documentId: submitted.documentId,
        submissionId: submitted.submissionId,
        idempotencyKey: submitted.submissionId,
        expectedRevision: null,
        payload: expect.objectContaining({ attachments: [] }),
      }),
    )
    expect(dependencies.drafts.delete).toHaveBeenCalledWith(submitted)
    expect(vm.drafts.value).toHaveLength(0)

    const failedPorts = ports()
    failedPorts.api.submit.mockRejectedValue(new Error('服务不可用'))
    const failed = createVouWorkspaceViewModel(
      'purchase-inquiry',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/purchase-inquiry/submit-new'],
      },
      failedPorts,
    )
    await failed.newDraft()
    await failed.submitDraft(failed.drafts.value[0]!)
    expect(failedPorts.drafts.delete).not.toHaveBeenCalled()
    expect(failed.drafts.value).toHaveLength(1)
    expect(failed.error.value).toContain('服务不可用')
  })

  it('executes only actions returned by the selected server view without opening list detail', async () => {
    const dependencies = ports()
    const vm = createVouWorkspaceViewModel(
      'purchase-order',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: [],
      },
      dependencies,
    )
    const view = {
      entity: 'purchase-order' as const,
      documentId: id('O'),
      documentNo: 'POR-20260905-0001',
      stableRevision: '1',
      submissionId: id('S'),
      status: 'PENDING' as const,
      revision: '2',
      submittedBy: id('U'),
      submittedAt: '2026-09-05T09:00:00.000Z',
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      payload: {
        businessDate: '2026-09-05',
        currency: 'CNY',
        attachments: [],
        supplier: {
          objectId: id('P'),
          approvalEntryId: id('A'),
          selectionOrigin: 'CURRENT' as const,
        },
        warehouse: {
          objectId: id('W'),
          approvalEntryId: id('H'),
          selectionOrigin: 'CURRENT' as const,
        },
        productLines: [],
      },
      availableApprovalActions: ['approve'] as const,
      canDelete: false,
    }
    const updated = {
      ...view,
      status: 'APPROVED' as const,
      revision: '3',
      availableApprovalActions: ['unapprove'] as const,
    }
    dependencies.api.review.mockResolvedValue(updated)

    await vm.review(view, 'reject')
    expect(dependencies.api.review).not.toHaveBeenCalled()
    expect(vm.error.value).toContain('服务器')

    await vm.review(view, 'approve')
    expect(vm.detail.value).toBeNull()
    expect(dependencies.api.review).toHaveBeenCalledWith(
      'csrf-token',
      'purchase-order',
      {
        action: 'approve',
        input: {
          documentId: id('O'),
          submissionId: id('S'),
          expectedRevision: '2',
        },
      },
    )

    const detailView = {
      ...view,
      documentId: id('Z'),
      submissionId: id('Y'),
    }
    const updatedDetail = {
      ...updated,
      documentId: detailView.documentId,
      submissionId: detailView.submissionId,
    }
    dependencies.api.review.mockResolvedValueOnce(updatedDetail)
    vm.detail.value = detailView
    await vm.review(detailView, 'approve')
    expect(vm.detail.value).toBe(updatedDetail)
  })

  it('stages IndexedDB attachment bytes only for submit and retains the Draft when staging fails', async () => {
    const dependencies = ports()
    dependencies.api.submit.mockResolvedValue({})
    dependencies.api.query.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    const vm = createVouWorkspaceViewModel(
      'sale-pricing',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: [
          '/vou/sale-pricing/query',
          '/vou/sale-pricing/submit-new',
          '/vou/sale-pricing/attachment-stage',
        ],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    const attachment = {
      attachmentId: id('F'),
      fileName: '报价.pdf',
      mimeType: 'application/pdf',
      size: 3,
      digest: 'a'.repeat(64),
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
    }
    dependencies.drafts.listAttachments.mockResolvedValue([attachment])
    await vm.addLocalAttachment(draft, attachment)
    await vm.submitDraft(draft)

    expect(dependencies.api.stageAttachment).toHaveBeenCalledWith(
      'csrf-token',
      'sale-pricing',
      expect.objectContaining({
        fileId: id('F'),
        mimeType: 'application/pdf',
        contentBase64: 'cGRm',
      }),
    )
    expect(dependencies.api.submit).toHaveBeenCalledWith(
      'csrf-token',
      'sale-pricing',
      'NEW',
      expect.objectContaining({
        payload: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              id: id('F'),
              stagingId: expect.stringMatching(/^.{26}$/),
            }),
          ],
        }),
      }),
    )
    expect(dependencies.drafts.delete).toHaveBeenCalledWith(draft)

    const failedDependencies = ports()
    failedDependencies.api.stageAttachment.mockRejectedValue(
      new Error('附件暂存失败'),
    )
    const failed = createVouWorkspaceViewModel(
      'sale-pricing',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-pricing/submit-new'],
      },
      failedDependencies,
    )
    await failed.newDraft()
    const failedDraft = failed.drafts.value[0]!
    failedDependencies.drafts.listAttachments.mockResolvedValue([attachment])
    await failed.addLocalAttachment(failedDraft, attachment)
    await failed.submitDraft(failedDraft)
    expect(failed.error.value).toContain('附件暂存失败')
    expect(failedDependencies.api.submit).not.toHaveBeenCalled()
    expect(failedDependencies.drafts.delete).not.toHaveBeenCalled()
    expect(failed.drafts.value).toHaveLength(1)
  })

  it('removes local attachment metadata and its IndexedDB Blob through one draft transaction', async () => {
    const dependencies = ports()
    const vm = createVouWorkspaceViewModel(
      'sale-pricing',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-pricing/submit-new'],
      },
      dependencies,
    )
    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    const attachment = {
      attachmentId: id('F'),
      fileName: '报价.pdf',
      mimeType: 'application/pdf',
      size: 3,
      digest: 'a'.repeat(64),
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
    }
    await vm.addLocalAttachment(draft, attachment)
    await vm.deleteLocalAttachment(draft, attachment.attachmentId)

    expect(dependencies.drafts.saveAndDeleteAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ attachments: [] }),
      }),
      [attachment.attachmentId],
    )
    expect(vm.drafts.value[0]?.payload.attachments).toEqual([])
  })

  it('rejects a changed deep-link identity instead of operating on another submission', async () => {
    const dependencies = ports()
    dependencies.api.get.mockResolvedValue({
      entity: 'sale-order',
      documentId: id('D'),
      documentNo: 'SO-1',
      stableRevision: '1',
      submissionId: id('S'),
      status: 'REJECTED',
      revision: '2',
      submittedBy: id('U'),
      submittedAt: '2026-09-05T09:00:00.000Z',
      approvedBy: null,
      approvedAt: null,
      rejectedBy: id('R'),
      rejectedAt: '2026-09-05T10:00:00.000Z',
      rejectionReason: '修改后再报',
      payload: createVouDraftPayload('sale-order', () => id('L')),
      availableApprovalActions: [],
      canDelete: false,
    })
    const vm = createVouWorkspaceViewModel(
      'sale-order',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-order/get', '/vou/sale-order/submit-change'],
      },
      dependencies,
    )

    await vm.synchronizeDeepLink({
      objectId: id('D'),
      documentId: id('D'),
      submissionId: id('X'),
      revision: '2',
      mode: 'edit',
    })
    expect(dependencies.api.get).toHaveBeenCalledWith(
      'csrf-token',
      'sale-order',
      id('D'),
    )
    expect(vm.detail.value).toBeNull()
    expect(vm.error.value).toContain('已变化')
    expect(dependencies.drafts.save).not.toHaveBeenCalled()
  })

  it('synchronizes changing deep links without reopening stale details or cloning unapproved views', async () => {
    const dependencies = ports()
    dependencies.api.query.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    let resolveOld!: (value: unknown) => void
    let resolveApproved!: (value: unknown) => void
    let resolveRejected!: (value: unknown) => void
    dependencies.api.get
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockReturnValueOnce(
        new Promise((resolve) => (resolveApproved = resolve)),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => (resolveRejected = resolve)),
      )
    const vm = createVouWorkspaceViewModel(
      'sale-order',
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf-token',
        permissions: ['/vou/sale-order/get', '/vou/sale-order/submit-change'],
      },
      dependencies,
    )
    const view = (documentId: string, status: 'APPROVED' | 'REJECTED') => ({
      entity: 'sale-order' as const,
      documentId,
      documentNo: `SO-${documentId[0]}`,
      stableRevision: '1',
      submissionId: id('S'),
      status,
      revision: '2',
      submittedBy: id('U'),
      submittedAt: '2026-09-05T09:00:00.000Z',
      approvedBy: status === 'APPROVED' ? id('A') : null,
      approvedAt: status === 'APPROVED' ? '2026-09-05T10:00:00.000Z' : null,
      rejectedBy: status === 'REJECTED' ? id('R') : null,
      rejectedAt: status === 'REJECTED' ? '2026-09-05T10:00:00.000Z' : null,
      rejectionReason: status === 'REJECTED' ? '需修订' : null,
      payload: createVouDraftPayload('sale-order', () => id('L')),
      availableApprovalActions: [],
      canDelete: false,
    })

    const oldRequest = vm.synchronizeDeepLink({
      documentId: id('O'),
      mode: 'edit',
    })
    await vm.synchronizeDeepLink({})
    resolveOld(view(id('O'), 'APPROVED'))
    await oldRequest
    expect(vm.detail.value).toBeNull()
    expect(dependencies.drafts.save).not.toHaveBeenCalled()

    const approvedRequest = vm.synchronizeDeepLink({
      documentId: id('A'),
      mode: 'edit',
    })
    resolveApproved(view(id('A'), 'APPROVED'))
    await approvedRequest
    expect(vm.detail.value?.documentId).toBe(id('A'))
    expect(dependencies.drafts.save).toHaveBeenCalledTimes(1)

    const rejectedRequest = vm.synchronizeDeepLink({
      documentId: id('R'),
      mode: 'edit',
    })
    resolveRejected(view(id('R'), 'REJECTED'))
    await rejectedRequest
    expect(dependencies.drafts.save).toHaveBeenCalledTimes(1)
    expect(vm.error.value).toContain('当前批准版本')
  })
})
