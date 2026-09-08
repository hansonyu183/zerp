import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { useWflInstanceViewModel } from '@/target/pages/wfl/instance/vm.ts'
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
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
})
function setup() {
  const session = useTargetSession()
  session.csrfToken = 'test'
  const vm = useWflInstanceViewModel()
  return { vm, session }
}
it('keeps an opening action unresolved when the user reads another instance', async () => {
  const { vm, session } = setup()
  session.apiPaths.push(
    '/wfl/process-instance/open-document',
    '/wfl/process-instance/get',
    '/vou/sale-order/get',
  )
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
  const older = vm.read()
  vm.page.value = 2
  await vm.read()
  finish({ items: [], total: 99, page: 1, pageSize: 20 })
  await older
  expect(vm.total.value).toBe(2)
  vm.dispose()
})
