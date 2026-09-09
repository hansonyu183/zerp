import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs } from './helpers/archive-stubs.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  wflInstances: vi.fn(),
  wflInstance: vi.fn(),
  wflInstanceAction: vi.fn(),
  wflInstanceAudit: vi.fn(),
  wflNodeDocument: vi.fn(),
}))
const stubs = {
  ...archiveStubs,
  VList: { template: '<div><slot/></div>' },
  VListItem: {
    props: ['title', 'disabled'],
    emits: ['click'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')">{{title}}</button>',
  },
}
const node = {
  nodeId: 'node',
  nodeKey: 'root',
  nodeName: '订单',
  entity: 'sale-order',
  documentId: 'document',
  documentNo: 'SO-1',
  submissionId: 'submission',
  status: 'APPROVED',
  revision: '1',
  availableActions: ['OPEN_DOCUMENT'],
}
const instance = {
  processId: 'process',
  definitionName: '销售流程',
  rootDocumentNo: 'SO-1',
  approvalEntryId: 'version',
  nodes: [node],
  availableTargets: [],
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const s = useTargetSession()
  s.user = { id: 'operator', code: 'operator', name: '操作员' }
  s.csrfToken = 'test'
  s.apiPaths = ['query', 'get', 'open-document', 'audit-history']
    .map((a) => `/wfl/process-instance/${a}`)
    .concat('/vou/sale-order/get')
  vi.mocked(api.wflInstances).mockResolvedValue({
    items: [instance],
    total: 1,
    page: 1,
    pageSize: 20,
  } as never)
  vi.mocked(api.wflInstance).mockResolvedValue(instance as never)
  vi.mocked(api.wflInstanceAudit).mockResolvedValue([])
})
async function click(w: VueWrapper, label: string) {
  const b = w.findAll('button').find((b) => b.text() === label)
  expect(b, label).toBeDefined()
  await b!.trigger('click')
  await flushPromises()
}
async function open() {
  const w = mount(ResourceHost, {
    props: { domain: 'wfl', entity: 'process-instance' },
    global: { stubs },
  })
  await flushPromises()
  await click(w, '销售流程 · SO-1')
  return w
}
it('does not treat an older document-open audit as proof of the unknown request', async () => {
  const w = await open()
  vi.mocked(api.wflInstanceAction).mockRejectedValue(
    new TypeError('lost response'),
  )
  await click(w, '打开单据')
  vi.mocked(api.wflInstanceAudit).mockResolvedValue([
    {
      action: 'OPEN_DOCUMENT',
      details: {
        nodeId: 'node',
        documentId: 'document',
        requestKey: 'old-request',
      },
    },
  ] as never)
  await click(w, '核实结果')
  expect(w.text()).toContain('尚不能确认')
  expect(api.wflNodeDocument).not.toHaveBeenCalled()
  expect(api.wflInstanceAction).toHaveBeenCalledTimes(1)
  w.unmount()
})
it.each(['open-document', 'vou-read'])(
  'hides document opening without %s permission even when the server offers the action',
  async (missing) => {
    useTargetSession().apiPaths = useTargetSession().apiPaths.filter(
      (p) =>
        p !==
        (missing === 'vou-read'
          ? '/vou/sale-order/get'
          : '/wfl/process-instance/open-document'),
    )
    const w = await open()
    expect(w.findAll('button').some((b) => b.text() === '打开单据')).toBe(false)
    expect(api.wflInstanceAction).not.toHaveBeenCalled()
    expect(api.wflNodeDocument).not.toHaveBeenCalled()
    w.unmount()
  },
)
it('keeps internal-error results locked through querying and instance switching, then accepts only the exact request audit', async () => {
  const w = await open()
  vi.mocked(api.wflInstanceAction).mockRejectedValue(
    new api.TargetApiError('internal_error', 'diagnostic', 'request'),
  )
  await click(w, '打开单据')
  await click(w, '查询')
  await click(w, '销售流程 · SO-1')
  expect(w.text()).toContain('写入结果待核实')
  const input = vi.mocked(api.wflInstanceAction).mock.calls[0]![1]
  vi.mocked(api.wflInstanceAudit).mockResolvedValue([
    {
      id: 'audit',
      action: 'OPEN_DOCUMENT',
      details: { ...input, documentId: 'document' },
    },
  ] as never)
  await click(w, '核实结果')
  expect(w.text()).toContain('已核实操作结果')
  expect(api.wflInstanceAction).toHaveBeenCalledTimes(1)
  w.unmount()
})
it('shows the recorded open separately from a failed VOU read', async () => {
  const w = await open()
  vi.mocked(api.wflInstanceAction).mockResolvedValue(instance as never)
  vi.mocked(api.wflNodeDocument).mockRejectedValue(
    new TypeError('body unavailable'),
  )
  await click(w, '打开单据')
  expect(w.text()).toContain('打开动作已记录，单据读取失败')
  expect(w.text()).not.toContain('写入结果待核实')
  expect(api.wflNodeDocument).toHaveBeenCalledWith(
    'test',
    'sale-order',
    'document',
  )
  w.unmount()
})
it('sends the selected target, revision and reason, then refreshes once without replay on read failure', async () => {
  useTargetSession().apiPaths.push('/wfl/process-instance/create-child')
  vi.mocked(api.wflInstance).mockResolvedValue({
    ...instance,
    nodes: [{ ...node, availableActions: ['CREATE_CHILD'] }],
    availableTargets: [
      {
        parentNodeId: 'node',
        targetNodeKey: 'delivery',
        targetNodeName: '出库',
      },
    ],
  } as never)
  const w = await open()
  await w.get('[aria-label="实例操作原因"]').setValue('按订单生成')
  vi.mocked(api.wflInstanceAction).mockResolvedValue(instance as never)
  vi.mocked(api.wflInstances).mockRejectedValue(new TypeError('query lost'))
  await click(w, '创建 出库')
  expect(api.wflInstanceAction).toHaveBeenCalledWith(
    'test',
    expect.objectContaining({
      processId: 'process',
      nodeId: 'node',
      action: 'CREATE_CHILD',
      targetNodeKey: 'delivery',
      expectedRevision: '1',
      reason: '按订单生成',
    }),
  )
  expect(api.wflInstanceAction).toHaveBeenCalledTimes(1)
  expect(api.wflInstances).toHaveBeenCalledTimes(2)
  expect(w.text()).toContain('操作成功，但列表刷新失败')
  w.unmount()
})
it('does not let a late instance response enter a new Session', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.wflInstance>>) => void
  vi.mocked(api.wflInstance).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const w = await open()
  useTargetSession().generation++
  await flushPromises()
  resolve({ ...instance, definitionName: '旧实例私有内容' } as never)
  await flushPromises()
  expect(w.text()).not.toContain('旧实例私有内容')
  w.unmount()
})
it('keeps audit-refresh errors visible when the write and list refresh succeeded', async () => {
  useTargetSession().apiPaths.push('/wfl/process-instance/create-child')
  vi.mocked(api.wflInstance).mockResolvedValue({
    ...instance,
    nodes: [{ ...node, availableActions: ['CREATE_CHILD'] }],
    availableTargets: [
      {
        parentNodeId: 'node',
        targetNodeKey: 'delivery',
        targetNodeName: '出库',
      },
    ],
  } as never)
  const w = await open()
  vi.mocked(api.wflInstanceAction).mockResolvedValue(instance as never)
  vi.mocked(api.wflInstanceAudit).mockRejectedValue(
    new TypeError('audit unavailable'),
  )
  await click(w, '创建 出库')
  expect(w.text()).toContain('操作成功')
  expect(w.text()).toContain('运行审计读取失败')
  expect(api.wflInstanceAction).toHaveBeenCalledTimes(1)
  expect(w.text()).not.toContain('写入结果待核实')
  w.unmount()
})
it('keeps the newest query pending when an older response arrives and only displays the latest result', async () => {
  let first!: (value: Awaited<ReturnType<typeof api.wflInstances>>) => void
  let second!: (value: Awaited<ReturnType<typeof api.wflInstances>>) => void
  vi.mocked(api.wflInstances)
    .mockReturnValueOnce(
      new Promise((done) => {
        first = done
      }),
    )
    .mockReturnValueOnce(
      new Promise((done) => {
        second = done
      }),
    )
  const w = mount(ResourceHost, {
    props: { domain: 'wfl', entity: 'process-instance' },
    global: { stubs },
  })
  await flushPromises()
  await w.get('[aria-label="流程代码或名称"]').setValue('新流程')
  await w
    .get('[aria-label="流程代码或名称"]')
    .trigger('keydown', { key: 'Enter' })
  first({
    items: [{ ...instance, definitionName: '旧流程' }],
    total: 1,
    page: 1,
    pageSize: 20,
  } as never)
  await flushPromises()
  expect(
    w
      .findAll('button')
      .find((b) => b.text() === '查询')!
      .attributes('disabled'),
  ).toBeDefined()
  expect(w.text()).not.toContain('旧流程')
  second({
    items: [{ ...instance, definitionName: '新流程' }],
    total: 1,
    page: 1,
    pageSize: 20,
  } as never)
  await flushPromises()
  expect(w.text()).toContain('新流程')
  w.unmount()
})
it('does not offer audit verification without its exact permission', async () => {
  useTargetSession().apiPaths = useTargetSession().apiPaths.filter(
    (p) => !p.endsWith('/audit-history'),
  )
  const w = await open()
  vi.mocked(api.wflInstanceAction).mockRejectedValue(
    new TypeError('lost response'),
  )
  await click(w, '打开单据')
  expect(w.text()).toContain('写入结果待核实')
  expect(w.findAll('button').some((b) => b.text() === '核实结果')).toBe(false)
  expect(api.wflInstanceAudit).not.toHaveBeenCalled()
  w.unmount()
})
it('refreshes the visible audit after recording document opening even when its body read fails', async () => {
  const w = await open()
  vi.mocked(api.wflInstanceAction).mockResolvedValue(instance as never)
  vi.mocked(api.wflNodeDocument).mockRejectedValue(
    new TypeError('body unavailable'),
  )
  vi.mocked(api.wflInstanceAudit).mockResolvedValue([
    {
      id: 'open-audit',
      action: 'OPEN_DOCUMENT',
      actorId: 'operator',
      createdAt: '2026-09-09T00:00:00.000Z',
      details: {},
    },
  ])
  await click(w, '打开单据')
  expect(w.get('[aria-label="运行审计"]').text()).toContain('打开单据')
  expect(api.wflInstanceAudit).toHaveBeenCalledTimes(2)
  w.unmount()
})
