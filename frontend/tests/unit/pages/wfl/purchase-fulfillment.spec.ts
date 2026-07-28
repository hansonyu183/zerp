import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PurchaseFulfillment from '@/pages/wfl/purchase-fulfillment/PurchaseFulfillment.vue'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  uploadAttachment: vi.fn(),
  fetchAttachment: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  apiClient: mocks,
}))

const reference = {
  objectId: 'object-1',
  versionId: 'version-1',
  entity: 'warehouse',
  code: 'WH01',
  name: '主仓',
}

const order = {
  documentId: '01ORDER000000000000000000',
  documentNo: 'PO-20260728-000001',
  stage: 'PURCHASE_ORDER',
  status: 'APPROVED',
  revision: 3,
  amount: '120.00',
  attachments: [],
  data: {
    businessDate: '2026-07-28',
    currency: 'CNY',
    supplier: { ...reference, entity: 'supplier', name: '供应商' },
    purchaser: { ...reference, entity: 'employee', name: '采购员' },
    warehouse: reference,
    productLines: [{
      lineId: '01LINE0000000000000000000',
      lineNo: 1,
      product: { ...reference, entity: 'product', code: 'P01', name: '产品' },
      orderedQuantity: '10',
      availableQuantity: '6',
      unitPrice: '12.00',
      lineAmount: '120.00',
    }],
  },
}

const process = {
  processId: order.documentId,
  rootDocumentNo: order.documentNo,
  status: 'APPROVED',
  revision: 4,
  currentStage: 'PURCHASE_INBOUND',
  documents: [order],
  updatedAt: '2026-07-28T00:00:00Z',
}

interface PurchaseExposed {
  action(action: string, document: typeof order): Promise<void>
  openOrderEditor(document: typeof order): void
  openProcess(processId: string): Promise<void>
  prepareInbound(): void
  rootDocument(): typeof order | undefined
  searchReference(entity: string, search: string): Promise<void>
}

function pageData(items: unknown[]) {
  return { data: { items, total: items.length, page: 1, pageSize: 20 } }
}

describe('采购履约页面', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.post.mockResolvedValue(pageData([]))
  })

  it('查询、打开流程并加载审计', async () => {
    mocks.post
      .mockResolvedValueOnce(pageData([process]))
      .mockResolvedValueOnce({ data: process })
      .mockResolvedValueOnce(pageData([]))
    const wrapper = shallowMount(PurchaseFulfillment)
    await flushPromises()
    const vm = wrapper.vm as unknown as PurchaseExposed

    await vm.openProcess(process.processId)
    expect(mocks.post).toHaveBeenCalledWith(
      'wfl/purchase-fulfillment/get',
      { processId: process.processId },
    )
    expect(vm.rootDocument()).toMatchObject({
      documentNo: order.documentNo,
    })
  })

  it('准备分批入库并执行订单与入库动作', async () => {
    mocks.post
      .mockResolvedValueOnce(pageData([]))
      .mockResolvedValueOnce({ data: process })
      .mockResolvedValueOnce(pageData([]))
      .mockResolvedValue({ data: process })
    const wrapper = shallowMount(PurchaseFulfillment)
    await flushPromises()
    const vm = wrapper.vm as unknown as PurchaseExposed
    await vm.openProcess(process.processId)

    vm.prepareInbound()
    await vm.action('approve', order)
    expect(mocks.post).toHaveBeenCalledWith(
      'wfl/purchase-fulfillment/approve',
      expect.objectContaining({
        processId: process.processId,
        documentId: order.documentId,
      }),
    )
  })

  it('加载订单草稿编辑器并搜索基础资料', async () => {
    mocks.post
      .mockResolvedValueOnce(pageData([]))
      .mockResolvedValueOnce(pageData([{
        objectId: 'object-1',
        entity: 'warehouse',
        code: 'WH01',
        currentVersion: {
          versionId: 'version-1',
          summary: { name: '主仓' },
        },
      }]))
    const wrapper = shallowMount(PurchaseFulfillment)
    await flushPromises()
    const vm = wrapper.vm as unknown as PurchaseExposed

    vm.openOrderEditor(order)
    await vm.searchReference('warehouse', '主仓')
    expect(mocks.post).toHaveBeenCalledWith(
      'bob/warehouse/query',
      expect.objectContaining({ page: 1, pageSize: 30 }),
    )
  })
})
