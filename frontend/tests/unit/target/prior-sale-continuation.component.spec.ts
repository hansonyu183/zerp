import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs } from './helpers/archive-stubs.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetVouchers: vi.fn(),
  getTargetVoucher: vi.fn(),
  queryTargetPriorSaleContinuation: vi.fn(),
  submitTargetVoucher: vi.fn(),
}))
const sourceId = '01J00000000000000000000001',
  lineId = '01J00000000000000000000002'
const continuation = {
  entity: 'sale-delivery' as const,
  sourceEntity: 'sale-outbound' as const,
  sourceDocumentId: sourceId,
  sourceDocumentNo: 'OUT-OLD',
  customerName: '合成客户',
  lines: [
    {
      sourceLineId: lineId,
      productCode: 'P1',
      productName: '合成产品',
      availableBaseQuantity: '40.000000',
    },
  ],
  payload: {
    businessDate: '2026-09-06',
    currency: 'CNY',
    attachments: [],
    parentEntity: 'sale-outbound' as const,
    parentDocumentId: sourceId,
    sourceLines: [{ sourceLineId: lineId, baseQuantity: '40.000000' }],
  },
}
const sourceRow = {
  vouType: 'sale-outbound' as const,
  documentId: sourceId,
  documentNo: 'OUT-OLD',
  revision: '2',
  handlerName: null,
  businessDate: '2026-09-04',
  submittedDate: '2026-09-04',
  counterpartyName: '合成客户',
  status: 'APPROVED' as const,
  amount: '0.00',
  currency: 'CNY',
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.user = { id: 'operator', code: 'operator', name: '制单人' }
  session.csrfToken = 'csrf'
  session.apiPaths = [
    ...['sale-outbound', 'sale-delivery'].flatMap((entity) =>
      ['query', 'get'].map((action) => `/vou/${entity}/${action}`),
    ),
    '/vou/sale-delivery/submit-new',
  ]
  vi.mocked(api.queryTargetVouchers).mockImplementation(
    async (_csrf, entity) => ({
      items: entity === 'sale-outbound' ? [sourceRow] : [],
      page: 1,
      pageSize: 20,
      total: entity === 'sale-outbound' ? 1 : 0,
    }),
  )
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    entity: 'sale-outbound',
    documentId: sourceId,
    documentNo: 'OUT-OLD',
    submissionId: sourceId,
    stableRevision: '1',
    revision: '2',
    status: 'APPROVED',
    submittedBy: 'earlier-operator',
    submittedAt: '2026-09-04T00:00:00Z',
    approvedBy: 'reviewer',
    approvedAt: '2026-09-04T00:01:00Z',
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    payload: {
      businessDate: '2026-09-04',
      currency: 'CNY',
      attachments: [],
      parentEntity: 'sale-order',
      parentDocumentId: '01J00000000000000000000003',
      sourceLines: [{ sourceLineId: lineId, baseQuantity: '100.000000' }],
    },
    availableApprovalActions: [],
    canDelete: false,
  })
  vi.mocked(api.queryTargetPriorSaleContinuation).mockResolvedValue(
    continuation,
  )
})
async function click(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  expect(button, `${text}: ${wrapper.text()}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
async function host() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/:domain/:entity',
        name: 'resource-host',
        component: ResourceHost,
        props: true,
      },
    ],
  })
  await router.push('/vou/sale-outbound')
  await router.isReady()
  const wrapper = mount(RouterView, {
    global: { plugins: [router], stubs: archiveStubs },
  })
  await flushPromises()
  return { router, wrapper }
}
it('continues a real source into an ordinary forty-unit delivery draft with a new identity', async () => {
  const { router, wrapper } = await host()
  try {
    await click(wrapper, '打开')
    await click(wrapper, '查看后续办理')
    expect(router.currentRoute.value.params.entity).toBe('sale-delivery')
    expect(router.currentRoute.value.query).toEqual({})
    expect(api.queryTargetPriorSaleContinuation).toHaveBeenCalledWith(
      'sale-outbound',
      sourceId,
      expect.any(String),
    )
    const editor = wrapper.get('[data-testid="prior-sale-continuation-draft"]')
    expect(editor.text()).toContain('OUT-OLD')
    expect(editor.text()).toContain('合成产品')
    await editor.get('[aria-label="业务日期"]').setValue('2026-09-07')
    vi.mocked(api.submitTargetVoucher).mockResolvedValue(
      {} as Awaited<ReturnType<typeof api.submitTargetVoucher>>,
    )
    await click(wrapper, '提交')
    const [csrf, entity, command] = vi.mocked(api.submitTargetVoucher).mock
      .calls[0]!
    expect(csrf).toBe('csrf')
    expect(entity).toBe('sale-delivery')
    expect(command.documentId).not.toBe(sourceId)
    expect(command.idempotencyKey).toBe(command.submissionId)
    expect(command.payload).toEqual({
      ...continuation.payload,
      businessDate: '2026-09-07',
    })
    expect('priorFact' in command.payload).toBe(false)
    expect(api.submitTargetVoucher).toHaveBeenCalledTimes(1)
  } finally {
    wrapper.unmount()
  }
})

it('keeps a lost continuation reply locked and verifies the exact new target identity', async () => {
  const { wrapper } = await host()
  try {
    await click(wrapper, '打开')
    await click(wrapper, '查看后续办理')
    vi.mocked(api.submitTargetVoucher).mockRejectedValue(
      new Error('lost response'),
    )
    await click(wrapper, '提交')
    expect(wrapper.text()).toContain('提交结果未知')
    await click(wrapper, '提交')
    expect(api.submitTargetVoucher).toHaveBeenCalledTimes(1)
    const command = vi.mocked(api.submitTargetVoucher).mock.calls[0]![2]
    vi.mocked(api.getTargetVoucher).mockResolvedValue({
      entity: 'sale-delivery',
      documentId: command.documentId,
      documentNo: 'DELIVERY-NEW',
      submissionId: command.submissionId,
      stableRevision: '1',
      revision: '1',
      status: 'PENDING',
      submittedBy: 'operator',
      submittedAt: '2026-09-07T00:00:00Z',
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      payload: continuation.payload,
      availableApprovalActions: [],
      canDelete: true,
    })
    await click(wrapper, '核实原提交')
    expect(api.getTargetVoucher).toHaveBeenLastCalledWith(
      'csrf',
      'sale-delivery',
      command.documentId,
    )
    expect(
      wrapper.find('[data-testid="prior-sale-continuation-draft"]').exists(),
    ).toBe(false)
    expect(api.submitTargetVoucher).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('已核实提交成功')
  } finally {
    wrapper.unmount()
  }
})

it('edits actual signoff and container quantities while preserving the exact source and customer', async () => {
  const customer = {
    objectId: '01J00000000000000000000004',
    approvalEntryId: '01J00000000000000000000005',
    selectionOrigin: 'HISTORICAL' as const,
  }
  const signoff = {
    ...continuation,
    entity: 'sale-signoff' as const,
    sourceEntity: 'sale-delivery' as const,
    payload: {
      businessDate: '2026-09-06',
      currency: 'CNY',
      attachments: [],
      parentEntity: 'sale-delivery' as const,
      parentDocumentId: sourceId,
      customer,
      expectedSolventContainers: 0,
      expectedResinContainers: 0,
      returnedSolventContainers: 0,
      returnedResinContainers: 0,
      signoffLines: [
        {
          sourceLineId: lineId,
          signedBaseQuantity: '40.000000',
          rejectedBaseQuantity: '0',
        },
      ],
    },
  }
  const session = useTargetSession()
  session.apiPaths.push(
    '/vou/sale-signoff/submit-new',
    '/vou/sale-signoff/get',
    '/vou/sale-signoff/query',
  )
  vi.mocked(api.queryTargetPriorSaleContinuation).mockResolvedValue(signoff)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/:domain/:entity',
        name: 'resource-host',
        component: ResourceHost,
        props: true,
      },
    ],
  })
  await router.push({
    name: 'resource-host',
    params: { domain: 'vou', entity: 'sale-signoff' },
    query: { priorSaleSource: 'sale-delivery', priorSaleDocument: sourceId },
  })
  await router.isReady()
  const wrapper = mount(RouterView, {
    global: { plugins: [router], stubs: archiveStubs },
  })
  try {
    await flushPromises()
    const editor = wrapper.get('[data-testid="prior-sale-continuation-draft"]')
    await editor.get('[aria-label="本次签收基准数量"]').setValue('30')
    await editor.get('[aria-label="本次拒收基准数量"]').setValue('10')
    await editor.get('[aria-label="本次应回溶剂桶"]').setValue('2')
    await editor.get('[aria-label="本次实回溶剂桶"]').setValue('2')
    vi.mocked(api.submitTargetVoucher).mockResolvedValue(
      {} as Awaited<ReturnType<typeof api.submitTargetVoucher>>,
    )
    await click(wrapper, '提交')
    const [, entity, command] = vi.mocked(api.submitTargetVoucher).mock
      .calls[0]!
    expect(entity).toBe('sale-signoff')
    expect(command.payload).toEqual({
      ...signoff.payload,
      expectedSolventContainers: 2,
      returnedSolventContainers: 2,
      signoffLines: [
        {
          sourceLineId: lineId,
          signedBaseQuantity: '30',
          rejectedBaseQuantity: '10',
        },
      ],
    })
    expect(command.documentId).not.toBe(sourceId)
    expect('priorFact' in command.payload).toBe(false)
  } finally {
    wrapper.unmount()
  }
})
