import { describe, expect, it, vi } from 'vitest'

import { createProductViewModel } from '@/target/pages/dcl/product/vm.ts'
import { archiveSubmitPermissions } from '@/target/archive-presentation.ts'

function ports() {
  return {
    drafts: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    api: {
      query: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      get: vi.fn(),
      versions: vi.fn(),
      audit: vi.fn(),
      submit: vi.fn(),
      review: vi.fn(),
      deleteSubmission: vi.fn(),
      auxReference: vi.fn().mockResolvedValue([]),
      bobReference: vi.fn().mockResolvedValue([]),
    },
    now: () => '2026-09-05T10:00:00.000Z',
  }
}

describe('Product DCL public view-model seam', () => {
  it('copies authoritative measurement-unit symbol and scale into the Draft', async () => {
    const dependencies = ports()
    dependencies.api.auxReference.mockImplementation(
      async (_csrf: string, entity: string) => {
        if (entity === 'product-type')
          return [
            {
              objectId: 'type-1',
              code: 'RAW',
              name: '原料',
              behaviorProfile: 'RAW_MATERIAL',
            },
          ]
        if (entity === 'product-category')
          return [{ objectId: 'category-1', code: 'CAT', name: '分类' }]
        if (entity === 'measurement-unit')
          return [
            {
              objectId: 'unit-1',
              code: 'KG',
              name: '千克',
              symbol: 'kg',
              quantityScale: 3,
            },
            {
              objectId: 'unit-without-scale',
              code: 'BROKEN',
              name: '缺少精度的单位',
              symbol: 'broken',
            },
          ]
        return []
      },
    )
    const vm = createProductViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: archiveSubmitPermissions('product', 'NEW'),
      },
      dependencies,
    )
    await vm.loadReferences()
    await vm.newDraft()
    const draft = vm.drafts.value[0]!

    vm.selectProductType(draft, 'type-1')
    vm.selectProductCategory(draft, 'category-1')
    vm.addUnitConversion(draft, 'unit-1')
    vm.addUnitConversion(draft, 'unit-without-scale')

    expect(draft.snapshot.productType.behaviorProfile).toBe('RAW_MATERIAL')
    expect(draft.snapshot.unitConversions[0]).toEqual({
      unit: {
        id: 'unit-1',
        code: 'KG',
        name: '千克',
        symbol: 'kg',
        quantityScale: 3,
      },
      factor: '1.000000',
    })
    expect(draft.snapshot.unitConversions).toHaveLength(1)
  })

  it('moves cloned formula materials to latest approved and requires explicit confirmation', async () => {
    const dependencies = ports()
    dependencies.api.get.mockResolvedValue({
      entity: 'product',
      subjectId: 'product-subject',
      code: 'PRD-0001',
      submissionId: 'product-entry-2',
      versionNo: 2,
      status: 'APPROVED',
      revision: '3',
      submittedBy: 'user-1',
      submittedAt: '2026-09-05T00:00:00.000Z',
      approvedBy: 'reviewer-1',
      approvedAt: '2026-09-05T01:00:00.000Z',
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      snapshot: {
        name: '标准成品',
        barcode: '',
        specification: '',
        model: '',
        productType: {
          id: 'type-1',
          code: 'FINISHED',
          name: '自制成品',
          behaviorProfile: 'STANDARD_FINISHED',
        },
        productCategory: {
          id: 'category-1',
          code: 'CAT',
          name: '产品分类',
        },
        pricingUnit: {
          id: 'unit-kg',
          code: 'KG',
          name: '千克',
          symbol: 'kg',
          quantityScale: 3,
        },
        defaultInputUnit: {
          id: 'unit-kg',
          code: 'KG',
          name: '千克',
          symbol: 'kg',
          quantityScale: 3,
        },
        unitConversions: [
          {
            unit: {
              id: 'unit-kg',
              code: 'KG',
              name: '千克',
              symbol: 'kg',
              quantityScale: 3,
            },
            factor: '1.000000',
          },
        ],
        defaultPackagingSpec: '1.000000',
        recyclable: false,
        fixedFormula: {
          output: {
            enteredQuantity: '1.000000',
            enteredUnit: {
              id: 'unit-kg',
              code: 'KG',
              name: '千克',
              symbol: 'kg',
              quantityScale: 3,
            },
            baseQuantity: '1.000000',
          },
          components: [
            {
              material: {
                objectId: 'material-1',
                approvalEntryId: 'material-entry-1',
                code: 'PRD-0002',
                name: '原料旧版',
              },
              quantity: {
                enteredQuantity: '10.000000',
                enteredUnit: {
                  id: 'unit-kg',
                  code: 'KG',
                  name: '千克',
                  symbol: 'kg',
                  quantityScale: 3,
                },
                baseQuantity: '10.000000',
              },
              resolutionStatus: 'CURRENT',
              requiresConfirmation: false,
            },
          ],
        },
        remark: '',
        enabled: true,
      },
      availableApprovalActions: [],
      canDelete: false,
    })
    dependencies.api.bobReference.mockResolvedValue([
      {
        objectId: 'material-1',
        approvalEntryId: 'material-entry-2',
        code: 'PRD-0002',
        name: '原料新版',
      },
    ])
    const listItem = {
      entity: 'product' as const,
      subjectId: 'product-subject',
      code: 'PRD-0001',
      submissionId: 'product-entry-2',
      versionNo: 2,
      status: 'APPROVED' as const,
      revision: '3',
      submittedBy: 'user-1',
      submittedAt: '2026-09-05T00:00:00.000Z',
      approvedBy: 'reviewer-1',
      approvedAt: '2026-09-05T01:00:00.000Z',
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      availableApprovalActions: [],
      canDelete: false,
    }
    dependencies.api.query.mockResolvedValue({
      items: [
        {
          entity: 'product',
          subjectId: 'product-subject',
          code: 'PRD-0001',
          latestApproved: listItem,
          openCandidate: null,
        },
      ],
      total: 1,
    })
    const vm = createProductViewModel(
      {
        ownerUserId: 'user-1',
        csrfToken: 'csrf',
        permissions: [
          ...archiveSubmitPermissions('product', 'CHANGE'),
          '/dcl/product/query',
          '/dcl/product/get',
        ],
      },
      dependencies,
    )

    await vm.query(1)
    await vm.cloneSubmission(listItem)

    const draft = vm.drafts.value[0]!
    const component = (draft.snapshot.fixedFormula?.components ?? [])[0]!
    expect(component.material.approvalEntryId).toBe('material-entry-2')
    expect(component.material.name).toBe('原料新版')
    expect(component.quantity.baseQuantity).toBe('10.000000')
    expect(component.requiresConfirmation).toBe(true)
    expect(vm.validateDraft(draft)).toContain('请确认已前移的固定配方原料。')

    vm.confirmFormulaComponent(draft, 0)
    expect(vm.validateDraft(draft)).not.toContain(
      '请确认已前移的固定配方原料。',
    )

    dependencies.api.bobReference.mockResolvedValue([
      { objectId: 'material-1' },
    ])
    await vm.cloneSubmission(listItem)
    const unresolved = vm.drafts.value[0]!.snapshot.fixedFormula!.components[0]!
    expect(unresolved.material).toEqual({
      objectId: 'material-1',
      approvalEntryId: 'material-entry-1',
      code: 'PRD-0002',
      name: '原料旧版',
    })
    expect(unresolved.resolutionStatus).toBe('UNRESOLVED')
    expect(unresolved.requiresConfirmation).toBe(true)

    const exact = await dependencies.api.get.mock.results[0]!.value
    dependencies.api.versions.mockResolvedValue({ items: [exact] })
    dependencies.api.audit.mockResolvedValue({ items: [] })
    dependencies.api.bobReference.mockResolvedValue([
      {
        objectId: 'material-1',
        approvalEntryId: 'material-entry-2',
        code: 'PRD-0002',
        name: '原料新版',
      },
    ])
    await vm.synchronizeDeepLink({
      objectId: 'product-subject',
      submissionId: 'product-entry-2',
      revision: '3',
      mode: 'edit',
    })
    const deepLinked = vm.drafts.value[0]!.snapshot.fixedFormula!.components[0]!
    expect(deepLinked.material.approvalEntryId).toBe('material-entry-2')
    expect(deepLinked.requiresConfirmation).toBe(true)
  })
})
