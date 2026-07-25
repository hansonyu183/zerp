import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  calculateContainerBalanceAfter,
  calculateExpectedContainers,
  calculateLoss,
} from '@/pages/vou/intermediary-sale-order/v2/calculations'
import {
  intermediaryActionPaths,
  intermediaryWorkflowApi,
} from '@/pages/vou/intermediary-sale-order/v2/api'
import { useIntermediaryWorkflowViewModel } from '@/pages/vou/intermediary-sale-order/v2/vm'
import type {
  IntermediaryChildSummary,
  IntermediaryWorkflowDocument,
} from '@/pages/vou/intermediary-sale-order/v2/types'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    uploadAttachment: vi.fn(),
    fetchAttachment: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedApi = vi.mocked(apiClient)
const reference = (entity: string, code: string) => ({
  objectId: `${entity}-1`,
  versionId: `${entity}-v1`,
  entity,
  code,
  name: code,
})

describe('intermediary workflow V2 PR #11 contract', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('集中注册子单删除和四阶段附件的精确路径', () => {
    expect(intermediaryActionPaths.procurementDelete).toBe(
      'vou/intermediary-sale-order/procurement-delete',
    )
    expect(intermediaryActionPaths.receiptAttachmentInitiate).toBe(
      'vou/intermediary-sale-order/receipt-attachment-initiate',
    )
    expect(intermediaryActionPaths.deliveryAttachmentDownload).toBe(
      'vou/intermediary-sale-order/delivery-attachment-download',
    )
    expect(intermediaryActionPaths.signoffAttachmentRemove).toBe(
      'vou/intermediary-sale-order/signoff-attachment-remove',
    )
    expect(Object.values(intermediaryActionPaths)).toHaveLength(
      new Set(Object.values(intermediaryActionPaths)).size,
    )
  })

  it('创建使用顶层 workflowVersion 和后端 productLines 包络', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { documentId: 'ISO-1' } })
    await intermediaryWorkflowApi.create({
      businessDate: '2026-07-25',
      currency: 'CNY',
      customer: reference('customer', 'C001'),
      salesperson: null,
      remark: 'E2E',
      productLines: [
        {
          key: '1',
          product: {
            ...reference('product', 'P001'),
            containerType: 'SOLVENT',
            quantityPerContainer: '180',
          },
          orderedQuantity: '360',
          unitPrice: '10.00',
          containerType: 'SOLVENT',
          quantityPerContainer: '180',
          remark: '',
        },
      ],
    })

    expect(mockedApi.post).toHaveBeenCalledWith(
      'vou/intermediary-sale-order/create',
      {
        workflowVersion: 2,
        data: {
          businessDate: '2026-07-25',
          currency: 'CNY',
          remark: 'E2E',
          customer: {
            objectId: 'customer-1',
            versionId: 'customer-v1',
          },
          productLines: [
            {
              product: expect.objectContaining({
                objectId: 'product-1',
                versionId: 'product-v1',
              }),
              orderedQuantity: '360',
              unitPrice: '10.00',
              containerType: 'SOLVENT',
              quantityPerContainer: '180',
              remark: '',
            },
          ],
        },
      },
      { signal: undefined },
    )
  })

  it('子单动作保留根和子 revision', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { documentId: 'ISO-1' } })
    await intermediaryWorkflowApi.mutate('deliveryExecute', {
      documentId: 'ISO-1',
      rootRevision: 7,
      childId: 'D-1',
      childRevision: 2,
    })
    expect(mockedApi.post).toHaveBeenCalledWith(
      'vou/intermediary-sale-order/delivery-execute',
      {
        documentId: 'ISO-1',
        rootRevision: 7,
        childId: 'D-1',
        childRevision: 2,
      },
      { signal: undefined },
    )
  })

  it('阶段附件携带双 revision 和 childId', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    await intermediaryWorkflowApi.initiateChildAttachment('receipt', {
      documentId: 'ISO-1',
      rootRevision: 5,
      childId: 'R-1',
      childRevision: 3,
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      size: 10,
      sha256: 'a'.repeat(64),
    })
    expect(mockedApi.post).toHaveBeenCalledWith(
      'vou/intermediary-sale-order/receipt-attachment-initiate',
      expect.objectContaining({
        documentId: 'ISO-1',
        rootRevision: 5,
        childId: 'R-1',
        childRevision: 3,
      }),
      { signal: undefined },
    )
  })

  it('损耗和桶数计算符合后端规则', () => {
    expect(calculateLoss('10', '7.5', '1.25')).toBe('1.25')
    expect(calculateLoss('10', '9', '2')).toBeNull()
    expect(
      calculateExpectedContainers([
        {
          quantity: '361',
          containerType: 'SOLVENT',
          quantityPerContainer: '180',
        },
        {
          quantity: '221',
          containerType: 'RESIN',
          quantityPerContainer: '220',
        },
      ]),
    ).toEqual({ solvent: 3, resin: 2 })
    expect(
      calculateContainerBalanceAfter(
        { solvent: 2, resin: 0 },
        { solvent: 3, resin: 1 },
        { solvent: 7, resin: 1 },
      ),
    ).toEqual({ solvent: -2, resin: 0 })
  })

  it('详情把 data、children 和容器数组映射到工作区', async () => {
    const session = useSessionStore()
    session.permissions = ['/vou/intermediary-sale-order/get']
    mockedApi.post.mockResolvedValueOnce({
      data: {
        documentId: 'ISO-1',
        documentNo: 'ISO-20260725-000001',
        status: 'APPROVED',
        revision: 4,
        rootRevision: 4,
        amount: '3600.00',
        workflowVersion: 2,
        data: {
          businessDate: '2026-07-25',
          currency: 'CNY',
          customer: reference('customer', 'C001'),
          salesperson: reference('employee', 'E001'),
          productLines: [],
        },
        balances: {
          lines: [],
          containers: [
            { containerType: 'SOLVENT', quantity: 3 },
            { containerType: 'RESIN', quantity: -1 },
          ],
          hasUnfinishedChildren: false,
        },
        children: [
          {
            childId: 'R-1',
            childNo: 'ISO-20260725-000001-R001',
            stage: 'RECEIPT',
            status: 'CONFIRMED',
            revision: 3,
            createdAt: '2026-07-25T00:00:00Z',
            createdBy: 'U1',
            updatedAt: '2026-07-25T00:00:00Z',
            updatedBy: 'U2',
          },
        ],
        attachments: [],
        updatedAt: '2026-07-25T00:00:00Z',
      },
    })
    const vm = useIntermediaryWorkflowViewModel()
    await vm.loadDocument('ISO-1')

    expect(vm.document.value?.workflowStatus).toBe('APPROVED')
    expect(vm.receipts.value).toHaveLength(1)
    expect(vm.rootContainerBalance.value).toEqual({ solvent: 3, resin: -1 })
  })

  it('最终动作入口拦截同一核对人', async () => {
    const session = useSessionStore()
    session.user = { id: 'USER-1', username: 'operator', displayName: '操作员' }
    session.permissions = [
      '/vou/intermediary-sale-order/approve',
      '/vou/intermediary-sale-order/delivery-execute',
    ]
    const vm = useIntermediaryWorkflowViewModel()
    vm.document.value = {
      workflowStatus: 'CHECKED',
      checkedBy: 'USER-1',
    } as IntermediaryWorkflowDocument
    const child = {
      childId: 'D-1',
      checkedBy: 'USER-1',
    } as IntermediaryChildSummary

    await expect(vm.runRootAction('approve')).resolves.toBe(false)
    await expect(vm.runChildAction('deliveryExecute', child)).resolves.toBe(false)
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('查询只发送后端支持的非空筛选条件', async () => {
    const session = useSessionStore()
    session.permissions = ['/vou/intermediary-sale-order/query']
    mockedApi.post.mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const vm = useIntermediaryWorkflowViewModel()
    vm.filters.keyword = ' ISO-1 '
    vm.filters.dateFrom = '2026-07-01'

    await vm.query()

    expect(mockedApi.post).toHaveBeenCalledWith(
      'vou/intermediary-sale-order/query',
      expect.objectContaining({
        filters: {
          keyword: 'ISO-1',
          dateFrom: '2026-07-01',
        },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    const request = mockedApi.post.mock.calls[0]?.[1] as {
      filters: Record<string, unknown>
    }
    expect(request.filters).not.toHaveProperty('workflowVersion')
    expect(request.filters).not.toHaveProperty('pendingStage')
    expect(request.filters).not.toHaveProperty('workflowStatus')
  })
})
