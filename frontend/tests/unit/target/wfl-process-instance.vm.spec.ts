import { describe, expect, it, vi } from 'vitest'

import {
  createWflProcessInstanceViewModel,
  vouDocumentLocation,
} from '@/target/pages/wfl/process-instance/vm.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const instance = {
  processId: '01K4A000000000000000000001',
  definitionSubjectId: '01K4A000000000000000000002',
  approvalEntryId: '01K4A000000000000000000003',
  definitionCode: 'purchase-flow',
  definitionName: '采购流程',
  rootDocumentId: '01K4A000000000000000000004',
  rootDocumentNo: 'PO-0001',
  rootEntity: 'purchase-order' as const,
  createdAt: '2026-09-05T00:00:00.000Z',
  nodes: [
    {
      nodeId: '01K4A000000000000000000005',
      nodeKey: 'order',
      nodeName: '采购订单',
      documentId: '01K4A000000000000000000004',
      documentNo: 'PO-0001',
      entity: 'purchase-order' as const,
      submissionId: '01K4A000000000000000000006',
      status: 'APPROVED' as const,
      revision: '1',
      parentNodeId: null,
      relation: null,
      createdAt: '2026-09-05T00:00:00.000Z',
      availableActions: ['OPEN_DOCUMENT', 'CREATE_CHILD'] as const,
    },
  ],
  availableTargets: [
    {
      parentNodeId: '01K4A000000000000000000005',
      targetNodeKey: 'receipt',
      targetNodeName: '采购入库',
      targetEntity: 'purchase-inbound' as const,
      relation: 'CHILD',
      actionName: '创建入库单',
      initial: { source: 'order' },
    },
  ],
}

function ports() {
  return {
    query: vi.fn().mockResolvedValue({
      items: [instance],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    get: vi.fn().mockResolvedValue(instance),
    action: vi.fn().mockResolvedValue(instance),
    requestKey: vi.fn().mockReturnValue('01K4A000000000000000000099'),
    openDocument: vi.fn(),
  }
}

describe('WFL process instance public view-model seam', () => {
  it('switches the dynamic definition code and ignores the previous route query', async () => {
    const api = ports()
    const oldQuery = deferred<Awaited<ReturnType<typeof api.query>>>()
    api.query.mockReturnValueOnce(oldQuery.promise).mockResolvedValueOnce({
      items: [{ ...instance, definitionCode: 'sale-flow' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const vm = createWflProcessInstanceViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/wfl/process-instance/query'],
        definitionCode: 'purchase-flow',
      },
      api,
    )

    const previous = vm.query(1)
    await vm.switchDefinition('sale-flow')
    oldQuery.resolve({ items: [instance], total: 1, page: 1, pageSize: 20 })
    await previous

    expect(api.query).toHaveBeenNthCalledWith(1, 'csrf-token', {
      page: 1,
      pageSize: 20,
      code: 'purchase-flow',
    })
    expect(api.query).toHaveBeenNthCalledWith(2, 'csrf-token', {
      page: 1,
      pageSize: 20,
      code: 'sale-flow',
    })
    expect(vm.definitionCode.value).toBe('sale-flow')
    expect(vm.items.value[0]?.definitionCode).toBe('sale-flow')
  })

  it('pins a dynamic process code while preserving fixed pagination and search', async () => {
    const api = ports()
    const vm = createWflProcessInstanceViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: ['/wfl/process-instance/query'],
        definitionCode: 'purchase-flow',
      },
      api,
    )
    vm.keyword.value = ' PO-0001 '

    await vm.query(3)

    expect(api.query).toHaveBeenCalledWith('csrf-token', {
      page: 3,
      pageSize: 20,
      code: 'purchase-flow',
      keyword: 'PO-0001',
    })
  })

  it('only sends a server-exposed node action and refreshes that action snapshot after failure', async () => {
    const api = ports()
    api.action.mockRejectedValue(new Error('流程实例已变化'))
    api.get.mockResolvedValueOnce(instance).mockResolvedValue({
      ...instance,
      nodes: [{ ...instance.nodes[0], availableActions: [] }],
      availableTargets: [],
    })
    const vm = createWflProcessInstanceViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/wfl/process-instance/get',
          '/wfl/process-instance/create-child',
        ],
      },
      api,
    )
    await vm.open(instance)
    vm.selectedTarget.value = instance.availableTargets[0]
    await vm.runAction(instance.nodes[0], 'CREATE_CHILD')
    await vm.runAction(instance.nodes[0], 'CREATE_CHILD')

    expect(api.action).toHaveBeenCalledWith('csrf-token', {
      processId: instance.processId,
      nodeId: instance.nodes[0].nodeId,
      action: 'CREATE_CHILD',
      targetNodeKey: 'receipt',
      requestKey: '01K4A000000000000000000099',
      expectedRevision: '1',
    })
    expect(api.requestKey).toHaveBeenCalledOnce()
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(vm.selected.value?.nodes[0]?.availableActions).toEqual([])
    expect(vm.error.value).toBe('流程实例已变化')

    await vm.runAction(instance.nodes[0], 'APPROVE_CHILD')
    expect(api.action).toHaveBeenCalledOnce()
  })

  it('opens only the typed VOU node returned by the successful server action', async () => {
    const api = ports()
    const vm = createWflProcessInstanceViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/wfl/process-instance/get',
          '/wfl/process-instance/open-document',
        ],
      },
      api,
    )
    await vm.open(instance)

    await vm.runAction(instance.nodes[0], 'OPEN_DOCUMENT')

    expect(api.action).toHaveBeenCalledWith('csrf-token', {
      processId: instance.processId,
      nodeId: instance.nodes[0].nodeId,
      action: 'OPEN_DOCUMENT',
    })
    expect(api.openDocument).toHaveBeenCalledWith(
      'purchase-order',
      instance.rootDocumentId,
    )
    expect(
      vouDocumentLocation('purchase-order', instance.rootDocumentId),
    ).toEqual({
      path: '/vou/purchase-order',
      query: { documentId: instance.rootDocumentId, mode: 'view' },
    })
  })

  it('clears the generated request key only after create-child succeeds', async () => {
    const api = ports()
    api.requestKey
      .mockReturnValueOnce('01K4A000000000000000000091')
      .mockReturnValueOnce('01K4A000000000000000000092')
    const vm = createWflProcessInstanceViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/wfl/process-instance/get',
          '/wfl/process-instance/create-child',
        ],
      },
      api,
    )
    await vm.open(instance)
    vm.selectedTarget.value = instance.availableTargets[0]
    await vm.runAction(instance.nodes[0], 'CREATE_CHILD')
    vm.selectedTarget.value = instance.availableTargets[0]
    await vm.runAction(instance.nodes[0], 'CREATE_CHILD')

    expect(api.action.mock.calls[0]?.[1].requestKey).toBe(
      '01K4A000000000000000000091',
    )
    expect(api.action.mock.calls[1]?.[1].requestKey).toBe(
      '01K4A000000000000000000092',
    )
  })
})
