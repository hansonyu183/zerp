import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/types'
import { apiClient } from '@/api/client'
import {
  calculateContainerBalanceAfter,
  calculateExpectedContainers,
  calculateLoss,
} from '@/pages/wfl/intermediary-trade/calculations'
import {
  intermediaryActionPath,
  intermediaryActions,
  intermediaryWorkflowApi,
} from '@/pages/wfl/intermediary-trade/api'
import {
  intermediaryTradeDefinition,
  stageDefinition,
} from '@/pages/wfl/intermediary-trade/definition'
import { useIntermediaryWorkflowViewModel } from '@/pages/wfl/intermediary-trade/vm'
import type {
  IntermediaryChildSummary,
  IntermediaryWorkflowDocument,
} from '@/pages/wfl/intermediary-trade/types'
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

const mutationResult = {
  processId: 'PROCESS-1',
  processRevision: 2,
  workflowStatus: 'DRAFT',
  documentId: 'DOCUMENT-1',
  documentNo: 'WFL-1',
  documentRevision: 1,
  documentStatus: 'DRAFT',
}

function processView(options: { procurementVisible?: boolean } = {}) {
  return {
    processId: 'PROCESS-1',
    processType: 'INTERMEDIARY_TRADE',
    definitionVersion: 1,
    status: 'APPROVED',
    revision: 7,
    rootDocumentId: 'CUSTOMER-ORDER-1',
    rootDocumentNo: 'CO-1',
    currentStage: 'RECEIPT',
    documents: [
      {
        documentId: 'CUSTOMER-ORDER-1',
        documentNo: 'CO-1',
        entity: 'customer-order',
        stage: 'CUSTOMER_ORDER',
        status: 'APPROVED',
        revision: 4,
        businessDate: '2026-07-25',
        amount: '3600.00',
        createdAt: '2026-07-25T00:00:00Z',
        createdBy: 'USER-1',
        reviewedAt: '2026-07-25T01:00:00Z',
        reviewedBy: 'USER-2',
        approvedAt: '2026-07-25T02:00:00Z',
        approvedBy: 'USER-1',
        data: {
          customer: reference('customer', 'C001'),
          salesperson: reference('employee', 'E001'),
        },
        lines: [
          {
            lineId: 'CUSTOMER-LINE-1',
            lineNo: 1,
            product: reference('product', 'P001'),
            orderedQuantity: '360',
            unitPrice: '10.00',
            lineAmount: '3600.00',
            containerType: 'SOLVENT',
            quantityPerContainer: '180',
          },
        ],
        attachments: [],
      },
      {
        documentId: 'PROCUREMENT-1',
        documentNo: 'PO-1',
        entity: 'procurement-order',
        stage: 'PROCUREMENT',
        status: 'ORDERED',
        revision: 3,
        parentDocumentId: 'CUSTOMER-ORDER-1',
        businessDate: '2026-07-25',
        amount: '3200.00',
        createdAt: '2026-07-25T03:00:00Z',
        createdBy: 'USER-1',
        ...(options.procurementVisible
          ? {
              data: {
                supplier: reference('supplier', 'S001'),
                purchaser: reference('employee', 'E002'),
              },
              lines: [
                {
                  lineId: 'PROCUREMENT-LINE-1',
                  sourceLineId: 'CUSTOMER-LINE-1',
                  quantity: '360',
                  unitPrice: '8.00',
                  lineAmount: '2880.00',
                },
              ],
            }
          : {}),
        attachments: [],
      },
      {
        documentId: 'RECEIPT-1',
        documentNo: 'GR-1',
        entity: 'goods-receipt',
        stage: 'RECEIPT',
        status: 'CONFIRMED',
        revision: 3,
        parentDocumentId: 'PROCUREMENT-1',
        businessDate: '2026-07-25',
        amount: '0.00',
        createdAt: '2026-07-25T04:00:00Z',
        createdBy: 'USER-1',
        data: {},
        lines: [
          {
            lineId: 'RECEIPT-LINE-1',
            sourceLineId: 'PROCUREMENT-LINE-1',
            quantity: '10',
          },
        ],
        attachments: [],
      },
      {
        documentId: 'DELIVERY-1',
        documentNo: 'DN-1',
        entity: 'delivery-note',
        stage: 'DELIVERY',
        status: 'EXECUTED',
        revision: 3,
        parentDocumentId: 'CUSTOMER-ORDER-1',
        businessDate: '2026-07-25',
        amount: '0.00',
        createdAt: '2026-07-25T05:00:00Z',
        createdBy: 'USER-1',
        data: {},
        lines: [
          {
            lineId: 'DELIVERY-LINE-1',
            sourceLineId: 'CUSTOMER-LINE-1',
            quantity: '10',
          },
        ],
        attachments: [],
      },
      {
        documentId: 'SIGNOFF-1',
        documentNo: 'SN-1',
        entity: 'signoff-note',
        stage: 'SIGNOFF',
        status: 'CONFIRMED',
        revision: 3,
        parentDocumentId: 'DELIVERY-1',
        businessDate: '2026-07-25',
        amount: '0.00',
        createdAt: '2026-07-25T06:00:00Z',
        createdBy: 'USER-1',
        data: {
          returnedSolventContainers: 1,
          returnedResinContainers: 0,
        },
        lines: [
          {
            lineId: 'SIGNOFF-LINE-1',
            sourceLineId: 'DELIVERY-LINE-1',
            signedQuantity: '9',
            rejectedQuantity: '1',
            lossQuantity: '0',
          },
        ],
        attachments: [],
      },
    ],
    balances: {
      lines: [
        {
          customerLineId: 'CUSTOMER-LINE-1',
          orderedQuantity: '360',
          ...(options.procurementVisible
            ? { procurementQuantity: '360' }
            : {}),
          receivedQuantity: '0',
          deliveredQuantity: '0',
          signedQuantity: '0',
          rejectedQuantity: '0',
          lossQuantity: '0',
          availableToDeliverQuantity: '0',
          remainingToSignQuantity: '360',
        },
      ],
      solventContainers: 2,
      resinContainers: -1,
      hasUnfinishedDocuments: false,
    },
    createdAt: '2026-07-25T00:00:00Z',
    createdBy: 'USER-1',
    updatedAt: '2026-07-25T03:00:00Z',
    updatedBy: 'USER-2',
  }
}

describe('WFL 居间贸易 PR #12 契约', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('集中声明全部 kebab-case 动作且路径位于独立 WFL 领域', () => {
    expect(intermediaryActions).toEqual([
      'query', 'get', 'create', 'save', 'check', 'uncheck', 'approve',
      'unapprove', 'audit-history', 'short-close-request',
      'short-close-cancel', 'short-close-confirm', 'short-close-unconfirm',
      'procurement-create', 'procurement-get', 'procurement-save',
      'procurement-delete', 'procurement-check', 'procurement-uncheck',
      'procurement-place', 'procurement-unplace', 'receipt-create',
      'receipt-get', 'receipt-save', 'receipt-delete', 'receipt-check',
      'receipt-uncheck', 'receipt-confirm', 'receipt-unconfirm',
      'delivery-create', 'delivery-get', 'delivery-save', 'delivery-delete',
      'delivery-check', 'delivery-uncheck', 'delivery-execute',
      'delivery-unexecute', 'signoff-create', 'signoff-get', 'signoff-save',
      'signoff-delete', 'signoff-check', 'signoff-uncheck',
      'signoff-confirm', 'signoff-unconfirm',
      'procurement-attachment-initiate',
      'procurement-attachment-download',
      'procurement-attachment-remove',
      'receipt-attachment-initiate', 'receipt-attachment-download',
      'receipt-attachment-remove', 'delivery-attachment-initiate',
      'delivery-attachment-download', 'delivery-attachment-remove',
      'signoff-attachment-initiate', 'signoff-attachment-download',
      'signoff-attachment-remove',
    ])
    expect(intermediaryActions.every((action) => !/[A-Z]/.test(action))).toBe(true)
    expect(new Set(intermediaryActions).size).toBe(intermediaryActions.length)
    expect(intermediaryActionPath('procurement-delete')).toBe(
      'wfl/intermediary-trade/procurement-delete',
    )
  })

  it('五阶段定义使用独立 VOU 实体、重复规则和语义终态', () => {
    expect(intermediaryTradeDefinition.stages.map((item) => item.entity)).toEqual([
      'customer-order',
      'procurement-order',
      'goods-receipt',
      'delivery-note',
      'signoff-note',
    ])
    expect(stageDefinition('PROCUREMENT')).toMatchObject({
      repeatable: false,
      semanticFinalStatus: 'ORDERED',
      finalAction: 'procurement-place',
    })
    expect(stageDefinition('RECEIPT').repeatable).toBe(true)
    expect(stageDefinition('DELIVERY').semanticFinalStatus).toBe('EXECUTED')
    expect(stageDefinition('SIGNOFF').semanticFinalStatus).toBe('CONFIRMED')
  })

  it('创建客户订单使用 data.lines 且不发送旧版本字段', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: mutationResult })

    await intermediaryWorkflowApi.create({
      businessDate: '2026-07-25',
      currency: 'CNY',
      customer: reference('customer', 'C001'),
      salesperson: null,
      remark: 'PR12',
      productLines: [
        {
          key: 'line-1',
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

    const body = mockedApi.post.mock.calls[0]?.[1] as Record<string, unknown>
    expect(mockedApi.post).toHaveBeenCalledWith(
      'wfl/intermediary-trade/create',
      expect.objectContaining({
        data: expect.objectContaining({
          businessDate: '2026-07-25',
          currency: 'CNY',
          lines: [
            expect.objectContaining({
              orderedQuantity: '360',
              unitPrice: '10.00',
            }),
          ],
        }),
      }),
      { signal: undefined },
    )
    expect(body).not.toHaveProperty('workflowVersion')
    expect(body.data).not.toHaveProperty('productLines')
  })

  it('保存与生命周期动作分别携带 process/document ID 和 revision', async () => {
    mockedApi.post
      .mockResolvedValueOnce({ data: mutationResult })
      .mockResolvedValueOnce({ data: mutationResult })

    await intermediaryWorkflowApi.save({
      processId: 'PROCESS-1',
      processRevision: 7,
      documentId: 'CUSTOMER-ORDER-1',
      documentRevision: 4,
      data: {
        businessDate: '2026-07-25',
        currency: 'CNY',
        customer: reference('customer', 'C001'),
        salesperson: null,
        remark: '',
        productLines: [],
      },
    })
    await intermediaryWorkflowApi.mutate('delivery-unexecute', {
      processId: 'PROCESS-1',
      processRevision: 8,
      documentId: 'PROCESS-1',
      rootRevision: 8,
      childId: 'DELIVERY-1',
      childRevision: 3,
      reason: '车辆信息需更正',
    })

    expect(mockedApi.post).toHaveBeenNthCalledWith(
      1,
      'wfl/intermediary-trade/save',
      expect.objectContaining({
        processId: 'PROCESS-1',
        processRevision: 7,
        documentId: 'CUSTOMER-ORDER-1',
        documentRevision: 4,
      }),
      { signal: undefined },
    )
    expect(mockedApi.post).toHaveBeenNthCalledWith(
      2,
      'wfl/intermediary-trade/delivery-unexecute',
      {
        processId: 'PROCESS-1',
        processRevision: 8,
        documentId: 'DELIVERY-1',
        documentRevision: 3,
        reason: '车辆信息需更正',
      },
      { signal: undefined },
    )
  })

  it('查询只发送 PR #12 支持的字段', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { items: [], total: 0, page: 2, pageSize: 20 },
    })

    await intermediaryWorkflowApi.query({
      page: 2,
      pageSize: 20,
      filters: {
        keyword: 'CO-1',
        statuses: ['APPROVED'],
        dateFrom: '2026-07-01',
        customerObjectId: 'CUSTOMER-1',
        supplierObjectId: 'SUPPLIER-1',
      },
    })

    expect(mockedApi.post).toHaveBeenCalledWith(
      'wfl/intermediary-trade/query',
      {
        page: 2,
        pageSize: 20,
        keyword: 'CO-1',
        statuses: ['APPROVED'],
      },
      { signal: undefined },
    )
  })

  it('收货和签收先读取来源阶段并发送真实 sourceLineId', async () => {
    mockedApi.post
      .mockResolvedValueOnce({ data: processView({ procurementVisible: true }) })
      .mockResolvedValueOnce({
        data: processView({ procurementVisible: true }).documents[1],
      })
      .mockResolvedValueOnce({ data: mutationResult })
      .mockResolvedValueOnce({
        data: {
          documentId: 'DELIVERY-1',
          documentNo: 'DN-1',
          entity: 'delivery-note',
          stage: 'DELIVERY',
          status: 'EXECUTED',
          revision: 3,
          parentDocumentId: 'CUSTOMER-ORDER-1',
          businessDate: '2026-07-25',
          amount: '0.00',
          createdAt: '2026-07-25T00:00:00Z',
          createdBy: 'USER-1',
          data: {},
          lines: [
            {
              lineId: 'DELIVERY-LINE-1',
              sourceLineId: 'CUSTOMER-LINE-1',
              quantity: '10',
            },
          ],
          attachments: [],
        },
      })
      .mockResolvedValueOnce({ data: mutationResult })

    await intermediaryWorkflowApi.saveReceipt('receipt-create', {
      processId: 'PROCESS-1',
      processRevision: 7,
      documentId: 'PROCESS-1',
      rootRevision: 7,
      data: {
        receiptDate: '2026-07-25',
        lines: [
          { rootLineId: 'CUSTOMER-LINE-1', quantity: '10', remark: '' },
        ],
        remark: '',
      },
    })
    await intermediaryWorkflowApi.saveSignoff('signoff-create', {
      processId: 'PROCESS-1',
      processRevision: 8,
      documentId: 'PROCESS-1',
      rootRevision: 8,
      data: {
        deliveryChildId: 'DELIVERY-1',
        signoffDate: '2026-07-25',
        lines: [
          {
            rootLineId: 'CUSTOMER-LINE-1',
            signedQuantity: '9',
            rejectedQuantity: '1',
            remark: '',
          },
        ],
        returnedSolventContainers: 1,
        returnedResinContainers: 0,
        containerDifferenceReason: '',
        remark: '',
      },
    })

    expect(mockedApi.post).toHaveBeenNthCalledWith(
      2,
      'wfl/intermediary-trade/procurement-get',
      { processId: 'PROCESS-1', documentId: 'PROCUREMENT-1' },
      { signal: undefined },
    )
    expect(mockedApi.post).toHaveBeenNthCalledWith(
      3,
      'wfl/intermediary-trade/receipt-create',
      expect.objectContaining({
        data: expect.objectContaining({
          lines: [
            expect.objectContaining({ sourceLineId: 'PROCUREMENT-LINE-1' }),
          ],
        }),
      }),
      { signal: undefined },
    )
    expect(mockedApi.post).toHaveBeenNthCalledWith(
      4,
      'wfl/intermediary-trade/delivery-get',
      { processId: 'PROCESS-1', documentId: 'DELIVERY-1' },
      { signal: undefined },
    )
    const signoffBody = mockedApi.post.mock.calls[4]?.[1] as {
      data: Record<string, unknown>
    }
    expect(signoffBody.data).toMatchObject({
      lines: [expect.objectContaining({ sourceLineId: 'DELIVERY-LINE-1' })],
    })
    expect(signoffBody.data).not.toHaveProperty('deliveryChildId')
  })

  it('阶段附件发起与删除都携带双 revision', async () => {
    mockedApi.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} })

    const common = {
      processId: 'PROCESS-1',
      processRevision: 5,
      documentId: 'RECEIPT-1',
      documentRevision: 3,
    }
    await intermediaryWorkflowApi.initiateChildAttachment('receipt', {
      ...common,
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      size: 10,
      sha256: 'a'.repeat(64),
    })
    await intermediaryWorkflowApi.removeChildAttachment('receipt', {
      ...common,
      fileId: 'FILE-1',
    })

    expect(mockedApi.post).toHaveBeenNthCalledWith(
      1,
      'wfl/intermediary-trade/receipt-attachment-initiate',
      expect.objectContaining(common),
      { signal: undefined },
    )
    expect(mockedApi.post).toHaveBeenNthCalledWith(
      2,
      'wfl/intermediary-trade/receipt-attachment-remove',
      expect.objectContaining(common),
      { signal: undefined },
    )
  })

  it('采购脱敏不会把省略的详情和 procurementQuantity 解释为零', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: processView() })

    const { data } = await intermediaryWorkflowApi.get('PROCESS-1')

    expect(data.children?.map((item) => item.entity)).toEqual([
      'procurement-order',
      'goods-receipt',
      'delivery-note',
      'signoff-note',
    ])
    expect(data.balances?.lines[0]).not.toHaveProperty('procurementQuantity')
    expect(data.data.currency).toBe('')
  })

  it('双人控制拦截同一核对人，后端冲突保留 requestId 并提示刷新', async () => {
    const session = useSessionStore()
    session.user = { id: 'USER-1', username: 'operator', displayName: '操作员' }
    session.permissions = [
      '/wfl/intermediary-trade/approve',
      '/wfl/intermediary-trade/delivery-execute',
    ]
    const vm = useIntermediaryWorkflowViewModel()
    vm.document.value = {
      processId: 'PROCESS-1',
      workflowStatus: 'CHECKED',
      checkedBy: 'USER-1',
    } as IntermediaryWorkflowDocument
    const child = {
      childId: 'DELIVERY-1',
      checkedBy: 'USER-1',
    } as IntermediaryChildSummary

    await expect(vm.runRootAction('approve')).resolves.toBe(false)
    await expect(vm.runChildAction('delivery-execute', child)).resolves.toBe(false)
    expect(mockedApi.post).not.toHaveBeenCalled()

    vm.document.value = {
      processId: 'PROCESS-1',
      rootDocumentId: 'CUSTOMER-ORDER-1',
      rootRevision: 7,
      documentRevision: 4,
      workflowStatus: 'CHECKED',
      checkedBy: 'USER-2',
    } as IntermediaryWorkflowDocument
    mockedApi.post.mockRejectedValueOnce(
      new ApiError('business', 'revision conflict', {
        code: 3001,
        requestId: 'REQ-1',
      }),
    )
    await expect(vm.runRootAction('approve')).resolves.toBe(false)
    expect(vm.workspaceError.value).toBe(
      'revision conflict（请求编号：REQ-1） 请重新加载流程后重试。',
    )
  })

  it('后端未返回阶段备注时将已保存草稿设为只读', () => {
    const vm = useIntermediaryWorkflowViewModel()
    vm.stageChild.value = {
      childId: 'RECEIPT-1',
      status: 'DRAFT',
    } as IntermediaryChildSummary
    vm.stageDetail.value = {
      data: { receiptDate: '2026-07-25' },
    } as never

    expect(vm.stageBodyRoundTripSafe.value).toBe(false)
    expect(vm.stageEditable.value).toBe(false)

    vm.stageDetail.value = {
      data: { receiptDate: '2026-07-25', remark: '' },
    } as never
    expect(vm.stageBodyRoundTripSafe.value).toBe(true)
    expect(vm.stageEditable.value).toBe(true)
  })

  it('反向和删除原因统一限制为 1–1000 字', async () => {
    const session = useSessionStore()
    session.permissions = ['/wfl/intermediary-trade/delivery-delete']
    const vm = useIntermediaryWorkflowViewModel()
    vm.document.value = {
      processId: 'PROCESS-1',
      rootRevision: 7,
    } as IntermediaryWorkflowDocument
    vm.openReverse('delivery-delete', {
      childId: 'DELIVERY-1',
      revision: 3,
    } as IntermediaryChildSummary)

    vm.reverseReason.value = ''
    await vm.confirmReverse()
    expect(vm.workspaceError.value).toBe('原因必须为 1–1000 字。')
    expect(mockedApi.post).not.toHaveBeenCalled()

    vm.reverseReason.value = 'a'.repeat(1001)
    await vm.confirmReverse()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('损耗、应收桶和桶余额计算保持在业务适配层', () => {
    expect(calculateLoss('10', '7.5', '1.25')).toBe('1.25')
    expect(calculateLoss('10', '9', '2')).toBeNull()
    expect(calculateExpectedContainers([
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
    ])).toEqual({ solvent: 3, resin: 2 })
    expect(calculateContainerBalanceAfter(
      { solvent: 2, resin: 0 },
      { solvent: 3, resin: 1 },
      { solvent: 7, resin: 1 },
    )).toEqual({ solvent: -2, resin: 0 })
  })
})
