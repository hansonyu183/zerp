import { describe, expect, it, vi } from 'vitest'

import { createDclAccMappingViewModel } from '@/target/pages/dcl/acc-mapping/vm.ts'

describe('DCL ACC mapping public view-model seam', () => {
  it('edits a typed mapping definition and preserves the local Draft when submit fails', async () => {
    const ports = {
      drafts: {
        list: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      query: vi.fn().mockResolvedValue({ submissions: [], total: 0 }),
      get: vi.fn(),
      versions: vi.fn(),
      audit: vi.fn(),
      submit: vi.fn().mockRejectedValue(new Error('映射定义无效')),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
      catalog: vi.fn().mockResolvedValue({
        books: [
          {
            id: '01K4A000000000000000000010',
            code: 'ACC-0001',
            name: '控制账簿',
          },
        ],
        vouEntities: [
          {
            id: '01K4A000000000000000000011',
            code: 'purchase-order',
            name: '采购订单',
            fieldCatalog: {
              headerFields: ['payload.customerId', 'payload.currency'],
              lineFields: ['lines.amount'],
            },
          },
        ],
        subjects: [
          {
            id: '01K4A000000000000000000012',
            bookId: '01K4A000000000000000000010',
            code: '1122',
            name: '应收账款',
            requiredDimensions: ['CUSTOMER_SUBUNIT'],
          },
        ],
      }),
    }
    const vm = createDclAccMappingViewModel(
      {
        ownerUserId: '01K4A000000000000000000001',
        csrfToken: 'csrf-token',
        permissions: [
          '/dcl/acc-mapping/submit-new',
          '/dcl/acc-mapping/query',
          '/acc/mapping/catalog',
        ],
      },
      ports,
    )

    await vm.newDraft()
    const draft = vm.drafts.value[0]!
    await vm.loadCatalog()
    vm.selectBook(draft, '01K4A000000000000000000010')
    vm.selectVouEntity(draft, '01K4A000000000000000000011')
    vm.addTemplate(draft)
    vm.addTemplateLine(draft, 0)
    vm.selectFixedSubject(
      draft,
      draft.snapshot.definition.templates[0]!.lines[0]!,
      '01K4A000000000000000000012',
    )
    const debitLine = draft.snapshot.definition.templates[0]!.lines[0]!
    debitLine.amountField = 'lines.amount'
    debitLine.currencyField = 'payload.currency'
    debitLine.dimensions.CUSTOMER_SUBUNIT = 'payload.customerId'
    vm.selectCostCounterpartSubject(
      draft,
      debitLine,
      '01K4A000000000000000000012',
    )
    debitLine.costCounterpartDimensions.CUSTOMER_SUBUNIT = 'payload.customerId'
    vm.addTemplateLine(draft, 0)

    const creditLine = draft.snapshot.definition.templates[0]!.lines[1]!
    vm.selectFixedSubject(draft, creditLine, '01K4A000000000000000000012')
    creditLine.amountField = 'lines.amount'
    creditLine.currencyField = 'payload.currency'
    creditLine.dimensions.CUSTOMER_SUBUNIT = 'payload.customerId'

    await vm.submitDraft(draft)

    expect(draft.snapshot.definition.templates).toHaveLength(1)
    expect(draft.snapshot.definition.templates[0]?.lines).toHaveLength(2)
    expect(
      draft.snapshot.definition.templates[0]?.lines[0]?.dimensions,
    ).toEqual({ CUSTOMER_SUBUNIT: 'payload.customerId' })
    expect(debitLine.costCounterpartDimensions).toEqual({
      CUSTOMER_SUBUNIT: 'payload.customerId',
    })
    expect(vm.templateOptions(draft)).toEqual([
      { title: '模板 1', value: 'template-1' },
    ])
    expect(ports.drafts.delete).not.toHaveBeenCalled()
    expect(vm.drafts.value).toHaveLength(1)
    expect(vm.error.value).toBe('映射定义无效')

    ports.submit.mockResolvedValueOnce(undefined)
    await vm.submitDraft(draft)
    expect(ports.drafts.delete).toHaveBeenCalledOnce()
    expect(vm.drafts.value).toHaveLength(0)
    expect(ports.query).toHaveBeenCalledOnce()
  })

  it('opens an exact workbench submission without relying on the current page', async () => {
    const exact = {
      subjectId: 'subject-off-page',
      code: 'MAP-0021',
      submissionId: 'submission-exact',
      versionNo: 2,
      status: 'APPROVED' as const,
      revision: '4',
      availableApprovalActions: ['unapprove'] as const,
      canDelete: false,
      snapshot: {},
    }
    const ports = {
      drafts: { list: vi.fn(), save: vi.fn(), delete: vi.fn() },
      query: vi.fn(),
      get: vi.fn().mockResolvedValue(exact),
      versions: vi.fn().mockResolvedValue([exact]),
      audit: vi.fn().mockResolvedValue([]),
      submit: vi.fn(),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
      catalog: vi.fn(),
    }
    const vm = createDclAccMappingViewModel(
      { ownerUserId: 'user-1', csrfToken: 'csrf', permissions: [] },
      ports,
    )

    await vm.synchronizeDeepLink({
      objectId: exact.subjectId,
      submissionId: exact.submissionId,
      revision: exact.revision,
      mode: 'view',
    })

    expect(ports.query).not.toHaveBeenCalled()
    expect(vm.detail.value?.submission).toMatchObject(exact)
  })
})
