import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { useWflDefinitionViewModel } from '@/target/pages/wfl/definition/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  wflInstances: vi.fn(),
  wflQuery: vi.fn(),
  wflSubmission: vi.fn(),
  wflSubmissions: vi.fn(),
  wflCurrent: vi.fn(),
  wflApprove: vi.fn(),
  wflInstance: vi.fn(),
  wflInstanceAction: vi.fn(),
  wflNodeDocument: vi.fn(),
}))
const pending: Awaited<ReturnType<typeof api.wflSubmission>> = {
  subjectId: 'subject',
  submissionId: 'entry',
  code: 'wfl-000001',
  versionNo: 1,
  status: 'PENDING',
  revision: '1',
  script: 'script',
  compiledGraph: {
    code: 'test',
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
}
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
})
function setup() {
  const session = useTargetSession()
  session.csrfToken = 'test'
  session.apiPaths = ['submission-get', 'approve', 'query', 'get'].map(
    (a) => `/wfl/process-definition/${a}`,
  )
  const vm = useWflDefinitionViewModel()
  vm.selected.value = pending
  return { vm, session }
}
it('uncertain approval is only resolved by its exact resulting status and revision', async () => {
  const { vm } = setup()
  vi.mocked(api.wflApprove).mockRejectedValue(new Error('network'))
  await vm.review('approve')
  expect(vm.unknown.value).toBe(true)
  vi.mocked(api.wflSubmission).mockResolvedValue({
    ...pending,
    status: 'APPROVED',
    revision: '2',
    availableApprovalActions: [],
  })
  await vm.verify()
  expect(api.wflSubmission).toHaveBeenCalledWith('test', {
    subjectId: 'subject',
    approvalEntryId: 'entry',
  })
  expect(vm.unknown.value).toBe(false)
  expect(api.wflApprove).toHaveBeenCalledTimes(1)
  vm.dispose()
})
it('a late approval cannot restore data after session generation changes', async () => {
  const { vm, session } = setup()
  let resolve!: (value: typeof pending) => void
  vi.mocked(api.wflApprove).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const changing = vm.review('approve')
  session.generation++
  await nextTick()
  expect(vm.busy.value).toBe(false)
  resolve({ ...pending, status: 'APPROVED', revision: '2' })
  await changing
  expect(vm.selected.value).toBeNull()
  expect(vm.feedback.value).toBe('')
  vm.dispose()
})

it('reports a confirmed write without replacing a newly opened history entry', async () => {
  const { vm } = setup()
  let resolve!: (value: typeof pending) => void
  vi.mocked(api.wflApprove).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  vi.mocked(api.wflQuery).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  const changing = vm.review('approve')
  const other = { ...pending, submissionId: 'other-entry' }
  vi.mocked(api.wflSubmission).mockResolvedValue(other)
  await vm.open('subject', 'other-entry')
  resolve({ ...pending, status: 'APPROVED', revision: '2' })
  await changing
  expect(vm.selected.value).toEqual(other)
  expect(vm.feedback.value).toBe('操作成功。')
  expect(api.wflQuery).toHaveBeenCalledTimes(1)
  expect(vm.busy.value).toBe(false)
  vm.dispose()
})

it('keeps an in-flight approval unresolved when another history entry is opened', async () => {
  const { vm } = setup()
  let reject!: (cause: Error) => void
  vi.mocked(api.wflApprove).mockReturnValue(
    new Promise((_, fail) => {
      reject = fail
    }),
  )
  const changing = vm.review('approve')
  const other = { ...pending, submissionId: 'other-entry' }
  vi.mocked(api.wflSubmission).mockResolvedValue(other)
  await vm.open('subject', 'other-entry')
  reject(new TypeError('connection lost'))
  await changing
  expect(vm.selected.value).toEqual(other)
  expect(vm.unknown.value).toBe(true)
  expect(vm.busy.value).toBe(false)
  await vm.review('approve')
  expect(api.wflApprove).toHaveBeenCalledTimes(1)
  vi.mocked(api.wflSubmission).mockResolvedValue({
    ...pending,
    status: 'APPROVED',
    revision: '2',
  })
  await vm.verify()
  expect(api.wflSubmission).toHaveBeenLastCalledWith('test', {
    subjectId: 'subject',
    approvalEntryId: 'entry',
  })
  expect(vm.unknown.value).toBe(false)
  vm.dispose()
})

it('keeps an opening action unresolved when the user reads another instance', async () => {
  const { vm, session } = setup()
  session.apiPaths.push('/wfl/process-instance/get', '/vou/sale-order/get')
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
  } as const
  vm.instance.value = {
    processId: 'process',
    definitionName: '流程',
    nodes: [node],
  } as never
  let reject!: (cause: Error) => void
  vi.mocked(api.wflInstanceAction).mockReturnValue(
    new Promise((_, fail) => {
      reject = fail
    }),
  )
  const opening = vm.nodeAction(node as never, 'OPEN_DOCUMENT')
  const other = {
    processId: 'other-process',
    definitionName: '其他流程',
    nodes: [],
  }
  vi.mocked(api.wflInstance).mockResolvedValue(other as never)
  await vm.openInstance('other-process')
  reject(new TypeError('connection lost'))
  await opening
  expect(vm.instance.value).toEqual(other)
  expect(vm.unknown.value).toBe(true)
  expect(vm.busy.value).toBe(false)
  expect(api.wflNodeDocument).not.toHaveBeenCalled()
  vm.dispose()
})

it('current-only permissions open current detail without submission requests', async () => {
  const { vm, session } = setup()
  session.apiPaths = ['/wfl/process-definition/get']
  const value = {
    subjectId: 'subject',
    approvalEntryId: 'entry',
    code: 'test',
    name: '当前流程',
    enabled: false,
    compiledGraph: pending.compiledGraph,
  }
  vi.mocked(api.wflCurrent).mockResolvedValue(value)
  await vm.openCurrent('test')
  expect(vm.currentDetail.value).toEqual(value)
  expect(api.wflSubmission).not.toHaveBeenCalled()
  vm.dispose()
})

it('out-of-order instance pages cannot replace the newest query', async () => {
  const { vm, session } = setup()
  session.apiPaths = ['/wfl/process-instance/query']
  let finish!: (value: Awaited<ReturnType<typeof api.wflInstances>>) => void
  vi.mocked(api.wflInstances).mockReturnValueOnce(
    new Promise((done) => {
      finish = done
    }),
  )
  vi.mocked(api.wflInstances).mockResolvedValueOnce({
    items: [],
    total: 2,
    page: 2,
    pageSize: 20,
  })
  const older = vm.queryInstances()
  vm.page.value = 2
  await vm.queryInstances()
  finish({ items: [], total: 99, page: 1, pageSize: 20 })
  await older
  expect(vm.total.value).toBe(2)
  vm.dispose()
})
