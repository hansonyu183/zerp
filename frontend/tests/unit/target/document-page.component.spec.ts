import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs as stubs } from './helpers/archive-stubs.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetVouchers: vi.fn(),
  queryTargetVouReferences: vi.fn(),
  getTargetProduct: vi.fn(),
  queryTargetBobReferences: vi.fn(),
  getTargetCustomer: vi.fn(),
  getTargetSupplier: vi.fn(),
  getTargetVoucher: vi.fn(),
  queryTargetOpenings: vi.fn(),
  queryTargetAccountingBooks: vi.fn(),
  queryTargetAccountingSubjects: vi.fn(),
  submitTargetOpening: vi.fn(),
  submitTargetOrder: vi.fn(),
}))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.user = { id: 'maintainer', code: 'maintainer', name: '制单人' }
  session.csrfToken = 'test-csrf'
})
async function click(wrapper: VueWrapper, caption: string) {
  if (caption === '查询') {
    await wrapper.get('form.dynamic-form').trigger('submit')
    await flushPromises()
    return
  }
  const button = wrapper
    .findAll('button')
    .find((item) => item.text() === caption)
  expect(button, `button ${caption}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
it.each(['sale-order', 'purchase-order'])(
  'opens and cancels %s Draft through its resource without query permission',
  async (entity) => {
    useTargetSession().apiPaths = [`/vou/${entity}/submit-new`]
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    expect(wrapper.find('[aria-label="业务日期"]').exists()).toBe(true)
    await click(wrapper, '取消')
    expect(wrapper.find('[aria-label="业务日期"]').exists()).toBe(false)
    expect(api.queryTargetVouchers).not.toHaveBeenCalled()
    expect(api.queryTargetVouReferences).not.toHaveBeenCalled()
    wrapper.unmount()
  },
)
it('submits a purchase order from selected candidates and confirmed quantities, then refreshes once', async () => {
  useTargetSession().apiPaths = [
    '/vou/purchase-order/submit-new',
    '/vou/reference/query',
    '/bob/product/get',
    '/vou/purchase-order/query',
  ]
  vi.mocked(api.queryTargetVouchers).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.queryTargetVouReferences).mockImplementation(
    async (_token, input) =>
      ({
        items: [
          {
            entity: input.entity,
            objectId: input.entity === 'product' ? productId : referenceId,
            code: '01',
            name: input.entity === 'product' ? '包装桶' : '候选资料',
            approvalEntryId: entryId,
          },
        ],
      }) as Awaited<ReturnType<typeof api.queryTargetVouReferences>>,
  )
  vi.mocked(api.getTargetProduct).mockResolvedValue(
    productCurrent as Awaited<ReturnType<typeof api.getTargetProduct>>,
  )
  vi.mocked(api.submitTargetOrder).mockResolvedValue({
    documentId: referenceId,
  } as Awaited<ReturnType<typeof api.submitTargetOrder>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'purchase-order' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新建')
  await wrapper
    .get('[data-testid="document-editor"] [aria-label="供应商"]')
    .setValue(referenceId)
  await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
  await click(wrapper, '添加商品行')
  await wrapper.get('[aria-label="产品"]').setValue(productId)
  await flushPromises()
  await wrapper.get('[aria-label="录入数量"]').setValue('2')
  await wrapper.get('[aria-label="基准数量"]').setValue('2')
  await wrapper.get('[aria-label="基础单价"]').setValue('15.00')
  await click(wrapper, '提交')
  expect(api.submitTargetOrder, wrapper.text()).toHaveBeenCalledTimes(1)
  const [, entity, input] = vi.mocked(api.submitTargetOrder).mock.calls[0]!
  expect(entity).toBe('purchase-order')
  expect(input.payload).toMatchObject({
    supplier: {
      objectId: referenceId,
      approvalEntryId: entryId,
      selectionOrigin: 'CURRENT',
    },
    warehouse: { objectId: referenceId },
    productLines: [
      {
        product: { objectId: productId },
        enteredQuantity: '2',
        baseQuantity: '2',
        unitPrice: '15.00',
        enteredUnit: { objectId: unitId, quantityScale: 0 },
      },
    ],
  })
  expect(input.documentId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  expect(input.submissionId).not.toBe(input.documentId)
  expect(input.idempotencyKey).toBe(input.submissionId)
  expect(api.queryTargetVouchers).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('提交成功')
  wrapper.unmount()
})
const referenceId = '01K00000000000000000000001',
  entryId = '01K00000000000000000000002',
  productId = '01K00000000000000000000003',
  unitId = '01K00000000000000000000004'
const unit = {
  id: unitId,
  code: 'PC',
  name: '个',
  symbol: '个',
  quantityScale: 0,
}
const productCurrent = {
  objectId: productId,
  code: 'P01',
  name: '包装桶',
  sourceApprovalEntryId: entryId,
  enabled: true,
  data: {
    name: '包装桶',
    productType: {
      id: referenceId,
      code: 'PKG',
      name: '包装物',
      behaviorProfile: 'PACKAGING',
    },
    pricingUnit: unit,
    defaultInputUnit: unit,
    unitConversions: [{ unit, factor: '1' }],
    defaultPackagingSpec: '',
    fixedFormula: null,
  },
}
it('adopts customer defaults, keeps the internal reminder out of the order, and fixes a raw-material self formula', async () => {
  useTargetSession().apiPaths = [
    '/vou/sale-order/submit-new',
    '/vou/reference/query',
    '/bob/customer/get',
    '/bob/product/get',
  ]
  vi.mocked(api.queryTargetVouReferences).mockImplementation(
    async (_token, input) =>
      ({
        items: [
          {
            entity: input.entity,
            objectId: input.entity === 'product' ? productId : referenceId,
            approvalEntryId: entryId,
            code: '01',
            name: '候选资料',
            ...(input.entity === 'customer-subunit'
              ? { customerId: referenceId, paymentMethod: null }
              : {}),
          },
        ],
      }) as Awaited<ReturnType<typeof api.queryTargetVouReferences>>,
  )
  vi.mocked(api.getTargetCustomer).mockResolvedValue({
    objectId: referenceId,
    sourceApprovalEntryId: entryId,
    enabled: true,
    data: {
      subunits: [
        {
          id: referenceId,
          enabled: true,
          defaultSalesOrderRemark: '送货前联系',
          internalReminder: '内部信用提醒',
          settlementMethod: null,
        },
      ],
    },
  } as Awaited<ReturnType<typeof api.getTargetCustomer>>)
  vi.mocked(api.getTargetProduct).mockResolvedValue({
    ...productCurrent,
    data: {
      ...productCurrent.data,
      productType: {
        ...productCurrent.data.productType,
        behaviorProfile: 'RAW_MATERIAL',
      },
      defaultPackagingSpec: '25',
    },
  } as Awaited<ReturnType<typeof api.getTargetProduct>>)
  vi.mocked(api.submitTargetOrder).mockResolvedValue({
    documentId: referenceId,
  } as Awaited<ReturnType<typeof api.submitTargetOrder>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'sale-order' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  await wrapper
    .get('[data-testid="document-editor"] [aria-label="客户子单位"]')
    .setValue(referenceId)
  await flushPromises()
  expect(wrapper.text()).toContain('内部信用提醒')
  expect(
    (wrapper.get('[aria-label="备注"]').element as HTMLInputElement).value,
  ).toBe('送货前联系')
  await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
  await wrapper.get('[aria-label="经营主体"]').setValue(referenceId)
  await click(wrapper, '添加商品行')
  await wrapper.get('[aria-label="产品"]').setValue(productId)
  await flushPromises()
  await wrapper.get('[aria-label="录入数量"]').setValue('2')
  await wrapper.get('[aria-label="基准数量"]').setValue('2')
  await wrapper.get('[aria-label="基础单价"]').setValue('10.00')
  await click(wrapper, '提交')
  expect(api.submitTargetOrder, wrapper.text()).toHaveBeenCalledTimes(1)
  const payload = vi.mocked(api.submitTargetOrder).mock.calls[0]![2].payload
  expect(payload).toMatchObject({
    remark: '送货前联系',
    productLines: [
      {
        formula: {
          sourceType: 'RAW_SELF',
          output: { baseQuantity: '1' },
          components: [
            {
              material: { objectId: productId },
              quantity: { baseQuantity: '1' },
            },
          ],
        },
      },
    ],
  })
  expect(JSON.stringify(payload)).not.toContain('内部信用提醒')
  wrapper.unmount()
})
it('keeps an uncertain order submission locked across closing, querying and reopening, and verifies the original identity', async () => {
  useTargetSession().apiPaths = [
    '/vou/purchase-order/submit-new',
    '/vou/purchase-order/get',
    '/vou/purchase-order/query',
    '/vou/reference/query',
    '/bob/product/get',
  ]
  vi.mocked(api.queryTargetVouchers).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.queryTargetVouReferences).mockImplementation(
    async (_token, input) =>
      ({
        items: [
          {
            entity: input.entity,
            objectId: input.entity === 'product' ? productId : referenceId,
            approvalEntryId: entryId,
            code: '01',
            name: '候选',
          },
        ],
      }) as Awaited<ReturnType<typeof api.queryTargetVouReferences>>,
  )
  vi.mocked(api.getTargetProduct).mockResolvedValue(
    productCurrent as Awaited<ReturnType<typeof api.getTargetProduct>>,
  )
  vi.mocked(api.submitTargetOrder).mockRejectedValue(
    new TypeError('lost response'),
  )
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'purchase-order' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  await wrapper
    .get('[data-testid="document-editor"] [aria-label="供应商"]')
    .setValue(referenceId)
  await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
  await click(wrapper, '添加商品行')
  await wrapper.get('[aria-label="产品"]').setValue(productId)
  await flushPromises()
  await wrapper.get('[aria-label="录入数量"]').setValue('1')
  await wrapper.get('[aria-label="基准数量"]').setValue('1')
  await wrapper.get('[aria-label="基础单价"]').setValue('1')
  await click(wrapper, '提交')
  expect(wrapper.text()).toContain('未知')
  await click(wrapper, '取消')
  await click(wrapper, '查询')
  await click(wrapper, '新建')
  expect(wrapper.find('[data-testid="document-editor"]').exists()).toBe(false)
  const original = vi.mocked(api.submitTargetOrder).mock.calls[0]![2]
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    entity: 'purchase-order',
    documentId: original.documentId,
    submissionId: original.submissionId,
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>)
  await click(wrapper, '核实原提交')
  expect(api.getTargetVoucher).toHaveBeenCalledWith(
    'test-csrf',
    'purchase-order',
    original.documentId,
  )
  expect(api.submitTargetOrder).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('已核实提交成功')
  wrapper.unmount()
})
it('offers the shared attachment input only with exact order staging permission', async () => {
  useTargetSession().apiPaths = [
    '/vou/purchase-order/submit-new',
    '/vou/purchase-order/attachment-stage',
  ]
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'purchase-order' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  expect(wrapper.find('[aria-label="添加附件"]').exists()).toBe(true)
  wrapper.unmount()
})
it('submits opening with its independent payload and keeps its unknown result locked after closing', async () => {
  useTargetSession().apiPaths = [
    '/vou/opening/submit-new',
    '/acc/book/query',
    '/acc/subject/query',
  ]
  vi.mocked(api.queryTargetAccountingBooks).mockResolvedValue({
    items: [
      { id: referenceId, code: 'B01', name: '账簿', baseCurrency: 'CNY' },
    ],
    total: 1,
  } as Awaited<ReturnType<typeof api.queryTargetAccountingBooks>>)
  vi.mocked(api.queryTargetAccountingSubjects).mockResolvedValue({
    items: [],
    total: 0,
  } as Awaited<ReturnType<typeof api.queryTargetAccountingSubjects>>)
  vi.mocked(api.submitTargetOpening).mockRejectedValue(new TypeError('unknown'))
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'opening' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  await wrapper.get('[aria-label="账簿"]').setValue(referenceId)
  await flushPromises()
  await click(wrapper, '提交零期初')
  expect(api.submitTargetOpening).toHaveBeenCalledWith(
    'test-csrf',
    expect.objectContaining({
      bookId: referenceId,
      lines: [],
      assets: [],
      bills: [],
      containers: [],
    }),
  )
  expect(
    vi.mocked(api.submitTargetOpening).mock.calls[0]![1],
  ).not.toHaveProperty('payload')
  await click(wrapper, '取消')
  await click(wrapper, '新建')
  expect(wrapper.find('[aria-label="账簿"]').exists()).toBe(false)
  expect(api.submitTargetOpening).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
it('keeps a failed opening input and intent, then discards both when starting another Draft', async () => {
  useTargetSession().apiPaths = [
    '/vou/opening/submit-new',
    '/acc/book/query',
    '/acc/subject/query',
  ]
  vi.mocked(api.queryTargetAccountingBooks).mockResolvedValue({
    items: [
      { id: referenceId, code: 'B01', name: '账簿', baseCurrency: 'CNY' },
    ],
    total: 1,
  } as Awaited<ReturnType<typeof api.queryTargetAccountingBooks>>)
  vi.mocked(api.queryTargetAccountingSubjects).mockResolvedValue({
    items: [],
    total: 0,
  } as Awaited<ReturnType<typeof api.queryTargetAccountingSubjects>>)
  vi.mocked(api.submitTargetOpening).mockRejectedValue(
    new api.TargetApiError('acc_opening_unbalanced', '', 'req'),
  )
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'opening' },
    global: { stubs },
  })
  await click(wrapper, '新建')
  await wrapper.get('[aria-label="账簿"]').setValue(referenceId)
  await flushPromises()
  await click(wrapper, '添加明细')
  await wrapper.get('[aria-label="金额"]').setValue('12.30')
  await click(wrapper, '提交期初')
  expect(wrapper.text()).toContain('逐币种')
  expect(
    (wrapper.get('[aria-label="金额"]').element as HTMLInputElement).value,
  ).toBe('12.30')
  await click(wrapper, '提交期初')
  expect(
    vi.mocked(api.submitTargetOpening).mock.calls[0]![1].submissionId,
  ).toBe(vi.mocked(api.submitTargetOpening).mock.calls[1]![1].submissionId)
  await click(wrapper, '取消')
  await click(wrapper, '新建')
  expect(wrapper.find('[aria-label="金额"]').exists()).toBe(false)
  wrapper.unmount()
})

it.each(['clear', 'remove'])(
  'releases pending product work after %s and ignores its late response',
  async (action) => {
    useTargetSession().apiPaths = [
      '/vou/purchase-order/submit-new',
      '/vou/reference/query',
      '/bob/product/get',
      '/vou/purchase-order/query',
    ]
    vi.mocked(api.queryTargetVouchers).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    vi.mocked(api.queryTargetVouReferences).mockImplementation(
      async (_token, input) =>
        ({
          items: [
            {
              entity: input.entity,
              objectId: input.entity === 'product' ? productId : referenceId,
              code: '01',
              name: input.entity === 'product' ? '包装桶' : '候选资料',
              approvalEntryId: entryId,
            },
          ],
        }) as Awaited<ReturnType<typeof api.queryTargetVouReferences>>,
    )
    vi.mocked(api.getTargetProduct).mockResolvedValue(
      productCurrent as Awaited<ReturnType<typeof api.getTargetProduct>>,
    )
    vi.mocked(api.submitTargetOrder).mockResolvedValue({
      documentId: referenceId,
    } as Awaited<ReturnType<typeof api.submitTargetOrder>>)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'vou', entity: 'purchase-order' },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, '新建')
    await wrapper
      .get('[data-testid="document-editor"] [aria-label="供应商"]')
      .setValue(referenceId)
    await wrapper.get('[aria-label="仓库"]').setValue(referenceId)
    await click(wrapper, '添加商品行')
    let resolveOld!: (
      value: Awaited<ReturnType<typeof api.getTargetProduct>>,
    ) => void
    vi.mocked(api.getTargetProduct).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    await wrapper.get('[aria-label="产品"]').setValue(productId)
    await flushPromises()
    if (action === 'clear')
      await wrapper.get('[aria-label="产品"]').setValue('')
    else {
      await click(wrapper, '移除商品行第 1 行')
      await click(wrapper, '添加商品行')
    }
    await wrapper.get('[aria-label="产品"]').setValue(productId)
    await flushPromises()
    resolveOld({ ...productCurrent, enabled: false } as Awaited<
      ReturnType<typeof api.getTargetProduct>
    >)

    await flushPromises()
    await wrapper.get('[aria-label="录入数量"]').setValue('2')
    await wrapper.get('[aria-label="基准数量"]').setValue('2')
    await wrapper.get('[aria-label="基础单价"]').setValue('15.00')
    await click(wrapper, '提交')
    expect(api.submitTargetOrder, wrapper.text()).toHaveBeenCalledTimes(1)
    const [, entity, input] = vi.mocked(api.submitTargetOrder).mock.calls[0]!
    expect(entity).toBe('purchase-order')
    expect(input.payload).toMatchObject({
      supplier: {
        objectId: referenceId,
        approvalEntryId: entryId,
        selectionOrigin: 'CURRENT',
      },
      warehouse: { objectId: referenceId },
      productLines: [
        {
          product: { objectId: productId },
          enteredQuantity: '2',
          baseQuantity: '2',
          unitPrice: '15.00',
          enteredUnit: { objectId: unitId, quantityScale: 0 },
        },
      ],
    })
    expect(input.documentId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(input.submissionId).not.toBe(input.documentId)
    expect(input.idempotencyKey).toBe(input.submissionId)
    expect(api.queryTargetVouchers).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('提交成功')
    wrapper.unmount()
  },
)

it('re-adopts current materials when cloning a manual formula without a source document', async () => {
  useTargetSession().apiPaths = [
    '/vou/sale-order/query',
    '/vou/sale-order/get',
    '/vou/sale-order/submit-new',
    '/bob/product/get',
    '/bob/reference/query',
  ]
  const quantity = {
    enteredQuantity: '2',
    enteredUnit: {
      objectId: unitId,
      code: 'PC',
      name: '个',
      symbol: '个',
      quantityScale: 0,
    },
    baseQuantity: '2',
  }
  const payload = {
    businessDate: '2026-09-01',
    currency: 'CNY',
    remark: '复制备注',
    attachments: [],
    customerSubunit: {
      objectId: referenceId,
      approvalEntryId: entryId,
      selectionOrigin: 'CURRENT',
    },
    warehouse: { objectId: referenceId },
    operatingEntity: { objectId: referenceId },
    paymentMethod: null,
    productLines: [
      {
        lineId: referenceId,
        product: { objectId: productId },
        ...quantity,
        unitPrice: '10',
        settlementSurcharge: '3',
        quantityPerContainer: '8',
        deliverySpecificationType: 'PACKAGED',
        containerType: '',
        remark: '',
        formula: {
          sourceType: 'MANUAL',
          output: quantity,
          components: [{ material: { objectId: referenceId }, quantity }],
        },
      },
    ],
  }
  vi.mocked(api.queryTargetVouchers).mockResolvedValue({
    items: [
      {
        vouType: 'sale-order',
        documentId: referenceId,
        documentNo: 'SO01',
        revision: '1',
        businessDate: '2026-09-01',
        submittedDate: '2026-09-01',
        handlerName: null,
        counterpartyName: '客户',
        status: 'PENDING',
        amount: '20',
        currency: 'CNY',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    entity: 'sale-order',
    documentId: referenceId,
    documentNo: 'SO01',
    revision: '1',
    submissionId: entryId,
    status: 'PENDING',
    availableApprovalActions: [],
    payload,
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>)
  vi.mocked(api.getTargetProduct).mockResolvedValue({
    ...productCurrent,
    data: {
      ...productCurrent.data,
      productType: {
        ...productCurrent.data.productType,
        behaviorProfile: 'CUSTOM_FINISHED',
      },
    },
  } as Awaited<ReturnType<typeof api.getTargetProduct>>)
  vi.mocked(api.queryTargetBobReferences).mockResolvedValue([
    {
      objectId: referenceId,
      sourceApprovalEntryId: entryId,
      code: 'R01',
      name: '当前原料',
    },
  ] as Awaited<ReturnType<typeof api.queryTargetBobReferences>>)
  vi.mocked(api.submitTargetOrder).mockResolvedValue({
    documentId: productId,
  } as Awaited<ReturnType<typeof api.submitTargetOrder>>)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'vou', entity: 'sale-order' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '打开')
  await click(wrapper, '复制到临时表单')
  await flushPromises()
  await click(wrapper, '提交')
  expect(api.submitTargetOrder, wrapper.text()).toHaveBeenCalledTimes(1)
  expect(
    vi.mocked(api.submitTargetOrder).mock.calls[0]![2].payload,
  ).toMatchObject({
    productLines: [
      {
        settlementSurcharge: '3',
        quantityPerContainer: '8',
        formula: {
          sourceType: 'MANUAL',
          output: quantity,
          components: [{ material: { objectId: referenceId }, quantity }],
        },
      },
    ],
  })
  expect(payload.productLines[0]!.formula.components[0]!.material).toEqual({
    objectId: referenceId,
  })
  wrapper.unmount()
})
