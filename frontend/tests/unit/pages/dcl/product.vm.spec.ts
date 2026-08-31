import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclProductViewModel } from '@/pages/dcl/product/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: 'PRD-V1',
  versionNo: 1,
  status: 'DRAFT' as const,
  revision: 2,
  createdBy: 'USER-1',
  createdAt: '2026-08-28T00:00:00Z',
  updatedBy: 'USER-1',
  updatedAt: '2026-08-28T00:00:00Z',
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
}

const productData = {
  name: '测试产品',
  productTypeId: 'TYPE-1',
  behaviorProfile: 'RAW_MATERIAL' as const,
  defaultInputUnitId: 'UNIT-1',
  pricingUnitId: 'UNIT-1',
  unitConversions: [{ unit: { objectId: 'UNIT-1' }, factor: '1' }],
  returnable: false,
  defaultPackagingSpec: '1',
}

function productView(status: 'DRAFT' | 'PENDING' | 'APPROVED' = 'DRAFT') {
  return {
    objectId: 'PRD-1',
    entity: 'product' as const,
    code: 'PRD-0001',
    enabled: true,
    approval: { ...approval, status },
    data: productData,
    updatedAt: '2026-08-28T00:00:00Z',
  }
}

function productListItem(
  status: 'DRAFT' | 'PENDING' | 'APPROVED' = 'DRAFT',
  availableApprovalActions: Array<
    'submit' | 'unsubmit' | 'reject' | 'approve' | 'unapprove'
  > = [],
) {
  const version = {
    approval: { ...approval, status },
    enabled: true,
    data: productData,
  }
  return {
    objectId: 'PRD-1',
    entity: 'product' as const,
    code: 'PRD-0001',
    enabled: true,
    availableApprovalActions,
    latestApproved: status === 'APPROVED' ? version : null,
    openVersion: status === 'APPROVED' ? null : version,
    updatedAt: '2026-08-28T00:00:00Z',
  }
}

function grantEditorPermissions(): void {
  useSessionStore().permissions = [
    '/dcl/product/create',
    '/dcl/product/get',
    '/dcl/product/save',
    '/aux/product-type/query',
    '/aux/measurement-unit/query',
    '/aux/product-category/query',
  ]
}

describe('DCL product view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('submits through DCL after reading the complete product candidate', async () => {
    useSessionStore().permissions = [
      '/dcl/product/query',
      '/dcl/product/get',
      '/dcl/product/submit',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              objectId: 'PRD-1',
              entity: 'product',
              code: 'PRD-0001',
              enabled: true,
              availableApprovalActions: ['submit'],
              latestApproved: null,
              openVersion: { approval, enabled: true, data: productData },
              updatedAt: '2026-08-28T00:00:00Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({
        data: {
          objectId: 'PRD-1',
          entity: 'product',
          code: 'PRD-0001',
          enabled: true,
          approval,
          data: productData,
          updatedAt: '2026-08-28T00:00:00Z',
        },
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclProductViewModel()

    await vm.query()
    await expect(vm.submitObject(vm.rows.value[0]!)).resolves.toBe(true)

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/product/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/product/get', {
      objectId: 'PRD-1',
    })
    expect(mockedPost).toHaveBeenNthCalledWith(3, 'dcl/product/submit', {
      objectId: 'PRD-1',
      approvalEntryId: 'PRD-V1',
      approvalRevision: 2,
    })
    expect(mockedPost.mock.calls.map(([path]) => String(path))).not.toContain(
      'bob/product/submit',
    )
  })

  it('keeps DCL candidate and current approved versions distinct in the typed list', async () => {
    useSessionStore().permissions = ['/dcl/product/query']
    const approved = productListItem('APPROVED')
    const candidate = {
      ...approved,
      openVersion: {
        approval: { ...approval, approvalEntryId: 'PRD-V2', versionNo: 2 },
        enabled: true,
        data: { ...productData, defaultPackagingSpec: '2' },
      },
    }
    mockedPost.mockResolvedValueOnce({
      data: { items: [candidate], total: 1, page: 1, pageSize: 20 },
    })
    const vm = useDclProductViewModel()

    await vm.query()

    expect(vm.rows.value[0]?.latestApproved?.summary.defaultPackagingSpec).toBe(
      '1',
    )
    expect(vm.rows.value[0]?.openVersion?.summary.defaultPackagingSpec).toBe(
      '2',
    )
  })

  it('serializes create and approved-to-candidate save through DCL with revision', async () => {
    grantEditorPermissions()
    mockedPost
      .mockResolvedValueOnce({ data: productView('PENDING') })
      .mockResolvedValue({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclProductViewModel()

    vm.openCreate()
    await expect(
      vm.save({ ...vm.editorModel.value, name: ' 新产品 ', barcode: ' abc ' }),
    ).resolves.toBe(true)
    expect(mockedPost.mock.calls.map(([path]) => path)).toContain(
      'dcl/product/create',
    )

    vi.clearAllMocks()
    mockedPost
      .mockResolvedValueOnce({ data: productView('APPROVED') })
      .mockResolvedValue({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    await vm.openById('PRD-1', 'edit')
    await expect(
      vm.save({
        ...vm.editorModel.value,
        defaultPackagingSpec: '2',
        formula: {
          output: {
            enteredQuantity: '1',
            enteredUnit: { objectId: 'UNIT-1' },
            baseQuantity: '1',
          },
          components: [],
        },
      }),
    ).resolves.toBe(true)
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/product/save',
      expect.objectContaining({
        objectId: 'PRD-1',
        approvalEntryId: 'PRD-V1',
        approvalRevision: 2,
      }),
    )
    const save = mockedPost.mock.calls.find(
      ([path]) => path === 'dcl/product/save',
    )
    expect(save?.[1]).toHaveProperty('data.formula.output.enteredQuantity', '1')
  })

  it('requires DCL create or save plus every AUX and BOB reference-query permission before editing', () => {
    const required = [
      '/dcl/product/create',
      '/aux/product-type/query',
      '/aux/measurement-unit/query',
      '/aux/product-category/query',
    ]
    for (const missing of required) {
      setActivePinia(createPinia())
      useSessionStore().permissions = required.filter(
        (path) => path !== missing,
      )
      const vm = useDclProductViewModel()
      vm.openCreate()
      expect(vm.canCreate.value, missing).toBe(false)
      expect(vm.drawerOpen.value, missing).toBe(false)
    }

    setActivePinia(createPinia())
    useSessionStore().permissions = [
      '/dcl/product/get',
      '/aux/product-type/query',
      '/aux/measurement-unit/query',
      '/aux/product-category/query',
    ]
    expect(
      useDclProductViewModel().actionAvailability(productListItem('APPROVED'))
        .edit,
    ).toBe(false)
  })

  it('enforces self-review, reverse reasons, DCL review paths, and enabled candidates', async () => {
    useSessionStore().user = { id: 'USER-1' } as never
    useSessionStore().permissions = [
      '/dcl/product/get',
      '/dcl/product/approve',
      '/dcl/product/reject',
      '/dcl/product/unsubmit',
      '/dcl/product/unapprove',
      '/dcl/product/save',
    ]
    const vm = useDclProductViewModel()
    const pending = {
      ...productListItem('PENDING', ['unsubmit']),
      openVersion: {
        ...productListItem('PENDING', ['unsubmit']).openVersion!,
        approval: {
          ...approval,
          status: 'PENDING' as const,
          submittedBy: 'USER-1',
        },
      },
    }
    expect(vm.actionAvailability(pending).approve).toBe(false)
    expect(vm.actionAvailability(pending).unsubmit).toBe(true)

    const approved = productListItem('APPROVED')
    expect(vm.actionAvailability(approved).disable).toBe(true)
    mockedPost.mockResolvedValue({ data: productView('APPROVED') })
    await expect(vm.changeEnabled(approved)).resolves.toBe(true)
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/product/save',
      expect.objectContaining({ approvalRevision: 2, enabled: false }),
    )
  })

  it('uses DCL approve, reject, unsubmit, and unapprove endpoints with the active revision', async () => {
    useSessionStore().user = {
      id: 'USER-2',
      username: 'reviewer',
      displayName: '审核人',
      avatarUrl: null,
    }
    useSessionStore().permissions = [
      '/dcl/product/get',
      '/dcl/product/approve',
      '/dcl/product/reject',
      '/dcl/product/unsubmit',
      '/dcl/product/unapprove',
    ]
    mockedPost
      .mockResolvedValueOnce({ data: productView('PENDING') })
      .mockResolvedValue({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclProductViewModel()
    const pending = {
      ...productListItem('PENDING', ['approve', 'reject', 'unsubmit']),
      openVersion: {
        ...productListItem('PENDING', ['approve', 'reject', 'unsubmit'])
          .openVersion!,
        approval: {
          ...approval,
          status: 'PENDING' as const,
          submittedBy: 'USER-1',
        },
      },
    }
    const approved = productListItem('APPROVED', ['unapprove'])

    await expect(vm.review(pending, 'approve', '')).resolves.toBe(true)
    await expect(vm.review(pending, 'reject', ' 信息缺失 ')).resolves.toBe(true)
    await expect(vm.reverse(pending, 'unsubmit', ' 补充资料 ')).resolves.toBe(
      true,
    )
    await expect(vm.reverse(approved, 'unapprove', ' 重新维护 ')).resolves.toBe(
      true,
    )

    expect(mockedPost).toHaveBeenCalledWith('dcl/product/approve', {
      objectId: 'PRD-1',
      approvalEntryId: 'PRD-V1',
      approvalRevision: 2,
    })
    expect(mockedPost).toHaveBeenCalledWith('dcl/product/reject', {
      objectId: 'PRD-1',
      approvalEntryId: 'PRD-V1',
      approvalRevision: 2,
      reason: '信息缺失',
    })
    expect(mockedPost).toHaveBeenCalledWith('dcl/product/unsubmit', {
      objectId: 'PRD-1',
      approvalEntryId: 'PRD-V1',
      approvalRevision: 2,
      reason: '',
    })
    expect(mockedPost).toHaveBeenCalledWith('dcl/product/unapprove', {
      objectId: 'PRD-1',
      approvalEntryId: 'PRD-V1',
      approvalRevision: 2,
      reason: '重新维护',
    })
  })

  it('refreshes product rows after a delete failure without replaying the delete', async () => {
    useSessionStore().permissions = [
      '/dcl/product/query',
      '/dcl/product/delete',
    ]
    const stale = productListItem()
    mockedPost.mockImplementation(async (path) => {
      if (path === 'dcl/product/delete')
        throw new Error('delete stale revision')
      if (path === 'dcl/product/query')
        return {
          data: {
            items: [{ ...stale, availableApprovalActions: [] }],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        } as never
      return { data: {} } as never
    })
    const vm = useDclProductViewModel()

    await expect(vm.deleteObject(stale)).resolves.toBe(false)

    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/product/delete'),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(([path]) => path === 'dcl/product/query'),
    ).toHaveLength(1)
    expect(vm.rows.value).toHaveLength(1)
  })

  it('queries DCL product filters and reference search without BOB write routes', async () => {
    vi.useFakeTimers()
    try {
      grantEditorPermissions()
      mockedPost.mockResolvedValue({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
      const vm = useDclProductViewModel()
      vm.keyword.value = '树脂'
      vm.filters.value.productTypeId = 'TYPE-1'
      vm.filters.value.categoryId = 'CAT-1'
      await vm.query()
      expect(mockedPost).toHaveBeenCalledWith('dcl/product/query', {
        page: 1,
        pageSize: 20,
        filters: {
          keyword: '树脂',
          productTypeId: 'TYPE-1',
          categoryId: 'CAT-1',
        },
        sort: [{ field: 'code', order: 'asc' }],
      })

      vm.openCreate()
      vm.searchEditorReference('productTypeId', '成品', vm.editorModel.value)
      await vi.advanceTimersByTimeAsync(300)
      expect(mockedPost).toHaveBeenCalledWith(
        'aux/product-type/query',
        expect.objectContaining({
          filters: expect.objectContaining({ keyword: '成品' }),
        }),
      )
      expect(mockedPost.mock.calls.map(([path]) => String(path))).not.toContain(
        'bob/product/create',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('preloads enabled product type, unit, and category candidates on create', async () => {
    grantEditorPermissions()
    mockedPost.mockImplementation(async (path) => {
      const entity = String(path).split('/')[1]
      return {
        data: {
          items: [
            {
              objectId: `${entity}-1`,
              entity,
              code: entity === 'measurement-unit' ? 'UNT-0009' : 'PCT-0003',
              enabled: true,
              objectRevision: 1,
              data: { name: `${entity} 候选` },
              updatedAt: '2026-08-31T00:00:00Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      } as never
    })

    const vm = useDclProductViewModel()
    vm.openCreate()
    await flushPromises()

    expect(mockedPost.mock.calls.map(([path]) => String(path))).toEqual(
      expect.arrayContaining([
        'aux/product-type/query',
        'aux/measurement-unit/query',
        'aux/product-category/query',
      ]),
    )
    expect(
      vm.editorFields.value.find((field) => field.key === 'unitConversions')
        ?.options,
    ).toEqual([
      expect.objectContaining({
        value: 'measurement-unit-1',
        title: 'UNT-0009 · measurement-unit 候选',
      }),
    ])
    expect(
      vm.editorFields.value.find((field) => field.key === 'categoryId')
        ?.options,
    ).toEqual([
      expect.objectContaining({
        value: 'product-category-1',
        title: 'PCT-0003 · product-category 候选',
      }),
    ])
  })
})
