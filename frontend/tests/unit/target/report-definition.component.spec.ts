import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs as stubs } from './helpers/archive-stubs.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetReportDefinitions: vi.fn(),
  getTargetReportDefinition: vi.fn(),
  saveTargetReportDefinition: vi.fn(),
  queryTargetReportDirectory: vi.fn(),
}))
const current = {
  subjectId: '01AAAAAAAAAAAAAAAAAAAAAAAA',
  code: 'rpt-000091',
  revision: '9007199254740993',
  name: '自定义汇总',
  description: '维护说明',
  sql: 'SELECT 1 AS total',
  enabled: true,
  validity: 'INVALID' as const,
  parameters: [],
  columns: [
    {
      alias: 'total',
      name: '总数',
      order: 1,
      type: 'INTEGER' as const,
      width: 120,
      visible: true,
    },
  ],
  availableActions: ['get', 'save'] as ('get' | 'save')[],
}
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  const session = useTargetSession()
  session.user = { id: 'maintainer', code: 'maintainer', name: '维护员' }
  session.csrfToken = 'test'
  session.apiPaths = ['query', 'get', 'save'].map(
    (action) => `/rpt/definition/${action}`,
  )
  vi.mocked(api.queryTargetReportDefinitions).mockResolvedValue({
    items: [current],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.getTargetReportDefinition).mockResolvedValue(
    structuredClone(current),
  )
  vi.mocked(api.queryTargetReportDirectory).mockResolvedValue([])
  vi.mocked(api.saveTargetReportDefinition).mockResolvedValue({
    ...current,
    revision: '9007199254740994',
    validity: 'VALID',
  })
})
async function open() {
  const w = mount(ResourceHost, {
    props: { domain: 'rpt', entity: 'definition' },
    global: { stubs },
  })
  await flushPromises()
  return w
}
async function click(w: Pick<VueWrapper, 'findAll'>, caption: string) {
  const button = w
    .findAll('button')
    .find((b) => b.text() === caption || b.attributes('aria-label') === caption)
  expect(button, caption).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
it('edits invalid current definition through Registry while preserving stable identity and string revision', async () => {
  const w = await open()
  expect(w.text()).toContain('自定义汇总')
  await click(w, '编辑')
  await w.get('[aria-label="名称"]').setValue('修复后的名称')
  await click(w, '验证保存')
  expect(api.saveTargetReportDefinition).toHaveBeenCalledWith(
    'test',
    expect.objectContaining({
      subjectId: current.subjectId,
      expectedRevision: '9007199254740993',
      name: '修复后的名称',
      columns: current.columns,
    }),
  )
  expect(w.text()).toContain('已保存')
  w.unmount()
})

it('preserves input and one new identity after validation failure, and never queries with save-only permission', async () => {
  useTargetSession().apiPaths = ['/rpt/definition/save']
  vi.mocked(api.saveTargetReportDefinition).mockRejectedValueOnce(
    new api.TargetApiError('rpt_definition_invalid_data', 'invalid'),
  )
  const w = await open()
  expect(api.queryTargetReportDefinitions).not.toHaveBeenCalled()
  await click(w, '新增')
  await w.get('[aria-label="名称"]').setValue('新定义')
  await w.get('[aria-label="SQL"]').setValue('SELECT 1')
  await click(w, '验证保存')
  const first = vi.mocked(api.saveTargetReportDefinition).mock.calls[0]![1]
  expect(first.expectedRevision).toBeNull()
  expect(first.enabled).toBe(true)
  expect(first.subjectId).toHaveLength(26)
  expect(w.get('[aria-label="名称"]').element).toHaveProperty('value', '新定义')
  await click(w, '验证保存')
  expect(
    vi.mocked(api.saveTargetReportDefinition).mock.calls[1]![1].subjectId,
  ).toBe(first.subjectId)
  w.unmount()
})
it('offers independent readonly detail and does not expose save', async () => {
  useTargetSession().apiPaths = ['/rpt/definition/query', '/rpt/definition/get']
  const w = await open()
  await click(w, '查看')
  expect(w.text()).toContain('查看报表定义')
  expect(w.findAll('button').some((b) => b.text() === '验证保存')).toBe(false)
  expect(w.get('[aria-label="SQL"]').attributes('disabled')).toBeDefined()
  w.unmount()
})
it('locks unknown writes across close and query, but reports confirmed save separately from refresh failure', async () => {
  vi.mocked(api.saveTargetReportDefinition).mockRejectedValueOnce(
    new Error('network'),
  )
  const w = await open()
  await click(w, '编辑')
  await click(w, '验证保存')
  expect(w.text()).toContain('保存结果未知')
  await click(w, '取消')
  await click(w, '新增')
  await click(w, '验证保存')
  expect(api.saveTargetReportDefinition).toHaveBeenCalledTimes(1)
  w.unmount()
  vi.mocked(api.queryTargetReportDirectory).mockRejectedValue(
    new Error('directory'),
  )
  const w2 = await open()
  await click(w2, '编辑')
  await click(w2, '验证保存')
  expect(w2.text()).toContain('已保存')
  expect(w2.text()).toContain('目录刷新失败')
  expect(api.saveTargetReportDefinition).toHaveBeenCalledTimes(2)
  w2.unmount()
})
it('ignores a late definition read after Session replacement', async () => {
  let resolve!: (value: typeof current) => void
  vi.mocked(api.getTargetReportDefinition).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const w = await open()
  await click(w, '编辑')
  useTargetSession().generation++
  resolve(current)
  await flushPromises()
  expect(w.text()).not.toContain('编辑报表定义')
  w.unmount()
})

it('roundtrips every parameter and column type with optional metadata through the registered editor', async () => {
  const parameters: api.TargetReportSaveInput['parameters'] = [
    {
      key: 'text',
      name: '文本值',
      type: 'TEXT',
      required: false,
      defaultValue: '默认文本',
    },
    {
      key: 'integer',
      name: '整数值',
      type: 'INTEGER',
      required: true,
      defaultValue: 0,
    },
    {
      key: 'decimal',
      name: '小数值',
      type: 'DECIMAL',
      required: false,
      defaultValue: '9007199254740993.001',
    },
    {
      key: 'boolean',
      name: '布尔值',
      type: 'BOOLEAN',
      required: false,
      defaultValue: false,
    },
    {
      key: 'date',
      name: '日期值',
      type: 'DATE',
      required: false,
      defaultValue: '2026-01-01',
    },
    {
      key: 'range',
      name: '范围值',
      type: 'DATE_RANGE',
      required: false,
      defaultValue: ['2026-01-01', '2026-02-01'],
    },
    {
      key: 'enum',
      name: '枚举值',
      type: 'ENUM',
      required: false,
      defaultValue: 'OPEN',
      enumValues: ['OPEN'],
      enumCaptions: { OPEN: '开放' },
    },
    {
      key: 'reference',
      name: '引用值',
      type: 'REFERENCE',
      required: false,
      referenceType: 'DEPARTMENT',
      defaultValue: current.subjectId,
    },
  ]
  const columns: api.TargetReportSaveInput['columns'] = (
    ['TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME', 'ID'] as const
  ).map((type, index) => ({
    alias: `column${index}`,
    name: `测试列${index}`,
    type,
    order: index + 1,
    width: 123,
    visible: index !== 0,
    format: '自定义格式',
    ...(type === 'ID' ? { drilldownEntity: 'VOU' as const } : {}),
  }))
  vi.mocked(api.getTargetReportDefinition).mockResolvedValue({
    ...current,
    parameters: parameters as Awaited<
      ReturnType<typeof api.getTargetReportDefinition>
    >['parameters'],
    columns,
  })
  const w = await open()
  await click(w, '编辑')
  expect(w.text()).toContain('资料引用')
  expect(w.text()).toContain('日期时间')
  await click(w, '验证保存')
  expect(api.saveTargetReportDefinition).toHaveBeenCalledWith(
    'test',
    expect.objectContaining({ parameters, columns }),
  )
  w.unmount()
})

it('removes optional defaults and VOU drilldown through child editors', async () => {
  vi.mocked(api.getTargetReportDefinition).mockResolvedValue({
    ...current,
    parameters: [
      {
        key: 'value',
        name: '值',
        type: 'TEXT',
        required: true,
        defaultValue: '原默认值',
      },
    ],
    columns: [{ ...current.columns[0]!, drilldownEntity: 'VOU' }],
  })
  const w = await open()
  await click(w, '编辑')
  const parameters = w.get('[aria-label="参数"]')
  await parameters.get('[data-testid="row-action-edit"]').trigger('click')
  await flushPromises()
  await parameters.get('[aria-label="默认值"]').setValue('')
  await click(parameters, '确定')
  const columns = w.get('[aria-label="结果列"]')
  await columns.get('[data-testid="row-action-edit"]').trigger('click')
  await flushPromises()
  expect(columns.get('[aria-label="下钻"]').text()).toContain('无下钻')
  await columns.get('[aria-label="下钻"]').setValue('')
  await click(columns, '确定')
  await click(w, '验证保存')
  const input = vi.mocked(api.saveTargetReportDefinition).mock.calls[0]![1]
  expect(input.parameters[0]).not.toHaveProperty('defaultValue')
  expect(input.columns[0]?.drilldownEntity).toBeUndefined()
  w.unmount()
})

it('submits empty optional filters without sending an invalid validity value', async () => {
  const w = await open()
  await w.get('.dynamic-form').trigger('submit')
  await flushPromises()
  expect(api.queryTargetReportDefinitions).toHaveBeenLastCalledWith('test', {
    keyword: '',
    page: 1,
    pageSize: 20,
  })
  w.unmount()
})
