import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs as stubs } from './helpers/archive-stubs.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetReportDirectory: vi.fn(),
  queryTargetReport: vi.fn(),
  exportTargetReport: vi.fn(),
  queryTargetReportReference: vi.fn(),
}))
const column = {
  alias: 'total',
  name: '总数',
  type: 'INTEGER' as const,
  order: 1,
  width: 100,
  visible: true,
}
const definition = {
  subjectId: 'id',
  revision: '1',
  code: 'rpt-000001',
  name: '测试报表',
  parameters: [
    { key: 'range', name: '日期', type: 'DATE_RANGE' as const, required: true },
    {
      key: 'flag',
      name: '标记',
      type: 'BOOLEAN' as const,
      required: false,
      defaultValue: false,
    },
  ],
  columns: [column],
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const s = useTargetSession()
  s.csrfToken = 'test'
  s.user = { id: 'reporter', code: 'reporter', name: '报表用户' }
  s.apiPaths = ['/rpt/rpt-000001/query']
  vi.mocked(api.queryTargetReportDirectory).mockResolvedValue([
    structuredClone(definition),
  ])
  vi.mocked(api.queryTargetReport).mockResolvedValue({
    revision: '1',
    columns: [column],
    rows: [{ total: 1 }],
    page: 1,
    pageSize: 20,
    hasMore: true,
  })
})
async function click(w: VueWrapper, label: string) {
  if (label === '查询') {
    await w.get('form.report-parameters').trigger('submit')
    await flushPromises()
    return
  }
  const b = w.findAll('button').find((b) => b.text() === label)
  expect(b, label).toBeDefined()
  await b!.trigger('click')
  await flushPromises()
}
async function open() {
  const w = mount(ResourceHost, {
    props: { domain: 'rpt', entity: 'rpt-000001' },
    global: { stubs },
  })
  await flushPromises()
  return w
}
async function fill(w: VueWrapper) {
  await w.get('[aria-label="日期起"]').setValue('2026-09-01')
  await w.get('[aria-label="日期止"]').setValue('2026-09-30')
}
it('queries and paginates a deep parameter snapshot through the actual report registration', async () => {
  const w = await open()
  await fill(w)
  await click(w, '查询')
  await w.get('[aria-label="日期起"]').setValue('2026-08-01')
  await click(w, '下一页')
  expect(api.queryTargetReport).toHaveBeenLastCalledWith('test', 'rpt-000001', {
    parameters: { range: ['2026-09-01', '2026-09-30'], flag: false },
    page: 2,
    pageSize: 20,
  })
  expect(w.text()).toContain('总数')
  expect(w.find('tbody').text()).toBe('1')
  w.unmount()
})
it('supports export-only access and prevents a late export from downloading after Session change', async () => {
  useTargetSession().apiPaths = ['/rpt/rpt-000001/export']
  const create = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create
      static revokeObjectURL = vi.fn()
    },
  )
  const w = await open()
  await fill(w)
  let resolve!: (
    value: Awaited<ReturnType<typeof api.exportTargetReport>>,
  ) => void
  vi.mocked(api.exportTargetReport).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  await click(w, '导出 CSV')
  expect(api.queryTargetReport).not.toHaveBeenCalled()
  expect(api.exportTargetReport).toHaveBeenCalledWith('test', 'rpt-000001', {
    range: ['2026-09-01', '2026-09-30'],
    flag: false,
  })
  useTargetSession().generation++
  await flushPromises()
  resolve({ revision: '1', columns: [column], rows: [{ total: 99 }] })
  await flushPromises()
  expect(create).not.toHaveBeenCalled()
  w.unmount()
  vi.unstubAllGlobals()
})
it('rejects invalid dates and ignores a query result after switching resources', async () => {
  const w = await open()
  await click(w, '查询')
  expect(w.text()).toContain('必填')
  expect(api.queryTargetReport).not.toHaveBeenCalled()
  await fill(w)
  let resolve!: (
    value: Awaited<ReturnType<typeof api.queryTargetReport>>,
  ) => void
  vi.mocked(api.queryTargetReport).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  await click(w, '查询')
  await w.setProps({ entity: 'rpt-000002' })
  resolve({
    revision: '1',
    columns: [column],
    rows: [{ total: 987654 }],
    page: 1,
    pageSize: 20,
    hasMore: false,
  })
  await flushPromises()
  expect(w.text()).not.toContain('987654')
  w.unmount()
})
it('keeps two report reference sources independent when their responses arrive in reverse order', async () => {
  vi.mocked(api.queryTargetReportDirectory).mockResolvedValue([
    {
      ...definition,
      parameters: [
        {
          key: 'customer',
          name: '客户',
          type: 'REFERENCE',
          referenceType: 'CUSTOMER',
          required: true,
        },
        {
          key: 'supplier',
          name: '供应商',
          type: 'REFERENCE',
          referenceType: 'SUPPLIER',
          required: true,
        },
      ],
    },
  ] as never)
  const finish = new Map<
    string,
    (value: Awaited<ReturnType<typeof api.queryTargetReportReference>>) => void
  >()
  vi.mocked(api.queryTargetReportReference).mockImplementation(
    (_c, input) =>
      new Promise((done) => {
        finish.set(input.parameterKey, done)
      }),
  )
  const w = mount(ResourceHost, {
    props: { domain: 'rpt', entity: 'rpt-000001' },
    global: {
      stubs: {
        ...stubs,
        VAutocomplete: {
          props: ['label', 'items'],
          template:
            '<label>{{label}}<select :aria-label="label"><option v-for="item in items" :value="item.value">{{item.title}}</option></select></label>',
        },
      },
    },
  })
  await flushPromises()
  finish.get('supplier')!({
    items: [{ id: 'supplier-id', code: 'S', name: '供应商选项' }],
    page: 1,
    pageSize: 20,
    total: 1,
  } as never)
  await flushPromises()
  expect(w.get('[aria-label="供应商"]').text()).toContain('供应商选项')
  finish.get('customer')!({
    items: [{ id: 'customer-id', code: 'C', name: '客户选项' }],
    page: 1,
    pageSize: 20,
    total: 1,
  } as never)
  await flushPromises()
  expect(w.get('[aria-label="供应商"]').text()).toContain('供应商选项')
  expect(w.get('[aria-label="客户"]').text()).toContain('客户选项')
  expect(api.queryTargetReport).not.toHaveBeenCalled()
  w.unmount()
})

it('keeps empty text distinct from null in the visible report result', async () => {
  const textColumn = { ...column, type: 'TEXT' as const }
  vi.mocked(api.queryTargetReportDirectory).mockResolvedValue([
    { ...structuredClone(definition), columns: [textColumn] },
  ])
  vi.mocked(api.queryTargetReport).mockResolvedValue({
    revision: '1',
    columns: [textColumn],
    rows: [{ total: '' }, { total: null }],
    page: 1,
    pageSize: 20,
    hasMore: false,
  })
  const w = await open()
  await fill(w)
  await click(w, '查询')
  expect(w.findAll('tbody td').map((cell) => cell.text())).toEqual(['', '—'])
  w.unmount()
})

it('automatically loads report candidates without CSRF and retries a failed read through the public picker', async () => {
  useTargetSession().csrfToken = null
  vi.mocked(api.queryTargetReportDirectory).mockResolvedValue([
    {
      ...definition,
      parameters: [
        {
          key: 'department',
          name: '部门',
          type: 'REFERENCE',
          referenceType: 'DEPARTMENT',
          required: true,
        },
      ],
    },
  ])
  vi.mocked(api.queryTargetReportReference)
    .mockRejectedValueOnce(
      new api.TargetApiError('rpt_reference_unavailable', '诊断', 'request'),
    )
    .mockResolvedValue({
      items: [{ id: 'department-id', code: 'D', name: '销售部' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  const w = await open()
  expect(w.text()).toContain('候选加载失败')
  await click(w, '重试')
  expect(api.queryTargetReportDirectory).toHaveBeenCalledWith()
  expect(api.queryTargetReportReference).toHaveBeenLastCalledWith(
    'rpt-000001',
    { parameterKey: 'department', keyword: '', page: '1', pageSize: '20' },
  )
  expect(w.text()).not.toContain('候选加载失败')
  expect(api.queryTargetReport).not.toHaveBeenCalled()
  w.unmount()
})

it('shares current directory names with navigation and refreshes after rename without changing grants', async () => {
  const w = await open()
  const session = useTargetSession()
  expect(session.resourceGroups[0]?.resources[0]?.displayName).toBe('测试报表')
  vi.mocked(api.queryTargetReportDirectory).mockResolvedValue([
    { ...definition, name: '任意新名称' },
  ])
  await session.loadReportDirectory(true)
  await flushPromises()
  expect(session.resourceGroups[0]?.resources[0]?.displayName).toBe(
    '任意新名称',
  )
  expect(w.text()).toContain('任意新名称')
  expect(session.apiPaths).toEqual(['/rpt/rpt-000001/query'])
  w.unmount()
})

it('keeps authorized entries on failed and unavailable directories and recovers by retry', async () => {
  vi.mocked(api.queryTargetReportDirectory).mockRejectedValueOnce(
    new Error('offline'),
  )
  const w = await open()
  const session = useTargetSession()
  expect(session.resourceGroups[0]?.resources[0]?.displayName).toBe(
    '报表名称加载失败',
  )
  expect(w.text()).toContain('重试目录')
  vi.mocked(api.queryTargetReportDirectory).mockResolvedValue([])
  await click(w, '重试目录')
  expect(session.resourceGroups[0]?.resources[0]?.displayName).toBe(
    '报表不可用',
  )
  expect(session.hasResource('rpt', 'rpt-000001')).toBe(true)
  w.unmount()
})
it('rejects old directory results after newer rename, account replacement and forced password change', async () => {
  const session = useTargetSession()
  let resolve!: (value: (typeof definition)[]) => void
  vi.mocked(api.queryTargetReportDirectory).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = session.loadReportDirectory()
  expect(session.resourceGroups[0]?.resources[0]?.displayName).toBe(
    '报表名称加载中',
  )
  vi.mocked(api.queryTargetReportDirectory).mockResolvedValue([
    { ...definition, name: '较新改名' },
    { ...definition, code: 'rpt-000002', name: '无授权报表' },
  ])
  await session.loadReportDirectory(true)
  resolve([definition])
  await pending
  expect(
    session.resourceGroups[0]?.resources.map((r) => r.displayName),
  ).toEqual(['较新改名'])
  vi.mocked(api.queryTargetReportDirectory).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const old = session.loadReportDirectory(true)
  session.clear()
  session.user = { id: 'other', code: 'other', name: '另一账号' }
  session.apiPaths = ['/rpt/rpt-000002/export']
  resolve([definition])
  await old
  expect(session.reportDirectory).toEqual([])
  await session.loadReportDirectory()
  expect(session.resourceGroups[0]?.resources[0]?.displayName).toBe(
    '无授权报表',
  )
  session.passwordChangeRequired = true
  expect(session.reportDirectory).toEqual([])
  expect(session.resourceGroups).toEqual([])
})
