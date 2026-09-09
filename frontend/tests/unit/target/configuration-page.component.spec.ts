import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs as stubs } from './helpers/archive-stubs.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
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
  session.apiPaths = ['catalog', 'query', 'get', 'save'].map(
    (a) => `/acc/mapping/${a}`,
  )
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
async function click(w: VueWrapper, label: string) {
  const button = w.findAll('button').find((b) => b.text() === label)
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
  await click(w, '新增映射')
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
  await click(w, '添加模板')
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
  await click(w, '新增映射')
  expect(w.text()).toContain('当前会计映射')
  expect(api.getTargetMappingCatalog).not.toHaveBeenCalled()
  expect(api.queryTargetMappings).not.toHaveBeenCalled()
  expect(api.getTargetMapping).not.toHaveBeenCalled()
  w.unmount()
})
it('preserves visible template input when closing and reopening an unresolved save', async () => {
  const w = await open()
  await click(w, '添加模板')
  await w.get('[aria-label="模板名称"]').setValue('待核实模板')
  vi.mocked(api.saveTargetMapping).mockRejectedValue(new TypeError('lost'))
  await click(w, '保存')
  await click(w, '关闭')
  await click(w, '新增映射')
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
          headerFields: [
            'businessDate',
            'currency',
            'customerSubunit.objectId',
          ],
          lineFields: ['line.unitPrice'],
          collections: ['productLines'],
        },
      },
    ],
  })
  const w = await open()
  await click(w, '添加规则')
  const fields = w.get('[aria-label="条件字段"]')
  expect(fields.text()).toContain('业务日期')
  expect(fields.text()).toContain('客户子单位 · 对象标识')
  expect(fields.text()).not.toContain('customerSubunit.objectId')
  w.unmount()
})
