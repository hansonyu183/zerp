import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { pageRegistrations } from '@/router/registry'
import definitionPageSource from '@/pages/dcl/wfl-process-definition/WflProcessDefinition.vue?raw'
import {
  approveDclWflProcessDefinition,
  createDclWflProcessDefinition,
  createNextDclWflProcessDefinitionVersion,
  deleteDclWflProcessDefinitionVersion,
  getDclWflProcessDefinition,
  getDclWflProcessDefinitionAuditHistory,
  getDclWflProcessDefinitionVersions,
  queryDclWflProcessDefinitions,
  rejectDclWflProcessDefinition,
  saveDclWflProcessDefinition,
  setDclWflProcessDefinitionEnabled,
  submitDclWflProcessDefinition,
  trialWflProcessDefinition,
  unapproveDclWflProcessDefinition,
  unsubmitDclWflProcessDefinition,
  type DclWflProcessDefinition,
  type DclWflProcessDefinitionListItem,
} from '@/pages/dcl/wfl-process-definition/api'
import { createDclWflProcessDefinitionViewModel } from '@/pages/dcl/wfl-process-definition/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: '01KWFL00000000000000000001',
  versionNo: 1,
  status: 'DRAFT' as const,
  revision: 1,
  createdBy: 'USER-1',
  createdAt: '2026-08-29T00:00:00Z',
  updatedBy: 'USER-1',
  updatedAt: '2026-08-29T00:00:00Z',
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
}

const listItem: DclWflProcessDefinitionListItem = {
  code: 'test-flow',
  definitionId: '01KWFL00000000000000000002',
  enabled: false,
  latestApproved: null,
  openVersion: { approval },
}

const definition: DclWflProcessDefinition = {
  code: 'test-flow',
  definitionId: '01KWFL00000000000000000002',
  enabled: false,
  approval,
  script: 'workflow(code="test-flow", name="测试流程", root=root)',
  nodes: [
    {
      key: 'root',
      name: '销售订单',
      documentEntity: 'sale-order' as const,
      positionX: 0,
      positionY: 0,
    },
  ],
  edges: [],
}

describe('DCL WFL process-definition gateway paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes all lifecycle calls through dcl/wfl-process-definition/* endpoints', async () => {
    mockedPost.mockResolvedValue({ data: {} } as never)

    await queryDclWflProcessDefinitions({ page: 1, pageSize: 20 })
    await getDclWflProcessDefinition('test-flow', approval.approvalEntryId)
    await createDclWflProcessDefinition('workflow(code="x")')
    await saveDclWflProcessDefinition({
      code: definition.code,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
      script: definition.script,
    })
    await submitDclWflProcessDefinition(definition)
    await unsubmitDclWflProcessDefinition(definition)
    await rejectDclWflProcessDefinition(definition, '需要修改')
    await approveDclWflProcessDefinition(definition)
    await unapproveDclWflProcessDefinition(definition, '撤回批准')
    await createNextDclWflProcessDefinitionVersion(definition)
    await deleteDclWflProcessDefinitionVersion(definition)
    await setDclWflProcessDefinitionEnabled(definition, true)
    await setDclWflProcessDefinitionEnabled(definition, false)
    await getDclWflProcessDefinitionVersions(definition.code)
    await getDclWflProcessDefinitionAuditHistory(definition.code)

    const expectedPaths = [
      'dcl/wfl-process-definition/query',
      'dcl/wfl-process-definition/get',
      'dcl/wfl-process-definition/create',
      'dcl/wfl-process-definition/save',
      'dcl/wfl-process-definition/submit',
      'dcl/wfl-process-definition/unsubmit',
      'dcl/wfl-process-definition/reject',
      'dcl/wfl-process-definition/approve',
      'dcl/wfl-process-definition/unapprove',
      'dcl/wfl-process-definition/create-next',
      'dcl/wfl-process-definition/delete-version',
      'dcl/wfl-process-definition/enable',
      'dcl/wfl-process-definition/disable',
      'dcl/wfl-process-definition/versions',
      'dcl/wfl-process-definition/audit-history',
    ]
    for (let i = 0; i < expectedPaths.length; i++) {
      expect(mockedPost).toHaveBeenNthCalledWith(
        i + 1,
        expectedPaths[i],
        expect.any(Object),
      )
    }
    expect(mockedPost).toHaveBeenNthCalledWith(
      12,
      'dcl/wfl-process-definition/enable',
      {
        code: definition.code,
        approvalEntryId: approval.approvalEntryId,
        approvalRevision: approval.revision,
      },
    )
    expect(mockedPost).toHaveBeenNthCalledWith(
      13,
      'dcl/wfl-process-definition/disable',
      {
        code: definition.code,
        approvalEntryId: approval.approvalEntryId,
        approvalRevision: approval.revision,
      },
    )
  })

  it('keeps trial on the typed WFL endpoint', async () => {
    mockedPost.mockResolvedValue({ data: {} } as never)

    await trialWflProcessDefinition({
      definitionId: definition.definitionId,
      approvalEntryId: approval.approvalEntryId,
      revision: approval.revision,
      source: { entity: 'sale-order', documentId: 'DOC-1' },
    })

    expect(mockedPost).toHaveBeenCalledWith(
      'wfl/process-definition/trial',
      expect.objectContaining({
        definitionId: definition.definitionId,
        source: { entity: 'sale-order', documentId: 'DOC-1' },
      }),
    )
  })

  it('never calls old wfl/definition/* paths', async () => {
    mockedPost.mockResolvedValue({ data: {} } as never)

    await createDclWflProcessDefinition('workflow()')
    await submitDclWflProcessDefinition(definition)
    await approveDclWflProcessDefinition(definition)

    const oldPaths = mockedPost.mock.calls.filter(
      ([path]) =>
        typeof path === 'string' && path.startsWith('wfl/definition/'),
    )
    expect(oldPaths).toHaveLength(0)
  })
})

describe('DCL WFL process-definition route registration', () => {
  it('registers the DCL wfl-process-definition page under the dcl domain', () => {
    const registration = pageRegistrations.find(
      (r) => r.domain === 'dcl' && r.entity === 'wfl-process-definition',
    )
    expect(registration).toBeDefined()
    expect(registration!.entityTitle).toBe('流程定义申报')
    expect(registration!.domainTitle).toBe('申报控制')
    expect(typeof registration!.component).toBe('function')
  })

  it('preserves the existing WFL process-definition registration', () => {
    const wflRegistration = pageRegistrations.find(
      (r) => r.domain === 'wfl' && r.entity === 'process-definition',
    )
    expect(wflRegistration).toBeDefined()
    expect(wflRegistration!.entityTitle).toBe('流程定义')
  })
})

describe('DCL WFL process-definition VM permissions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('checks permissions against /dcl/wfl-process-definition/* paths', () => {
    useSessionStore().permissions = [
      '/dcl/wfl-process-definition/query',
      '/dcl/wfl-process-definition/get',
      '/dcl/wfl-process-definition/create',
      '/dcl/wfl-process-definition/save',
      '/dcl/wfl-process-definition/submit',
      '/dcl/wfl-process-definition/approve',
      '/dcl/wfl-process-definition/versions',
      '/dcl/wfl-process-definition/audit-history',
      '/dcl/wfl-process-definition/enable',
      '/dcl/wfl-process-definition/disable',
      '/wfl/process-definition/trial',
    ]
    mockedPost.mockResolvedValue({ data: {} } as never)

    const vm = createDclWflProcessDefinitionViewModel()
    expect(vm.permissions.value.query).toBe(true)
    expect(vm.permissions.value.get).toBe(true)
    expect(vm.permissions.value.create).toBe(true)
    expect(vm.permissions.value.save).toBe(true)
    expect(vm.permissions.value.submit).toBe(true)
    expect(vm.permissions.value.approve).toBe(true)
    expect(vm.permissions.value.reject).toBe(false)
    expect(vm.permissions.value.unsubmit).toBe(false)
    expect(vm.permissions.value.unapprove).toBe(false)
    expect(vm.permissions.value['create-next']).toBe(false)
    expect(vm.permissions.value['delete-version']).toBe(false)
    expect(vm.permissions.value.versions).toBe(true)
    expect(vm.permissions.value['audit-history']).toBe(true)
    expect(vm.permissions.value.enable).toBe(true)
    expect(vm.permissions.value.disable).toBe(true)
    expect(vm.permissions.value.trial).toBe(true)
  })

  it('requires query and get before exposing a create operation that reloads the draft', async () => {
    const session = useSessionStore()
    session.permissions = ['/dcl/wfl-process-definition/create']
    const vm = createDclWflProcessDefinitionViewModel()

    expect(vm.permissions.value.create).toBe(false)
    await vm.openCreate()
    expect(vm.editorOpen.value).toBe(false)

    session.permissions.push('/dcl/wfl-process-definition/get')
    expect(vm.permissions.value.create).toBe(false)
    session.permissions.push('/dcl/wfl-process-definition/query')
    expect(vm.permissions.value.create).toBe(true)
  })

  it('uses shared filters and labeled mobile definition cards', () => {
    expect(definitionPageSource).toContain('<EntityListControls')
    expect(definitionPageSource).toContain('definition-list__mobile')
    expect(definitionPageSource).toContain('@media (max-width: 700px)')
    expect(definitionPageSource).toContain('启停：')
    expect(definitionPageSource).toContain('更新时间：')
  })

  it('queries and opens a definition through DCL gateway only', async () => {
    useSessionStore().permissions = [
      '/dcl/wfl-process-definition/query',
      '/dcl/wfl-process-definition/get',
      '/dcl/wfl-process-definition/versions',
      '/dcl/wfl-process-definition/audit-history',
    ]
    mockedPost.mockImplementation(((path: string) => {
      if (path === 'dcl/wfl-process-definition/query')
        return Promise.resolve({
          data: {
            items: [listItem],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        })
      if (path === 'dcl/wfl-process-definition/get')
        return Promise.resolve({ data: definition })
      if (path === 'dcl/wfl-process-definition/versions')
        return Promise.resolve({
          data: { items: [], total: 0, page: 1, pageSize: 100 },
        })
      if (path === 'dcl/wfl-process-definition/audit-history')
        return Promise.resolve({
          data: { items: [], total: 0, page: 1, pageSize: 100 },
        })
      return Promise.resolve({ data: {} })
    }) as typeof apiClient.postContract)

    const vm = createDclWflProcessDefinitionViewModel()
    await vm.query()
    expect(vm.rows.value).toHaveLength(1)
    expect(vm.rows.value[0]!.code).toBe('test-flow')

    await vm.openDefinition(vm.rows.value[0]!)
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/wfl-process-definition/get',
      expect.objectContaining({ code: 'test-flow' }),
    )

    await vm.loadVersions()
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/wfl-process-definition/versions',
      expect.objectContaining({ code: 'test-flow' }),
    )

    await vm.loadAudit()
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/wfl-process-definition/audit-history',
      expect.objectContaining({ code: 'test-flow' }),
    )

    const nonDclCalls = mockedPost.mock.calls.filter(
      ([path]) =>
        typeof path === 'string' &&
        !String(path).startsWith('dcl/wfl-process-definition/'),
    )
    expect(nonDclCalls).toHaveLength(0)
  })
})
