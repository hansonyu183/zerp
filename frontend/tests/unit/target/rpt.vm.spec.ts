import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { useReportViewModel } from '@/target/pages/rpt/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'
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
    { key: 'flag', name: '标记', type: 'BOOLEAN' as const, required: false },
  ],
  columns: [column],
}
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  useTargetSession().csrfToken = 'test'
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
it('export-only report loads metadata without querying and exports validated parameter values', async () => {
  useTargetSession().apiPaths = ['/rpt/rpt-000001/export']
  const vm = useReportViewModel('rpt-000001')
  await vm.initialize()
  expect(api.queryTargetReport).not.toHaveBeenCalled()
  vm.parameterInput.value = { range: ['2026-09-01', '2026-09-30'], flag: false }
  vi.mocked(api.exportTargetReport).mockResolvedValue({
    revision: '1',
    columns: [column],
    rows: [{ total: 1 }],
  })
  const csv = await vm.exportReport()
  expect(api.exportTargetReport).toHaveBeenCalledWith('test', 'rpt-000001', {
    range: ['2026-09-01', '2026-09-30'],
    flag: false,
  })
  expect(csv).toContain('总数')
  vm.dispose()
})
it('report pagination uses a deep copy of submitted parameters and disposed responses cannot replace rows', async () => {
  useTargetSession().apiPaths = ['/rpt/rpt-000001/query']
  const vm = useReportViewModel('rpt-000001')
  await vm.initialize()
  vm.parameterInput.value = { range: ['2026-09-01', '2026-09-30'], flag: false }
  await vm.search()
  ;(vm.parameterInput.value.range as string[])[0] = '2026-08-01'
  await vm.goToPage(2)
  expect(
    vi.mocked(api.queryTargetReport).mock.lastCall?.[2].parameters,
  ).toEqual({ range: ['2026-09-01', '2026-09-30'], flag: false })
  let resolve!: (
    result: Awaited<ReturnType<typeof api.queryTargetReport>>,
  ) => void
  vi.mocked(api.queryTargetReport).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const pending = vm.search()
  vm.dispose()
  resolve({
    revision: '1',
    columns: [column],
    rows: [{ total: 99 }],
    page: 1,
    pageSize: 20,
    hasMore: false,
  })
  await pending
  expect(vm.rows.value).toEqual([])
})
