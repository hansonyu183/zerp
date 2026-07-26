import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { defineComponent, h, type Component } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/types'
import { apiClient } from '@/api/client'
import IntermediaryTrade from '@/pages/wfl/intermediary-trade/IntermediaryTrade.vue'
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

const passthroughStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
    },
  })

const VBtnStub = defineComponent({
  name: 'VBtn',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
  },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          onClick: () => emit('click'),
        },
        slots.default?.(),
      )
  },
})

const VTextFieldStub = defineComponent({
  name: 'VTextField',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
  },
  setup(props, { attrs }) {
    return () =>
      h('input', {
        ...attrs,
        'aria-label': attrs.label,
        disabled: props.disabled,
      })
  },
})

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
        currency: 'CNY',
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
          remark: '客户订单备注',
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
        currency: 'CNY',
        amount: '3200.00',
        createdAt: '2026-07-25T03:00:00Z',
        createdBy: 'USER-1',
        ...(options.procurementVisible
          ? {
              data: {
                supplier: reference('supplier', 'S001'),
                purchaser: reference('employee', 'E002'),
                remark: '采购备注',
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
        currency: 'CNY',
        amount: '0.00',
        createdAt: '2026-07-25T04:00:00Z',
        createdBy: 'USER-1',
        data: { remark: '收货备注' },
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
        currency: 'CNY',
        amount: '0.00',
        createdAt: '2026-07-25T05:00:00Z',
        createdBy: 'USER-1',
        data: { remark: '送货备注' },
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
        currency: 'CNY',
        amount: '0.00',
        createdAt: '2026-07-25T06:00:00Z',
        createdBy: 'USER-1',
        data: {
          returnedSolventContainers: 1,
          returnedResinContainers: 0,
          remark: '签收备注',
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

function draftReceiptProcessView(processId = 'PROCESS-1') {
  const value = structuredClone(processView({ procurementVisible: true }))
  value.processId = processId
  const receipt = value.documents.find((item) => item.stage === 'RECEIPT')
  if (receipt) receipt.status = 'DRAFT'
  return value
}

describe('WFL 居间贸易后端契约', () => {
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
      remark: '客户订单备注',
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

  it('查询只发送后端支持的字段', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        items: [processView()],
        total: 1,
        page: 2,
        pageSize: 20,
      },
    })

    const result = await intermediaryWorkflowApi.query({
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
    expect(result.data.items[0]).toMatchObject({
      documentNo: 'CO-1',
      currency: 'CNY',
      amount: '3600.00',
    })
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
          currency: 'CNY',
          amount: '0.00',
          createdAt: '2026-07-25T00:00:00Z',
          createdBy: 'USER-1',
          data: { remark: '' },
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
    expect(data.data.currency).toBe('CNY')
    expect(data.data.remark).toBe('客户订单备注')
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

  it('已保存的阶段草稿按状态决定是否可编辑', () => {
    const vm = useIntermediaryWorkflowViewModel()
    vm.stageChild.value = {
      childId: 'RECEIPT-1',
      status: 'DRAFT',
    } as IntermediaryChildSummary
    expect(vm.stageEditable.value).toBe(true)

    vm.stageChild.value.status = 'CHECKED'
    expect(vm.stageEditable.value).toBe(false)
  })

  it('附件刷新保留未保存子单草稿和 dirty 状态', async () => {
    const session = useSessionStore()
    session.permissions = [
      '/wfl/intermediary-trade/receipt-get',
      '/wfl/intermediary-trade/receipt-attachment-remove',
    ]
    mockedApi.post.mockImplementation((path, body) => {
      if (path === 'wfl/intermediary-trade/get') {
        const processId = (body as { processId: string }).processId
        return Promise.resolve({ data: draftReceiptProcessView(processId) })
      }
      if (path === 'wfl/intermediary-trade/receipt-get') {
        return Promise.resolve({
          data: draftReceiptProcessView().documents.find(
            (item) => item.stage === 'RECEIPT',
          ),
        })
      }
      if (path === 'wfl/intermediary-trade/receipt-attachment-remove') {
        return Promise.resolve({
          data: {
            processId: 'PROCESS-1',
            processRevision: 8,
            documentId: 'RECEIPT-1',
            documentRevision: 4,
            documentStatus: 'DRAFT',
          },
        })
      }
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })

    const vm = useIntermediaryWorkflowViewModel()
    await vm.loadDocument('PROCESS-1')
    const receipt = vm.document.value?.children.find(
      (item) => item.stage === 'RECEIPT',
    )
    expect(receipt).toBeDefined()
    await vm.openStage('RECEIPT', receipt)
    vm.stageDraft.value!.remark = '尚未保存的收货备注'
    expect(vm.workspaceDirty.value).toBe(true)

    await vm.removeChildAttachment({
      fileId: 'FILE-1',
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      size: 10,
      sha256: 'a'.repeat(64),
      status: 'READY',
      createdAt: '2026-07-25T00:00:00Z',
      createdBy: 'USER-1',
    })

    expect(vm.stageDraft.value?.remark).toBe('尚未保存的收货备注')
    expect(vm.workspaceDirty.value).toBe(true)
  })

  it('切换流程会清空审计且忽略上一流程的迟到响应', async () => {
    const session = useSessionStore()
    session.permissions = ['/wfl/intermediary-trade/audit-history']
    let resolveAuditA!: (value: {
      data: {
        items: Array<Record<string, string>>
        total: number
        page: number
        pageSize: number
      }
    }) => void
    const auditA = new Promise<{
      data: {
        items: Array<Record<string, string>>
        total: number
        page: number
        pageSize: number
      }
    }>((resolve) => {
      resolveAuditA = resolve
    })
    mockedApi.post.mockImplementation((path, body) => {
      if (path === 'wfl/intermediary-trade/get') {
        const processId = (body as { processId: string }).processId
        return Promise.resolve({ data: draftReceiptProcessView(processId) })
      }
      if (path === 'wfl/intermediary-trade/audit-history') {
        const processId = (body as { processId: string }).processId
        if (processId === 'PROCESS-A') return auditA
        return Promise.resolve({
          data: {
            items: [
              {
                id: 'AUDIT-B',
                eventType: 'PROCESS_B_EVENT',
                toStatus: 'APPROVED',
                actorId: 'USER-2',
                occurredAt: '2026-07-25T00:00:00Z',
                requestId: 'REQUEST-B',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        })
      }
      return Promise.reject(new Error(`unexpected request: ${path}`))
    })

    const vm = useIntermediaryWorkflowViewModel()
    await vm.loadDocument('PROCESS-A')
    vm.changeActiveStep(6)
    await vm.loadDocument('PROCESS-B')
    expect(vm.auditEvents.value).toEqual([])

    vm.changeActiveStep(6)
    await vi.waitFor(() => {
      expect(vm.auditEvents.value.map((item) => item.id)).toEqual(['AUDIT-B'])
    })
    resolveAuditA({
      data: {
        items: [
          {
            id: 'AUDIT-A',
            eventType: 'PROCESS_A_EVENT',
            toStatus: 'APPROVED',
            actorId: 'USER-1',
            occurredAt: '2026-07-25T00:00:00Z',
            requestId: 'REQUEST-A',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(vm.auditEvents.value.map((item) => item.id)).toEqual(['AUDIT-B'])
  })

  it('收货和签收保存同时要求来源阶段详情权限', async () => {
    const session = useSessionStore()
    const vm = useIntermediaryWorkflowViewModel()
    vm.stageChild.value = {
      childId: 'RECEIPT-1',
      status: 'DRAFT',
    } as IntermediaryChildSummary
    vm.stageEditing.value = 'RECEIPT'
    vm.stageDraft.value = {
      receiptDate: '2026-07-25',
      lines: [],
      remark: '',
    }

    session.permissions = ['/wfl/intermediary-trade/receipt-save']
    expect(vm.stageSaveVisible.value).toBe(true)
    expect(vm.stageEditable.value).toBe(false)
    expect(vm.stageSaveBlockedReason.value).toBe(
      '保存收货单需要采购详情权限。当前表单仅供查看。',
    )
    expect(vm.canSaveStage()).toBe(false)
    await expect(vm.saveStage()).resolves.toBe(false)
    expect(vm.stageDialogError.value).toBe(
      '保存收货单需要采购详情权限。当前表单仅供查看。',
    )

    session.permissions = [
      '/wfl/intermediary-trade/receipt-save',
      '/wfl/intermediary-trade/procurement-get',
    ]
    expect(vm.stageEditable.value).toBe(true)
    expect(vm.stageSaveBlockedReason.value).toBeNull()
    expect(vm.canSaveStage()).toBe(true)

    vm.stageEditing.value = 'SIGNOFF'
    vm.stageChild.value = {
      childId: 'SIGNOFF-1',
      status: 'DRAFT',
    } as IntermediaryChildSummary
    vm.stageDraft.value = {
      deliveryChildId: 'DELIVERY-1',
      signoffDate: '2026-07-25',
      lines: [],
      returnedSolventContainers: 0,
      returnedResinContainers: 0,
      containerDifferenceReason: '',
      remark: '',
    }
    session.permissions = ['/wfl/intermediary-trade/signoff-save']
    expect(vm.stageSaveVisible.value).toBe(true)
    expect(vm.stageEditable.value).toBe(false)
    expect(vm.stageSaveBlockedReason.value).toBe(
      '保存签收单需要送货详情权限。当前表单仅供查看。',
    )
    expect(vm.canSaveStage()).toBe(false)
    await expect(vm.saveStage()).resolves.toBe(false)
    expect(vm.stageDialogError.value).toBe(
      '保存签收单需要送货详情权限。当前表单仅供查看。',
    )

    session.permissions = [
      '/wfl/intermediary-trade/signoff-save',
      '/wfl/intermediary-trade/delivery-get',
    ]
    expect(vm.canSaveStage()).toBe(true)
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('缺少来源详情权限时将阶段表单设为只读并保留禁用的保存按钮', () => {
    const session = useSessionStore()
    session.permissions = [
      '/wfl/intermediary-trade/receipt-get',
      '/wfl/intermediary-trade/receipt-save',
    ]
    const vm = useIntermediaryWorkflowViewModel()
    vi.spyOn(vm, 'query').mockResolvedValue()
    vm.stageDialogOpen.value = true
    vm.stageEditing.value = 'RECEIPT'
    vm.stageChild.value = {
      childId: 'RECEIPT-1',
      childNo: 'GR-1',
      stage: 'RECEIPT',
      status: 'DRAFT',
      revision: 1,
    } as IntermediaryChildSummary
    vm.stageDraft.value = {
      receiptDate: '2026-07-25',
      lines: [],
      remark: '',
    }

    const wrapper = shallowMount(IntermediaryTrade as Component, {
      props: { model: vm },
      global: {
        stubs: {
          VAlert: passthroughStub('VAlert', 'aside'),
          VBtn: VBtnStub,
          VCard: passthroughStub('VCard', 'section'),
          VCardActions: passthroughStub('VCardActions'),
          VCardText: passthroughStub('VCardText'),
          VCardTitle: passthroughStub('VCardTitle', 'h2'),
          VContainer: passthroughStub('VContainer'),
          VDialog: passthroughStub('VDialog'),
          VFooter: passthroughStub('VFooter'),
          VSpacer: passthroughStub('VSpacer'),
          VTable: passthroughStub('VTable', 'table'),
          VTextField: VTextFieldStub,
          VTextarea: VTextFieldStub,
          VWindow: passthroughStub('VWindow'),
          VWindowItem: passthroughStub('VWindowItem'),
        },
      },
    })

    expect(wrapper.text()).toContain(
      '保存收货单需要采购详情权限。当前表单仅供查看。',
    )
    expect(
      wrapper.get('input[aria-label="收货日期"]').attributes('disabled'),
    ).toBeDefined()
    const saveButton = wrapper
      .findAll('button')
      .find((item) => item.text().includes('保存草稿'))
    expect(saveButton).toBeDefined()
    expect(saveButton?.attributes('disabled')).toBeDefined()
    expect(saveButton?.attributes('title')).toBe(
      '保存收货单需要采购详情权限。当前表单仅供查看。',
    )
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
