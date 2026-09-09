import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs as stubs } from './helpers/archive-stubs.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetSuppliers: vi.fn(),
  submitNewTargetSupplier: vi.fn(),
  queryTargetSupplierSubmissions: vi.fn(),
  getTargetSupplierSubmission: vi.fn(),
  queryTargetSupplierVersions: vi.fn(),
  queryTargetSupplierAuditHistory: vi.fn(),
  getTargetSupplier: vi.fn(),
  approveTargetSupplier: vi.fn(),
  queryTargetOperatingEntities: vi.fn(),
  queryTargetEmployees: vi.fn(),
  queryTargetAuxReferences: vi.fn(),
  submitChangeTargetSupplier: vi.fn(),
  submitNewTargetCustomer: vi.fn(),
  queryTargetCustomers: vi.fn(),
  queryTargetProducts: vi.fn(),
  queryTargetProductVersions: vi.fn(),
  queryTargetBobReferences: vi.fn(),
  submitChangeTargetProduct: vi.fn(),
  wflTrial: vi.fn(),
  wflSubmitNew: vi.fn(),
  queryTargetVouchers: vi.fn(),
  setTargetSupplierEnabled: vi.fn(),
  rejectTargetSupplier: vi.fn(),
  unrejectTargetSupplier: vi.fn(),
  unapproveTargetSupplier: vi.fn(),
  deleteTargetSupplier: vi.fn(),
  wflQuery: vi.fn(),
  wflSubmissions: vi.fn(),
  wflSubmission: vi.fn(),
  wflVersions: vi.fn(),
  wflAudit: vi.fn(),
  wflApprove: vi.fn(),
  wflCurrent: vi.fn(),
  stageTargetCustomerAttachment: vi.fn(),
  queryTargetCustomerVersions: vi.fn(),
  submitChangeTargetCustomer: vi.fn(),
  readTargetCustomerAttachment: vi.fn(),
  getTargetCustomer: vi.fn(),
  queryTargetCustomerSubmissions: vi.fn(),
  getTargetCustomerSubmission: vi.fn(),
  queryTargetCustomerAuditHistory: vi.fn(),
  submitNewTargetOtherUnit: vi.fn(),
  submitNewTargetSalesPartner: vi.fn(),
}))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.user = { id: 'maintainer', code: 'maintainer', name: '维护者' }
  session.csrfToken = 'test-csrf'
  session.apiPaths = ['/bob/supplier/submit-new']
})
async function click(wrapper: VueWrapper, caption: string) {
  const button = wrapper
    .findAll('button')
    .find((item) => item.text() === caption)
  expect(button, `button ${caption}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
it('keeps an unknown submission locked after closing its Draft without query permission', async () => {
  vi.mocked(api.submitNewTargetSupplier).mockRejectedValue(
    new TypeError('network interrupted'),
  )
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'supplier' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新增供应商')
  await wrapper.get('[aria-label="法定名称"]').setValue('供应商甲')
  await wrapper.get('[aria-label="显示名称"]').setValue('供应商甲')
  await click(wrapper, '提交')
  expect(api.submitNewTargetSupplier).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('未知')
  await click(wrapper, '取消')
  await click(wrapper, '新增供应商')
  expect(wrapper.find('[aria-label="法定名称"]').exists()).toBe(false)
  expect(api.queryTargetSuppliers).not.toHaveBeenCalled()
  expect(api.submitNewTargetSupplier).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})

const supplierSnapshot = (name: string) => ({
  identityKind: 'ORGANIZATION' as const,
  legalName: name,
  displayName: name,
  legalIdentifier: '',
  contactName: '',
  phone: '',
  address: '',
  operatingEntities: [],
  defaultOperatingEntityId: null,
  remark: '',
  settlementMethod: null,
  defaultPurchaser: null,
})
it('keeps current and candidate snapshots separate and selects a historical difference before approval', async () => {
  const session = useTargetSession()
  session.apiPaths = [
    'query',
    'get',
    'submission-query',
    'submission-get',
    'versions',
    'audit-history',
    'approve',
  ].map((action) => `/bob/supplier/${action}`)
  const approved = {
    entity: 'supplier',
    subjectId: 'supplier',
    submissionId: 'v1',
    versionNo: 1,
    status: 'APPROVED',
    revision: '8',
    submittedAt: '2026-09-08T00:00:00Z',
    availableApprovalActions: [],
    canDelete: false,
    snapshot: supplierSnapshot('正式甲'),
  }
  const pending = {
    ...approved,
    submissionId: 'v2',
    versionNo: 2,
    status: 'PENDING',
    revision: '1',
    availableApprovalActions: ['approve'],
    snapshot: supplierSnapshot('候选乙'),
  }
  vi.mocked(api.queryTargetSuppliers).mockResolvedValue({
    items: [
      {
        objectId: 'supplier',
        code: 'S001',
        name: '正式甲',
        revision: '5',
        enabled: true,
        data: approved.snapshot,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.getTargetSupplier).mockResolvedValue({
    objectId: 'supplier',
    code: 'S001',
    name: '正式甲',
    revision: '5',
    enabled: true,
    data: approved.snapshot,
  } as never)
  vi.mocked(api.queryTargetSupplierSubmissions).mockResolvedValue({
    items: [
      {
        subjectId: 'supplier',
        code: 'S001',
        latestApproved: approved,
        openCandidate: pending,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.getTargetSupplierSubmission).mockImplementation(
    async (_token, input) =>
      (input.submissionId === 'v2' ? pending : approved) as never,
  )
  vi.mocked(api.queryTargetSupplierVersions).mockResolvedValue({
    items: [approved, pending],
  } as never)
  vi.mocked(api.queryTargetSupplierAuditHistory).mockResolvedValue([])
  vi.mocked(api.approveTargetSupplier).mockResolvedValue({
    ...pending,
    status: 'APPROVED',
    revision: '2',
    availableApprovalActions: [],
  } as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'supplier' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '查看')
  expect(wrapper.text()).toContain('正式甲')
  expect(wrapper.text()).not.toContain('候选乙')
  await click(wrapper, '关闭')
  await click(wrapper, '提交记录')
  await click(wrapper, '查看')
  expect(api.getTargetSupplierSubmission).toHaveBeenCalledWith('test-csrf', {
    subjectId: 'supplier',
    submissionId: 'v2',
  })
  expect(wrapper.text()).toContain('候选乙')
  expect(wrapper.text()).toContain('版本差异')
  expect(wrapper.text()).toContain('正式甲')
  await click(wrapper, '批准')
  expect(api.approveTargetSupplier).toHaveBeenCalledWith('test-csrf', {
    subjectId: 'supplier',
    submissionId: 'v2',
    expectedRevision: '1',
  })
  expect(api.queryTargetSupplierSubmissions).toHaveBeenCalledTimes(2)
  expect(api.queryTargetSuppliers).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})

it('loads independent supplier reference sources and submits their adopted snapshots', async () => {
  useTargetSession().apiPaths = [
    '/bob/supplier/submit-new',
    '/aux/operating-entity/query',
    '/aux/employee/query',
    '/aux/reference/query',
  ]
  vi.mocked(api.queryTargetOperatingEntities).mockResolvedValue({
    items: [{ id: 'entity', code: 'E01', name: '主体甲', enabled: true }],
    total: 1,
  } as never)
  vi.mocked(api.queryTargetEmployees).mockResolvedValue({
    items: [{ id: 'employee', code: 'P01', name: '采购员甲', enabled: true }],
    total: 1,
  } as never)
  vi.mocked(api.queryTargetAuxReferences).mockResolvedValue([
    {
      objectId: 'settlement',
      code: 'S01',
      name: '月结',
      termCode: 'MONTH',
      ruleType: 'MONTH_DAY',
      monthOffset: 1,
      dayOfMonth: 10,
      dayOffset: 0,
    },
  ] as never)
  vi.mocked(api.submitNewTargetSupplier).mockResolvedValue({} as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'supplier' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新增供应商')
  await wrapper.get('[aria-label="法定名称"]').setValue('供应商甲')
  await wrapper.get('[aria-label="显示名称"]').setValue('供应商甲')
  await wrapper.get('[aria-label="适用经营主体"]').setValue(['entity'])
  await wrapper.get('[aria-label="默认采购员"]').setValue('employee')
  await wrapper.get('[aria-label="结算方式"]').setValue('settlement')
  await click(wrapper, '提交')
  expect(api.submitNewTargetSupplier).toHaveBeenCalledWith(
    'test-csrf',
    expect.objectContaining({
      snapshot: expect.objectContaining({
        operatingEntities: [
          { objectId: 'entity', code: 'E01', name: '主体甲' },
        ],
        defaultPurchaser: {
          objectId: 'employee',
          code: 'P01',
          name: '采购员甲',
        },
        settlementMethod: expect.objectContaining({
          id: 'settlement',
          name: '月结',
        }),
      }),
    }),
  )
  wrapper.unmount()
})

it('locates invalid remittance rows in the registered customer Draft and discards it on close', async () => {
  useTargetSession().apiPaths = [
    '/bob/customer/submit-new',
    '/bob/customer/save-subunits',
  ]
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'customer' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新增客户')
  await wrapper.get('[aria-label="法定名称"]').setValue('客户甲')
  await wrapper.get('[aria-label="显示名称"]').setValue('客户甲')
  await click(wrapper, '添加汇款识别')
  await click(wrapper, '提交')
  expect(wrapper.text()).toContain('汇款识别第 1 行：请填写付款户名。')
  expect(api.submitNewTargetCustomer).not.toHaveBeenCalled()
  await click(wrapper, '取消')
  await click(wrapper, '新增客户')
  expect(wrapper.find('[aria-label="付款户名"]').exists()).toBe(false)
  expect(api.queryTargetCustomers).not.toHaveBeenCalled()
  wrapper.unmount()
})

function productFacts() {
  const unit = {
    id: 'unit',
    code: 'KG',
    name: '千克',
    symbol: 'kg',
    quantityScale: 6,
  }
  const data = {
    name: '成品',
    barcode: '',
    specification: '',
    model: '',
    productType: {
      id: 'type',
      code: 'FIN',
      name: '自制成品',
      behaviorProfile: 'STANDARD_FINISHED',
    },
    productCategory: { id: 'category', code: 'CAT', name: '分类' },
    pricingUnit: unit,
    defaultInputUnit: unit,
    unitConversions: [{ unit, factor: '1' }],
    defaultPackagingSpec: '1',
    recyclable: false,
    remark: '',
    fixedFormula: {
      output: { enteredQuantity: '1', enteredUnit: unit, baseQuantity: '1' },
      components: [
        {
          material: {
            objectId: 'material',
            approvalEntryId: 'old-entry',
            code: 'MAT',
            name: '原料旧快照',
          },
          quantity: {
            enteredQuantity: '2',
            enteredUnit: unit,
            baseQuantity: '2',
          },
          resolutionStatus: 'CURRENT',
          requiresConfirmation: false,
        },
      ],
    },
  }
  return { data, unit }
}
it('opening a product change adopts the latest material version while preserving confirmed quantities', async () => {
  useTargetSession().apiPaths = [
    '/bob/product/query',
    '/bob/product/versions',
    '/bob/product/submit-change',
    '/aux/reference/query',
    '/bob/reference/query',
  ]
  const { data, unit } = productFacts()
  vi.mocked(api.queryTargetProducts).mockResolvedValue({
    items: [
      {
        objectId: 'product',
        code: 'P01',
        name: '成品',
        py: 'chengpin',
        revision: '8',
        enabled: true,
        data,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.queryTargetProductVersions).mockResolvedValue({
    items: [
      {
        entity: 'product',
        subjectId: 'product',
        submissionId: 'approved-entry',
        status: 'APPROVED',
        versionNo: 1,
        revision: '3',
        snapshot: data,
      },
    ],
  } as never)
  vi.mocked(api.queryTargetAuxReferences).mockResolvedValue([])
  vi.mocked(api.queryTargetBobReferences).mockResolvedValue([
    {
      objectId: 'material',
      sourceApprovalEntryId: 'new-entry',
      code: 'MAT',
      name: '原料现版本',
    },
  ] as never)
  vi.mocked(api.submitChangeTargetProduct).mockResolvedValue({} as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'product' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '提交变更')
  await click(wrapper, '提交')
  expect(api.submitChangeTargetProduct).toHaveBeenCalledWith(
    'test-csrf',
    expect.objectContaining({
      expectedLatestApprovedSubmissionId: 'approved-entry',
      expectedLatestApprovedRevision: '3',
      snapshot: expect.objectContaining({
        fixedFormula: expect.objectContaining({
          components: [
            expect.objectContaining({
              material: {
                objectId: 'material',
                approvalEntryId: 'new-entry',
                code: 'MAT',
                name: '原料现版本',
              },
              quantity: {
                enteredQuantity: '2',
                enteredUnit: unit,
                baseQuantity: '2',
              },
            }),
          ],
        }),
      }),
    }),
  )
  wrapper.unmount()
})

it('chooses an authorized real trial document, shows evaluation results, and invalidates them when script changes', async () => {
  useTargetSession().apiPaths = [
    '/wfl/process-definition/submit-new',
    '/wfl/process-definition/trial',
    '/vou/sale-order/query',
    '/vou/sale-order/get',
  ]
  vi.mocked(api.queryTargetVouchers).mockResolvedValue({
    items: [{ documentId: 'order', documentNo: 'SO-0001', status: 'PENDING' }],
    total: 1,
  } as never)
  vi.mocked(api.wflTrial).mockResolvedValue({
    graph: {
      code: 'flow',
      name: '试算流程',
      rootKey: 'root',
      nodes: [{ key: 'root', name: '销售订单', entity: 'sale-order' }],
      edges: [],
    },
    result: {
      ok: true,
      evaluation: {
        rootMatched: false,
        branches: [
          {
            targetKey: 'purchase',
            matched: false,
            initial: { quantity: '0.00' },
          },
        ],
      },
    },
    payloadDigest: 'digest',
    actorId: 'maintainer',
  } as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'wfl', entity: 'process-definition' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '新增流程定义')
  await wrapper.get('[aria-label="试算单据"]').setValue('order')
  await click(wrapper, '编译并试算')
  expect(wrapper.text()).toContain('根节点未匹配')
  expect(wrapper.text()).toContain('未命中')
  expect(api.wflTrial).toHaveBeenCalledWith(
    'test-csrf',
    expect.objectContaining({
      document: { entity: 'sale-order', documentId: 'order' },
    }),
  )
  await wrapper.get('[aria-label="Starlark 脚本"]').setValue('changed script')
  expect(wrapper.text()).not.toContain('根节点未匹配')
  await click(wrapper, '提交')
  expect(api.wflSubmitNew).not.toHaveBeenCalled()
  wrapper.unmount()
})

function authorizeSupplier(...actions: string[]) {
  useTargetSession().apiPaths = actions.map(
    (action) => `/bob/supplier/${action}`,
  )
}
const supplierRow = () => ({
  objectId: 'supplier',
  code: 'SUP-1',
  py: 'sup',
  name: '正式甲',
  revision: '9007199254740993',
  enabled: true,
  data: supplierSnapshot('正式甲'),
})
const supplierVersion = (
  id = 'v1',
  status: 'APPROVED' | 'PENDING' | 'REJECTED' = 'APPROVED',
) => ({
  entity: 'supplier' as const,
  subjectId: 'supplier',
  submissionId: id,
  code: 'SUP-1',
  versionNo: id === 'v1' ? 1 : 2,
  status,
  revision: '3',
  submittedAt: '2026-09-08T00:00:00Z',
  availableApprovalActions: status === 'PENDING' ? ['approve' as const] : [],
  canDelete: status !== 'APPROVED',
  snapshot: supplierSnapshot(id === 'v1' ? '正式甲' : '候选乙'),
})
function supplierHost() {
  return mount(ResourceHost, {
    props: { domain: 'bob', entity: 'supplier' },
    global: { stubs },
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
it('uses the exact current revision for enablement and preserves the applied query snapshot', async () => {
  authorizeSupplier('query', 'disable')
  vi.mocked(api.queryTargetSuppliers).mockResolvedValue({
    items: [supplierRow()],
    total: 1,
  } as never)
  vi.mocked(api.setTargetSupplierEnabled).mockResolvedValue({
    id: 'supplier',
    enabled: false,
    revision: '9007199254740994',
  })
  const wrapper = supplierHost()
  await flushPromises()
  await wrapper.get('[aria-label="编码、拼音或名称"]').setValue('已提交关键词')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await wrapper.get('[aria-label="编码、拼音或名称"]').setValue('未提交输入')
  await click(wrapper, '停用')
  expect(api.setTargetSupplierEnabled).toHaveBeenCalledWith(
    'test-csrf',
    { objectId: 'supplier', expectedRevision: '9007199254740993' },
    false,
  )
  expect(api.queryTargetSuppliers).toHaveBeenLastCalledWith('test-csrf', {
    page: 1,
    pageSize: 20,
    filters: { keyword: '已提交关键词' },
  })
  expect(api.queryTargetSuppliers).toHaveBeenCalledTimes(3)
  wrapper.unmount()
})
it('shows a vehicle blocker and keeps formal state without replaying disable', async () => {
  authorizeSupplier('query', 'disable')
  vi.mocked(api.queryTargetSuppliers).mockResolvedValue({
    items: [supplierRow()],
    total: 1,
  } as never)
  vi.mocked(api.setTargetSupplierEnabled).mockRejectedValue(
    new api.TargetApiError('archive_conflict', 'blocked', 'test', {
      blockers: [
        {
          kind: 'AUX_CURRENT_REFERENCE',
          entity: 'vehicle',
          objectId: 'vehicle',
        },
      ],
    }),
  )
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '停用')
  expect(wrapper.text()).toContain('启用车辆（vehicle）')
  expect(api.setTargetSupplierEnabled).toHaveBeenCalledTimes(1)
  expect(api.queryTargetSuppliers).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
it('keeps corrected input after a definite submit failure and refreshes only once on success', async () => {
  authorizeSupplier('query', 'submit-new')
  vi.mocked(api.queryTargetSuppliers).mockResolvedValue({
    items: [],
    total: 0,
  } as never)
  vi.mocked(api.submitNewTargetSupplier)
    .mockRejectedValueOnce(
      new api.TargetApiError('validation_failed', 'invalid', 'test'),
    )
    .mockResolvedValueOnce({} as never)
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '新增供应商')
  await wrapper.get('[aria-label="法定名称"]').setValue('原名称')
  await wrapper.get('[aria-label="显示名称"]').setValue('显示名称')
  await click(wrapper, '提交')
  expect(wrapper.get('[aria-label="法定名称"]').element).toHaveProperty(
    'value',
    '原名称',
  )
  await wrapper.get('[aria-label="法定名称"]').setValue('修正名称')
  await click(wrapper, '提交')
  expect(api.submitNewTargetSupplier).toHaveBeenLastCalledWith(
    'test-csrf',
    expect.objectContaining({
      snapshot: expect.objectContaining({ legalName: '修正名称' }),
    }),
  )
  expect(api.queryTargetSuppliers).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})
it('retains write success when its list refresh fails and never repeats the mutation', async () => {
  authorizeSupplier('query', 'disable')
  vi.mocked(api.queryTargetSuppliers)
    .mockResolvedValueOnce({ items: [supplierRow()], total: 1 } as never)
    .mockRejectedValue(new Error('refresh failed'))
  vi.mocked(api.setTargetSupplierEnabled).mockResolvedValue({
    id: 'supplier',
    enabled: false,
    revision: '9007199254740994',
  })
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '停用')
  expect(wrapper.text()).toContain('操作已成功，但列表刷新失败')
  expect(wrapper.text()).not.toContain('操作结果未知')
  expect(api.setTargetSupplierEnabled).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
it('lets versions permission select real returned snapshots without a submission-get request', async () => {
  authorizeSupplier('submission-query', 'versions')
  const first = supplierVersion(),
    next = supplierVersion('v2', 'PENDING')
  vi.mocked(api.queryTargetSupplierSubmissions).mockResolvedValue({
    items: [
      {
        subjectId: 'supplier',
        code: 'SUP-1',
        latestApproved: first,
        openCandidate: next,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.queryTargetSupplierVersions).mockResolvedValue({
    items: [first, next],
  } as never)
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '提交记录')
  await click(wrapper, '查看')
  expect(wrapper.text()).toContain('候选乙')
  await click(wrapper, '查看版本 1')
  expect(wrapper.text()).toContain('正式甲')
  expect(api.getTargetSupplierSubmission).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('ignores a late change baseline after closing and opening a fresh Draft', async () => {
  authorizeSupplier('query', 'versions', 'submit-change', 'submit-new')
  vi.mocked(api.queryTargetSuppliers).mockResolvedValue({
    items: [supplierRow()],
    total: 1,
  } as never)
  const baseline =
    deferred<Awaited<ReturnType<typeof api.queryTargetSupplierVersions>>>()
  vi.mocked(api.queryTargetSupplierVersions).mockReturnValue(baseline.promise)
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '提交变更')
  await click(wrapper, '取消')
  await click(wrapper, '新增供应商')
  baseline.resolve({ items: [supplierVersion()] } as never)
  await flushPromises()
  expect(wrapper.get('[aria-label="法定名称"]').element).toHaveProperty(
    'value',
    '',
  )
  wrapper.unmount()
})
it('keeps a versions read failure visible inside the change dialog', async () => {
  authorizeSupplier('query', 'versions', 'submit-change')
  vi.mocked(api.queryTargetSuppliers).mockResolvedValue({
    items: [supplierRow()],
    total: 1,
  } as never)
  vi.mocked(api.queryTargetSupplierVersions).mockRejectedValue(
    new Error('版本暂时不可读'),
  )
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '提交变更')
  expect(wrapper.text()).toContain('版本暂时不可读')
  await click(wrapper, '取消')
  wrapper.unmount()
})
it('requires customer subunit capability for create and preserves root-only changes', async () => {
  useTargetSession().apiPaths = ['/bob/customer/submit-new']
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'customer' },
    global: { stubs },
  })
  await flushPromises()
  expect(
    wrapper.findAll('button').some((button) => button.text() === '新增客户'),
  ).toBe(false)
  wrapper.unmount()
})
it.each([
  ['other-unit', '其他单位', 'submitNewTargetOtherUnit'],
  ['sales-partner', '销售合作方', 'submitNewTargetSalesPartner'],
] as const)(
  'submits %s with no invented operating-entity minimum',
  async (entity, title, method) => {
    useTargetSession().apiPaths = [`/bob/${entity}/submit-new`]
    vi.mocked(api[method]).mockResolvedValue({} as never)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'bob', entity },
      global: { stubs },
    })
    await flushPromises()
    await click(wrapper, `新增${title}`)
    await wrapper.get('[aria-label="法定名称"]').setValue('档案甲')
    await wrapper.get('[aria-label="显示名称"]').setValue('档案甲')
    if (entity === 'sales-partner') {
      await click(wrapper, '提交')
      expect(api[method]).not.toHaveBeenCalled()
      await wrapper.get('[aria-label="合作能力"]').setValue(['CHANNEL_PARTNER'])
    }
    await click(wrapper, '提交')
    expect(api[method]).toHaveBeenCalledWith(
      'test-csrf',
      expect.objectContaining({
        snapshot: expect.objectContaining({ operatingEntities: [] }),
      }),
    )
    wrapper.unmount()
  },
)

it('keeps an unknown submission locked when a lookup cannot see its in-flight transaction', async () => {
  authorizeSupplier('submit-new', 'submission-get')
  vi.mocked(api.submitNewTargetSupplier)
    .mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce({} as never)
  vi.mocked(api.getTargetSupplierSubmission).mockRejectedValue(
    new api.TargetApiError('approval_not_found', 'not found', 'test'),
  )
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '新增供应商')
  await wrapper.get('[aria-label="法定名称"]').setValue('原名称')
  await wrapper.get('[aria-label="显示名称"]').setValue('显示名称')
  await click(wrapper, '提交')
  const original = vi.mocked(api.submitNewTargetSupplier).mock.calls[0]![1]
  await click(wrapper, '核实结果')
  expect(wrapper.text()).toContain('结果仍未知，保持锁定')
  expect(
    wrapper.get('[aria-label="法定名称"]').attributes('disabled'),
  ).toBeDefined()
  expect(
    wrapper
      .findAll('button')
      .find((button) => button.text() === '新增供应商')!
      .attributes('disabled'),
  ).toBeDefined()
  expect(api.submitNewTargetSupplier).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.submitNewTargetSupplier).mock.calls[0]![1]).toEqual(
    original,
  )
  wrapper.unmount()
})

const customerSnapshot = () => ({
  identityKind: 'OTHER' as const,
  legalName: '客户',
  displayName: '客户',
  legalIdentifier: 'OTHER-ID',
  phone: '',
  email: '',
  address: '',
  invoiceTitle: '',
  invoiceAddress: '',
  invoicePhone: '',
  invoiceBank: '',
  invoiceAccount: '',
  remittanceProfiles: [],
  defaultOperatingEntity: null,
  identityAttachments: [],
  subunits: [
    {
      intent: 'EXISTING' as const,
      id: 'subunit',
      code: 'SUB-0001',
      name: '总部',
      contactName: '',
      address: '',
      customerType: { id: 'type', code: 'DIRECT', name: '直销' },
      settlementMethod: null,
      paymentMethod: null,
      transportPolicy: {
        methodCode: 'DELIVERY',
        methodName: '送货',
        surcharge: '0.00',
      },
      pricingPolicy: {
        defaultPremiumUnitPrice: '0.00',
        defaultDiscountUnitPrice: '0.00',
        costItems: [],
        thirdPartyIntermediaryFixedUnitCost: '0.00',
        thirdPartyIntermediaryVariableUnitCost: '0.00',
      },
      creditLimits: [],
      primarySalesAttribution: {
        type: 'INTERNAL_EMPLOYEE' as const,
        objectId: 'employee',
        code: 'EMP1',
        name: '业务员',
      },
      internalReminder: '',
      defaultSalesOrderRemark: '',
      attachments: [],
      enabled: true,
    },
  ],
})
it('preserves exact existing subunits in a root-only customer change', async () => {
  useTargetSession().apiPaths = ['query', 'versions', 'submit-change'].map(
    (action) => `/bob/customer/${action}`,
  )
  const data = customerSnapshot()
  vi.mocked(api.queryTargetCustomers).mockResolvedValue({
    items: [
      {
        objectId: 'customer',
        code: 'C01',
        name: '客户',
        enabled: true,
        revision: '1',
        data,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.queryTargetCustomerVersions).mockResolvedValue({
    items: [
      {
        subjectId: 'customer',
        submissionId: 'version',
        versionNo: 1,
        status: 'APPROVED',
        revision: '9',
        snapshot: data,
      },
    ],
  } as never)
  vi.mocked(api.submitChangeTargetCustomer).mockResolvedValue({} as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'customer' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '提交变更')
  expect(
    wrapper.get('[aria-label="子单位名称"]').attributes('disabled'),
  ).toBeDefined()
  await wrapper.get('[aria-label="显示名称"]').setValue('新客户')
  await click(wrapper, '提交')
  expect(api.submitChangeTargetCustomer).toHaveBeenCalledWith(
    'test-csrf',
    expect.objectContaining({
      expectedLatestApprovedSubmissionId: 'version',
      expectedLatestApprovedRevision: '9',
      snapshot: expect.objectContaining({
        displayName: '新客户',
        subunits: data.subunits,
      }),
    }),
  )
  wrapper.unmount()
})
it('clones customer data with fresh subunit identities and no inherited attachments', async () => {
  useTargetSession().apiPaths = ['query', 'submit-new', 'save-subunits'].map(
    (action) => `/bob/customer/${action}`,
  )
  const data = {
    ...customerSnapshot(),
    identityAttachments: [
      {
        id: 'old-file',
        fileName: 'old.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      },
    ],
  }
  vi.mocked(api.queryTargetCustomers).mockResolvedValue({
    items: [
      { objectId: 'customer', code: 'C01', name: '客户', enabled: true, data },
    ],
    total: 1,
  } as never)
  vi.mocked(api.submitNewTargetCustomer).mockResolvedValue({} as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'customer' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '克隆')
  await click(wrapper, '提交')
  const command = vi.mocked(api.submitNewTargetCustomer).mock.calls[0]![1]
  expect(command.snapshot.identityAttachments).toEqual([])
  expect(command.snapshot.subunits[0]).toMatchObject({
    intent: 'NEW',
    code: null,
    name: '总部',
  })
  expect(command.snapshot.subunits[0]!.id).not.toBe('subunit')
  expect(data.identityAttachments).toHaveLength(1)
  wrapper.unmount()
})
it('keeps files local until submit, retries a failed stage with the same identity, then adopts it', async () => {
  useTargetSession().apiPaths = [
    'query',
    'versions',
    'submit-change',
    'attachment-stage',
  ].map((action) => `/bob/customer/${action}`)
  const data = customerSnapshot()
  vi.mocked(api.queryTargetCustomers).mockResolvedValue({
    items: [
      { objectId: 'customer', code: 'C01', name: '客户', enabled: true, data },
    ],
    total: 1,
  } as never)
  vi.mocked(api.queryTargetCustomerVersions).mockResolvedValue({
    items: [
      {
        subjectId: 'customer',
        submissionId: 'version',
        versionNo: 1,
        status: 'APPROVED',
        revision: '9',
        snapshot: data,
      },
    ],
  } as never)
  vi.mocked(api.stageTargetCustomerAttachment)
    .mockRejectedValueOnce(new TypeError('upload failed'))
    .mockResolvedValueOnce({} as never)
  vi.mocked(api.submitChangeTargetCustomer).mockResolvedValue({} as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'customer' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '提交变更')
  const input = wrapper.get('[aria-label="添加身份或税务附件"]')
  const file = new File(['%PDF-1.4 test'], 'identity.pdf', {
    type: 'application/pdf',
  })
  Object.defineProperty(input.element, 'files', { value: [file] })
  await input.trigger('change')
  await vi.waitFor(() => expect(wrapper.text()).toContain('待提交时上传'))
  expect(api.stageTargetCustomerAttachment).not.toHaveBeenCalled()
  await click(wrapper, '提交')
  expect(wrapper.text()).toContain('上传失败')
  expect(api.submitChangeTargetCustomer).not.toHaveBeenCalled()
  await click(wrapper, '提交')
  const calls = vi.mocked(api.stageTargetCustomerAttachment).mock.calls
  expect(calls[1]).toEqual(calls[0])
  expect(api.submitChangeTargetCustomer).toHaveBeenCalledTimes(1)
  expect(
    vi.mocked(api.submitChangeTargetCustomer).mock.calls[0]![1].snapshot
      .identityAttachments[0],
  ).toMatchObject({
    stagingId: calls[0]![1].stagingId,
    fileName: 'identity.pdf',
  })
  wrapper.unmount()
})
it('requires a reason and explicit confirmation before deleting a candidate', async () => {
  authorizeSupplier('submission-query', 'submission-get', 'reject', 'delete')
  const pending = {
    ...supplierVersion('v2', 'PENDING'),
    availableApprovalActions: ['reject' as const],
  }
  vi.mocked(api.queryTargetSupplierSubmissions).mockResolvedValue({
    items: [
      {
        subjectId: 'supplier',
        code: 'S1',
        openCandidate: pending,
        latestApproved: null,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.getTargetSupplierSubmission).mockResolvedValue(pending as never)
  vi.mocked(api.rejectTargetSupplier).mockResolvedValue({
    ...pending,
    status: 'REJECTED',
    revision: '4',
    availableApprovalActions: [],
  } as never)
  vi.mocked(api.deleteTargetSupplier).mockResolvedValue({} as never)
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '提交记录')
  await click(wrapper, '查看')
  await click(wrapper, '驳回')
  expect(api.rejectTargetSupplier).not.toHaveBeenCalled()
  await wrapper.get('[aria-label="驳回或反批准原因"]').setValue(' 原因 ')
  await click(wrapper, '驳回')
  expect(api.rejectTargetSupplier).toHaveBeenCalledWith('test-csrf', {
    subjectId: 'supplier',
    submissionId: 'v2',
    expectedRevision: '3',
    reason: '原因',
  })
  expect(wrapper.text()).toContain('已驳回')
  await click(wrapper, '删除候选')
  expect(api.deleteTargetSupplier).not.toHaveBeenCalled()
  await click(wrapper, '确认删除')
  expect(api.deleteTargetSupplier).toHaveBeenCalledWith('test-csrf', {
    subjectId: 'supplier',
    submissionId: 'v2',
    expectedRevision: '4',
  })
  wrapper.unmount()
})
it('ignores obsolete queries and removes the Draft on session changes', async () => {
  authorizeSupplier('query', 'submit-new')
  const old = deferred<Awaited<ReturnType<typeof api.queryTargetSuppliers>>>()
  vi.mocked(api.queryTargetSuppliers)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ items: [], total: 0 } as never)
  const wrapper = supplierHost()
  await flushPromises()
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  old.resolve({ items: [supplierRow()], total: 1 } as never)
  await flushPromises()
  expect(wrapper.text()).not.toContain('SUP-1')
  await click(wrapper, '新增供应商')
  await wrapper.get('[aria-label="法定名称"]').setValue('旧账号输入')
  useTargetSession().generation++
  await flushPromises()
  expect(wrapper.find('[aria-label="法定名称"]').exists()).toBe(false)
  wrapper.unmount()
})
const wflPending = {
  subjectId: 'subject',
  submissionId: 'entry',
  code: 'W01',
  versionNo: 1,
  status: 'PENDING',
  revision: '1',
  script: 'script',
  compiledGraph: {
    code: 'flow',
    name: '流程',
    rootKey: 'root',
    nodes: [],
    edges: [],
  },
  enabled: false,
  runtimeRevision: null,
  availableApprovalActions: ['approve'],
  availableRuntimeActions: [],
  canDelete: false,
} as const
async function wflHistory() {
  useTargetSession().apiPaths = [
    'submission-query',
    'submission-get',
    'versions',
    'approve',
  ].map((action) => `/wfl/process-definition/${action}`)
  const other = {
    ...wflPending,
    submissionId: 'other',
    versionNo: 2,
    script: 'other script',
  }
  vi.mocked(api.wflSubmissions).mockResolvedValue({
    items: [
      {
        subjectId: 'subject',
        code: 'W01',
        openCandidate: wflPending,
        latestApproved: null,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.wflSubmission).mockImplementation(
    async (_token, input) =>
      (input.approvalEntryId === 'other' ? other : wflPending) as never,
  )
  vi.mocked(api.wflVersions).mockResolvedValue([wflPending, other] as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'wfl', entity: 'process-definition' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '提交记录')
  await click(wrapper, '查看')
  return wrapper
}
it.each([true, false])(
  'isolates late WFL approval from a newly selected history and verifies the original identity (unknown=%s)',
  async (unknown) => {
    const wrapper = await wflHistory()
    const result = deferred<Awaited<ReturnType<typeof api.wflApprove>>>()
    vi.mocked(api.wflApprove).mockReturnValue(result.promise)
    await click(wrapper, '批准')
    await click(wrapper, '查看版本 2')
    if (unknown) result.reject(new TypeError('network'))
    else
      result.resolve({
        ...wflPending,
        status: 'APPROVED',
        revision: '2',
      } as never)
    await flushPromises()
    expect(wrapper.text()).toContain('other script')
    expect(api.wflApprove).toHaveBeenCalledTimes(1)
    if (unknown) {
      await click(wrapper, '批准')
      expect(api.wflApprove).toHaveBeenCalledTimes(1)
      vi.mocked(api.wflSubmission).mockResolvedValueOnce({
        ...wflPending,
        status: 'APPROVED',
        revision: '5',
      } as never)
      await click(wrapper, '核实结果')
      expect(wrapper.text()).toContain('保持锁定')
      vi.mocked(api.wflSubmission).mockResolvedValueOnce({
        ...wflPending,
        status: 'APPROVED',
        revision: '2',
      } as never)
      await click(wrapper, '核实结果')
      expect(api.wflSubmission).toHaveBeenLastCalledWith('test-csrf', {
        subjectId: 'subject',
        approvalEntryId: 'entry',
      })
      expect(wrapper.text()).toContain('已核实操作成功')
    } else expect(wrapper.text()).toContain('操作成功')
    wrapper.unmount()
  },
)
it('opens WFL current detail without any submission permission', async () => {
  useTargetSession().apiPaths = ['query', 'get'].map(
    (action) => `/wfl/process-definition/${action}`,
  )
  const current = {
    subjectId: 'subject',
    approvalEntryId: 'entry',
    code: 'flow',
    name: '当前流程',
    enabled: true,
    compiledGraph: wflPending.compiledGraph,
  }
  vi.mocked(api.wflQuery).mockResolvedValue({
    items: [current],
    total: 1,
  } as never)
  vi.mocked(api.wflCurrent).mockResolvedValue(current as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'wfl', entity: 'process-definition' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '查看')
  expect(api.wflCurrent).toHaveBeenCalledWith('test-csrf', { code: 'flow' })
  expect(api.wflSubmission).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('renders normalized customer pricing changes for an unnumbered candidate against the approved version', async () => {
  useTargetSession().apiPaths = [
    'submission-query',
    'submission-get',
    'versions',
    'audit-history',
  ].map((action) => `/bob/customer/${action}`)
  const before = {
    ...customerSnapshot(),
    subunits: customerSnapshot().subunits.map((sub) => ({
      ...sub,
      pricingPolicy: {
        ...sub.pricingPolicy,
        costItems: [
          {
            name: 'Handling',
            calculationBasis: 'UNIT_PRICE',
            unitPrice: '1.00',
          },
          {
            name: '删除项',
            calculationBasis: 'ORDER_AMOUNT',
            orderAmount: '2.00',
          },
          { name: '金额项', calculationBasis: 'UNIT_PRICE', unitPrice: '3.00' },
        ],
      },
    })),
  }
  const after = {
    ...before,
    subunits: before.subunits.map((sub) => ({
      ...sub,
      pricingPolicy: {
        ...sub.pricingPolicy,
        defaultDiscountUnitPrice: '0.10',
        costItems: [
          {
            name: ' handling ',
            calculationBasis: 'ORDER_AMOUNT',
            orderAmount: '1.00',
          },
          { name: '新增项', calculationBasis: 'UNIT_PRICE', unitPrice: '2.00' },
          { name: '金额项', calculationBasis: 'UNIT_PRICE', unitPrice: '4.00' },
        ],
      },
    })),
  }
  const approved = {
    ...supplierVersion(),
    entity: 'customer',
    subjectId: 'customer',
    snapshot: before,
  }
  const candidate = {
    ...approved,
    submissionId: 'candidate',
    status: 'PENDING',
    versionNo: null,
    snapshot: after,
  }
  vi.mocked(api.queryTargetCustomerSubmissions).mockResolvedValue({
    items: [
      {
        subjectId: 'customer',
        code: 'C01',
        latestApproved: approved,
        openCandidate: candidate,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.getTargetCustomerSubmission).mockResolvedValue(
    candidate as never,
  )
  vi.mocked(api.queryTargetCustomerVersions).mockResolvedValue({
    items: [approved, candidate],
  } as never)
  vi.mocked(api.queryTargetCustomerAuditHistory).mockResolvedValue([
    {
      id: 'audit',
      action: 'SUBMITTED',
      actorId: '提交人',
      createdAt: '2026-09-09',
      reason: null,
    },
  ] as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'customer' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '提交记录')
  await click(wrapper, '查看')
  const text = wrapper.get('[aria-label="客户定价差异"]').text()
  expect(text).toContain('口径变化按单价 1.00按订单金额 1.00')
  expect(text).toContain('删除项删除')
  expect(text).toContain('新增项新增')
  expect(text).toContain('金额项金额变化')
  expect(wrapper.text()).toContain('已提交')
  expect(wrapper.text()).toContain('提交人')
  wrapper.unmount()
})
it('downloads only the exact adopted attachment from the authorized current customer', async () => {
  useTargetSession().apiPaths = ['query', 'get', 'attachment-read'].map(
    (action) => `/bob/customer/${action}`,
  )
  const data = {
    ...customerSnapshot(),
    identityAttachments: [
      {
        id: 'file',
        fileName: 'identity.pdf',
        contentType: 'application/pdf',
        sizeBytes: 13,
        sha256: 'a'.repeat(64),
      },
    ],
  }
  const row = {
    objectId: 'customer',
    code: 'C01',
    name: '客户',
    enabled: true,
    data,
  }
  vi.mocked(api.queryTargetCustomers).mockResolvedValue({
    items: [row],
    total: 1,
  } as never)
  vi.mocked(api.getTargetCustomer).mockResolvedValue(row as never)
  vi.mocked(api.readTargetCustomerAttachment).mockResolvedValue({
    fileName: 'identity.pdf',
    mimeType: 'application/pdf',
    size: 13,
    digest: 'a'.repeat(64),
    contentBase64: btoa('%PDF-1.4 test'),
  })
  const originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = vi.fn().mockReturnValue('blob:test')
  URL.revokeObjectURL = vi.fn()
  const anchor = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {})
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'customer' },
    global: { stubs },
  })
  try {
    await flushPromises()
    await click(wrapper, '查看')
    await click(wrapper, '下载附件')
    expect(api.readTargetCustomerAttachment).toHaveBeenCalledWith('test-csrf', {
      source: 'current',
      objectId: 'customer',
      fileId: 'file',
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  } finally {
    wrapper.unmount()
    anchor.mockRestore()
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})
it('never offers a server action without its exact permission and retains an unknown current enablement', async () => {
  authorizeSupplier(
    'query',
    'get',
    'disable',
    'submission-query',
    'submission-get',
  )
  vi.mocked(api.queryTargetSuppliers).mockResolvedValue({
    items: [supplierRow()],
    total: 1,
  } as never)
  vi.mocked(api.setTargetSupplierEnabled).mockRejectedValue(
    new TypeError('network'),
  )
  vi.mocked(api.getTargetSupplier).mockResolvedValue({
    ...supplierRow(),
    enabled: false,
    revision: '9007199254740996',
  } as never)
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '停用')
  await click(wrapper, '核实结果')
  expect(wrapper.text()).toContain('保持锁定')
  expect(api.setTargetSupplierEnabled).toHaveBeenCalledTimes(1)
  const pending = supplierVersion('v2', 'PENDING')
  vi.mocked(api.queryTargetSupplierSubmissions).mockResolvedValue({
    items: [
      {
        subjectId: 'supplier',
        code: 'S1',
        openCandidate: pending,
        latestApproved: null,
      },
    ],
    total: 1,
  } as never)
  vi.mocked(api.getTargetSupplierSubmission).mockResolvedValue(pending as never)
  await click(wrapper, '提交记录')
  await click(wrapper, '查看')
  expect(
    wrapper.findAll('button').some((button) => button.text() === '批准'),
  ).toBe(false)
  expect(wrapper.text()).toContain('保持写入锁定')
  wrapper.unmount()
})

it('does not let initial material resolution overwrite a subsequent user choice', async () => {
  useTargetSession().apiPaths = [
    '/bob/product/query',
    '/bob/product/versions',
    '/bob/product/submit-change',
    '/aux/reference/query',
    '/bob/reference/query',
  ]
  const { data } = productFacts()
  vi.mocked(api.queryTargetProducts).mockResolvedValue({
    items: [
      { objectId: 'product', code: 'P01', name: '成品', enabled: true, data },
    ],
    total: 1,
  } as never)
  vi.mocked(api.queryTargetProductVersions).mockResolvedValue({
    items: [
      {
        subjectId: 'product',
        submissionId: 'approved',
        versionNo: 1,
        status: 'APPROVED',
        revision: '3',
        snapshot: data,
      },
    ],
  } as never)
  vi.mocked(api.queryTargetAuxReferences).mockResolvedValue([])
  const initial =
    deferred<Awaited<ReturnType<typeof api.queryTargetBobReferences>>>()
  vi.mocked(api.queryTargetBobReferences)
    .mockResolvedValueOnce([
      {
        objectId: 'material',
        sourceApprovalEntryId: 'newest',
        code: 'MAT',
        name: '新原料',
      },
      {
        objectId: 'other',
        sourceApprovalEntryId: 'other-entry',
        code: 'OTHER',
        name: '其他原料',
      },
    ] as never)
    .mockReturnValueOnce(initial.promise)
  vi.mocked(api.submitChangeTargetProduct).mockResolvedValue({} as never)
  const wrapper = mount(ResourceHost, {
    props: { domain: 'bob', entity: 'product' },
    global: { stubs },
  })
  await flushPromises()
  await click(wrapper, '提交变更')
  await wrapper.get('[aria-label="原材料"]').setValue('other')
  await wrapper.get('[aria-label="原材料"]').setValue('material')
  initial.resolve([
    {
      objectId: 'material',
      sourceApprovalEntryId: 'stale',
      code: 'MAT',
      name: '较早查询的原料',
    },
  ] as never)
  await flushPromises()
  await click(wrapper, '提交')
  expect(api.submitChangeTargetProduct).toHaveBeenCalledWith(
    'test-csrf',
    expect.objectContaining({
      snapshot: expect.objectContaining({
        fixedFormula: expect.objectContaining({
          components: [
            expect.objectContaining({
              material: expect.objectContaining({ approvalEntryId: 'newest' }),
            }),
          ],
        }),
      }),
    }),
  )
  wrapper.unmount()
})

it.each([
  ['unapprove', '反批准', 'APPROVED', 'unapproveTargetSupplier'],
  ['unreject', '恢复审核', 'REJECTED', 'unrejectTargetSupplier'],
] as const)(
  'performs authorized %s with the selected revision and required reason',
  async (action, caption, status, method) => {
    authorizeSupplier('submission-query', 'submission-get', action)
    const selected = {
      ...supplierVersion('v1', status),
      availableApprovalActions: [action],
    }
    vi.mocked(api.queryTargetSupplierSubmissions).mockResolvedValue({
      items: [
        {
          subjectId: 'supplier',
          code: 'S1',
          openCandidate: status === 'REJECTED' ? selected : null,
          latestApproved: status === 'APPROVED' ? selected : null,
        },
      ],
      total: 1,
    } as never)
    vi.mocked(api.getTargetSupplierSubmission).mockResolvedValue(
      selected as never,
    )
    vi.mocked(api[method]).mockResolvedValue({
      ...selected,
      status: 'PENDING',
      revision: '4',
      availableApprovalActions: [],
    } as never)
    const wrapper = supplierHost()
    await flushPromises()
    await click(wrapper, '提交记录')
    await click(wrapper, '查看')
    if (action === 'unapprove') {
      await click(wrapper, caption)
      expect(api[method]).not.toHaveBeenCalled()
      await wrapper
        .get('[aria-label="驳回或反批准原因"]')
        .setValue(' 核实后撤回 ')
    }
    await click(wrapper, caption)
    expect(api[method]).toHaveBeenCalledWith('test-csrf', {
      subjectId: 'supplier',
      submissionId: 'v1',
      expectedRevision: '3',
      ...(action === 'unapprove' ? { reason: '核实后撤回' } : {}),
    })
    expect(api.queryTargetSupplierSubmissions).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  },
)
it('treats an invalid submit response as unknown and resolves only its exact submission without replay', async () => {
  authorizeSupplier('submit-new', 'submission-get')
  vi.mocked(api.submitNewTargetSupplier).mockRejectedValue(
    new api.TargetApiError('invalid_response', 'invalid', 'test'),
  )
  const wrapper = supplierHost()
  await flushPromises()
  await click(wrapper, '新增供应商')
  await wrapper.get('[aria-label="法定名称"]').setValue('供应商')
  await wrapper.get('[aria-label="显示名称"]').setValue('供应商')
  await click(wrapper, '提交')
  const command = vi.mocked(api.submitNewTargetSupplier).mock.calls[0]![1]
  vi.mocked(api.getTargetSupplierSubmission).mockResolvedValue({
    ...supplierVersion(),
    subjectId: command.subjectId,
    submissionId: command.submissionId,
  } as never)
  await click(wrapper, '核实结果')
  expect(api.getTargetSupplierSubmission).toHaveBeenCalledWith('test-csrf', {
    subjectId: command.subjectId,
    submissionId: command.submissionId,
  })
  expect(api.submitNewTargetSupplier).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('已核实操作成功')
  expect(wrapper.find('[aria-label="法定名称"]').exists()).toBe(false)
  wrapper.unmount()
})
it('ignores a late approval after the session changes', async () => {
  const wrapper = await wflHistory()
  const result = deferred<Awaited<ReturnType<typeof api.wflApprove>>>()
  vi.mocked(api.wflApprove).mockReturnValue(result.promise)
  await click(wrapper, '批准')
  useTargetSession().generation++
  await flushPromises()
  result.resolve({ ...wflPending, status: 'APPROVED', revision: '2' } as never)
  await flushPromises()
  expect(wrapper.text()).not.toContain('操作成功')
  expect(
    wrapper.findAll('button').some((button) => button.text() === '批准'),
  ).toBe(false)
  wrapper.unmount()
})
