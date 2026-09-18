import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs as stubs } from './helpers/archive-stubs.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetBookOptions: vi.fn(),
  queryTargetAccPeriod: vi.fn(),
  lockTargetAccPeriod: vi.fn(),
  unlockTargetAccPeriod: vi.fn(),
  getTargetMappingCatalog: vi.fn(),
  queryTargetMappings: vi.fn(),
  getTargetMapping: vi.fn(),
  saveTargetMapping: vi.fn(),
}))
const current = {
  subjectId: 'mapping',
  revision: '1',
  book: { id: 'book', code: 'B', name: '账簿' },
  vouEntity: { id: 'sale-order', code: 'sale-order', name: '销售订单' },
  defaultResult: 'UN_POST' as const,
  definition: {
    defaultTemplateId: null,
    rules: [],
    templates: [],
    assetConfiguration: null,
  },
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.user = { id: 'accountant', code: 'accountant', name: '会计' }
  session.csrfToken = 'test'
  session.apiPaths = ['query', 'get', 'save'].map((a) => `/acc/mapping/${a}`)
  vi.mocked(api.getTargetMappingCatalog).mockResolvedValue({
    books: [current.book],
    vouEntities: [
      {
        ...current.vouEntity,
        fieldCatalog: { headerFields: [], lineFields: [], collections: [] },
      },
    ],
    subjects: [],
  })
  vi.mocked(api.queryTargetMappings).mockResolvedValue({
    items: [current],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.getTargetMapping).mockResolvedValue(structuredClone(current))
})
async function click(w: VueWrapper, label: string, selector = 'button') {
  const button = w.findAll(selector).find((b) => b.text() === label)
  expect(button, label).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
async function open() {
  const w = mount(ResourceHost, {
    props: { domain: 'acc', entity: 'mapping' },
    global: { stubs },
  })
  await flushPromises()
  await click(w, '打开')
  return w
}
it('keeps an unknown save locked after closing, querying and reopening, and only verifies the submitted revision and content', async () => {
  const w = await open()
  vi.mocked(api.saveTargetMapping).mockRejectedValue(
    new TypeError('lost response'),
  )
  await click(w, '保存')
  await click(w, '关闭')
  await click(w, '查询')
  await click(w, '新增')
  expect(w.text()).toContain('保存结果尚未确认')
  expect(
    (w.get('[aria-label="映射账簿"]').element as HTMLSelectElement).value,
  ).toBe('book')
  expect(
    w
      .findAll('button')
      .find((b) => b.text() === '保存')
      ?.attributes('disabled'),
  ).toBeDefined()
  expect(api.saveTargetMapping).toHaveBeenCalledTimes(1)
  await click(w, '读取当前配置核实')
  expect(w.text()).toContain('尚不能确认')
  vi.mocked(api.getTargetMapping).mockResolvedValue({
    ...current,
    revision: '2',
  })
  await click(w, '读取当前配置核实')
  expect(w.text()).toContain('已核实')
  expect(api.queryTargetMappings).toHaveBeenCalledTimes(3)
  expect(api.saveTargetMapping).toHaveBeenCalledTimes(1)
  w.unmount()
})
it('saves the loaded revision once and distinguishes a failed list refresh without replaying', async () => {
  const w = await open()
  vi.mocked(api.saveTargetMapping).mockResolvedValue({
    ...current,
    revision: '2',
  })
  vi.mocked(api.queryTargetMappings).mockRejectedValue(
    new TypeError('read failed'),
  )
  await click(w, '保存')
  expect(api.saveTargetMapping).toHaveBeenCalledWith(
    'test',
    expect.objectContaining({
      expectedRevision: '1',
      bookId: 'book',
      vouEntity: 'sale-order',
    }),
  )
  expect(api.saveTargetMapping).toHaveBeenCalledTimes(1)
  expect(api.queryTargetMappings).toHaveBeenCalledTimes(2)
  expect(w.text()).toContain('已保存，但列表刷新失败')
  await click(w, '关闭')
  expect(api.queryTargetMappings).toHaveBeenCalledTimes(2)
  w.unmount()
})
it('retains invalid input and reports a revision conflict through the public editor', async () => {
  const w = await open()
  await click(w, '新增', 'section[aria-label="凭证模板"] > button')
  await w.get('[aria-label="模板名称"]').setValue('本次模板')
  vi.mocked(api.saveTargetMapping).mockRejectedValue(
    new api.TargetApiError(
      'acc_mapping_stale_revision',
      'diagnostic',
      'request',
    ),
  )
  await click(w, '保存')
  expect(w.text()).toContain('映射已被其他人修改')
  expect(
    (w.get('[aria-label="模板名称"]').element as HTMLInputElement).value,
  ).toBe('本次模板')
  w.unmount()
})
it('keeps a save-only resource accessible without sending unauthorized reads', async () => {
  useTargetSession().apiPaths = ['/acc/mapping/save']
  const w = mount(ResourceHost, {
    props: { domain: 'acc', entity: 'mapping' },
    global: { stubs },
  })
  await flushPromises()
  await click(w, '新增')
  expect(w.find('h2').text()).toBe('新增')
  expect(api.getTargetMappingCatalog).toHaveBeenCalledWith()
  expect(w.get('[aria-label="映射账簿"]').text()).toContain('账簿')
  expect(api.queryTargetMappings).not.toHaveBeenCalled()
  expect(api.getTargetMapping).not.toHaveBeenCalled()
  w.unmount()
})
it('preserves visible template input when closing and reopening an unresolved save', async () => {
  const w = await open()
  await click(w, '新增', 'section[aria-label="凭证模板"] > button')
  await w.get('[aria-label="模板名称"]').setValue('待核实模板')
  vi.mocked(api.saveTargetMapping).mockRejectedValue(new TypeError('lost'))
  await click(w, '保存')
  await click(w, '关闭')
  await click(w, '新增')
  expect(w.find('[aria-label="模板名称"]').exists()).toBe(true)
  expect(
    (w.get('[aria-label="模板名称"]').element as HTMLInputElement).value,
  ).toBe('待核实模板')
  w.unmount()
})
it('shows shared Chinese captions for mapping condition fields instead of wire paths', async () => {
  vi.mocked(api.getTargetMappingCatalog).mockResolvedValue({
    books: [current.book],
    subjects: [],
    vouEntities: [
      {
        ...current.vouEntity,
        fieldCatalog: {
          headerFields: ['businessDate', 'currency', 'customer.objectId'],
          lineFields: ['line.unitPrice'],
          collections: ['productLines'],
        },
      },
    ],
  })
  const w = await open()
  await click(w, '新增', 'section[aria-label="条件规则"] > button')
  const fields = w.get('[aria-label="条件字段"]')
  expect(fields.text()).toContain('业务日期')
  expect(fields.text()).toContain('客户 · 对象标识')
  expect(fields.text()).not.toContain('customer.objectId')
  w.unmount()
})

it('shows a catalog load failure and retries through the real mapping Host', async () => {
  useTargetSession().apiPaths = ['/acc/mapping/save']
  vi.mocked(api.getTargetMappingCatalog).mockRejectedValueOnce(
    new TypeError('offline'),
  )
  const w = mount(ResourceHost, {
    props: { domain: 'acc', entity: 'mapping' },
    global: { stubs },
  })
  await flushPromises()
  expect(w.text()).toContain('网络请求失败')
  await click(w, '重试加载目录')
  await click(w, '新增')
  expect(w.get('[aria-label="映射账簿"]').text()).toContain('账簿')
  expect(api.getTargetMappingCatalog).toHaveBeenCalledTimes(2)
  expect(api.queryTargetMappings).not.toHaveBeenCalled()
  w.unmount()
})

it('period Host confirms the book and month, sends null revision and refreshes the real locked state', async () => {
  const session = useTargetSession()
  session.apiPaths = ['query', 'lock', 'unlock'].map(
    (action) => `/acc/period/${action}`,
  )
  vi.mocked(api.queryTargetBookOptions).mockResolvedValue({
    items: [
      { id: 'book', code: 'ACC-0001', name: '财务账簿', baseCurrency: 'CNY' },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  const month = {
    bookId: 'book',
    month: '2026-01',
    revision: null,
    locked: false,
    availableActions: ['lock' as const],
  }
  vi.mocked(api.queryTargetAccPeriod).mockResolvedValue([month])
  const w = mount(ResourceHost, {
    props: { domain: 'acc', entity: 'period' },
    global: { stubs },
  })
  await flushPromises()
  expect(w.text()).toContain('会计期间')
  await w.get('[aria-label="账簿"]').setValue('book')
  await click(w, '查询')
  await w.get('[aria-label="锁定"]').trigger('click')
  await flushPromises()
  expect(w.text()).toContain('财务账簿')
  expect(w.text()).toContain('2026-01')
  expect(api.lockTargetAccPeriod).not.toHaveBeenCalled()
  const locked = {
    ...month,
    locked: true,
    revision: '9007199254740993',
    availableActions: ['unlock' as const],
  }
  vi.mocked(api.lockTargetAccPeriod).mockResolvedValue(locked)
  vi.mocked(api.queryTargetAccPeriod).mockResolvedValue([locked])
  await click(w, '确认锁定')
  expect(api.lockTargetAccPeriod).toHaveBeenCalledWith('test', {
    bookId: 'book',
    month: '2026-01',
    expectedRevision: null,
  })
  expect(w.text()).toContain('已锁定')
  await w.get('[aria-label="解锁"]').trigger('click')
  await flushPromises()
  vi.mocked(api.unlockTargetAccPeriod).mockRejectedValue(
    new api.TargetApiError('approval_stale_revision', 'stale', 'req'),
  )
  await click(w, '确认解锁')
  expect(api.unlockTargetAccPeriod).toHaveBeenCalledWith('test', {
    bookId: 'book',
    month: '2026-01',
    expectedRevision: '9007199254740993',
  })
  expect(w.text()).toContain('资料已被其他人修改')
  w.unmount()
})

it('period queries discard a late failure after a newer book query succeeds', async () => {
  const session = useTargetSession()
  session.apiPaths = ['/acc/period/query']
  vi.mocked(api.queryTargetBookOptions).mockResolvedValue({
    items: [
      { id: 'first', code: 'ACC-0001', name: '第一账簿', baseCurrency: 'CNY' },
      { id: 'second', code: 'ACC-0002', name: '第二账簿', baseCurrency: 'CNY' },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  })
  let rejectFirst!: (error: Error) => void
  vi.mocked(api.queryTargetAccPeriod)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject
        }),
    )
    .mockResolvedValue([
      {
        bookId: 'second',
        month: '2025-12',
        locked: false,
        revision: null,
        availableActions: [],
      },
    ])
  const w = mount(ResourceHost, {
    props: { domain: 'acc', entity: 'period' },
    global: { stubs },
  })
  await flushPromises()
  await w.get('[aria-label="账簿"]').setValue('first')
  await click(w, '查询')
  await w.get('[aria-label="账簿"]').setValue('second')
  // Trigger the public button event even if its loading presentation suppresses a native click.
  const search = w
    .findAllComponents(stubs.VBtn)
    .find((button) => button.text() === '查询')
  search!.vm.$emit('click')
  await flushPromises()
  expect(w.text()).toContain('2025-12')
  rejectFirst(new api.TargetApiError('acc_book_access_denied', 'denied', 'old'))
  await flushPromises()
  expect(w.text()).not.toContain('没有此账簿的访问范围')
  w.unmount()
})

it('period closing failure shows the actual mapping and inventory blocker identities in Chinese', async () => {
  useTargetSession().apiPaths = ['/acc/period/query', '/acc/period/lock']
  vi.mocked(api.queryTargetBookOptions).mockResolvedValue({
    items: [
      { id: 'book', code: 'ACC-0001', name: '财务账簿', baseCurrency: 'CNY' },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.queryTargetAccPeriod).mockResolvedValue([
    {
      bookId: 'book',
      month: '2026-01',
      revision: null,
      locked: false,
      availableActions: ['lock'],
    },
  ])
  const w = mount(ResourceHost, {
    props: { domain: 'acc', entity: 'period' },
    global: { stubs },
  })
  await flushPromises()
  await w.get('[aria-label="账簿"]').setValue('book')
  await click(w, '查询')
  await w.get('[aria-label="锁定"]').trigger('click')
  await flushPromises()
  vi.mocked(api.lockTargetAccPeriod).mockRejectedValueOnce(
    new api.TargetApiError('acc_period_mapping_missing', 'mapping', 'request', {
      blockers: [{ kind: 'MAPPING', entity: 'sale-order' }],
    }),
  )
  await click(w, '确认锁定')
  expect(w.text()).toContain('销售订单')
  vi.mocked(api.lockTargetAccPeriod).mockRejectedValueOnce(
    new api.TargetApiError(
      'acc_period_negative_inventory',
      'inventory',
      'request',
      {
        blockers: [
          {
            kind: 'INVENTORY',
            warehouse_id: 'warehouse-stable-id',
            product_id: 'product-stable-id',
          },
        ],
      },
    ),
  )
  await click(w, '确认锁定')
  expect(w.text()).toContain('仓库：warehouse-stable-id')
  expect(w.text()).toContain('产品：product-stable-id')
  expect(w.text()).not.toContain('warehouse_id')
  expect(w.text()).not.toContain('sale-order')
  w.unmount()
})
