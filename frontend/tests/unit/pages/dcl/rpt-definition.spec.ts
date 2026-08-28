import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  createRptDefinition,
  getRptDefinitionAuditHistory,
  runRptDefinitionVersionAction,
  type RptDefinition,
} from '@/pages/dcl/rpt-definition/api'
import { createDclRptDefinitionViewModel } from '@/pages/dcl/rpt-definition/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: '01KRPT00000000000000000001',
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
const data = {
  sql: 'SELECT 1 AS value',
  parameters: [],
  columns: [
    {
      alias: 'value',
      name: '值',
      order: 1,
      type: 'INTEGER' as const,
      width: 120,
      visible: true,
    },
  ],
}
const definition: RptDefinition = {
  code: 'test-report',
  definitionId: '01KRPT00000000000000000002',
  name: '测试报表',
  description: '',
  enabled: true,
  revision: 1,
  approval,
  validity: 'VALID',
  data,
}

describe('DCL report definition boundary', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creates, validates, and audits only through typed DCL routes', async () => {
    mockedPost.mockResolvedValue({ data: {} } as never)

    await createRptDefinition({
      name: definition.name,
      description: '',
      data,
    })
    await runRptDefinitionVersionAction('submit', definition, { bookId: 'B1' })
    await getRptDefinitionAuditHistory(definition.code)

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/rpt-definition/create', {
      name: definition.name,
      description: '',
      data,
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/rpt-definition/submit', {
      code: definition.code,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
      validationParameters: { bookId: 'B1' },
    })
    expect(mockedPost).toHaveBeenNthCalledWith(
      3,
      'dcl/rpt-definition/audit-history',
      { code: definition.code, page: 1, pageSize: 100 },
    )
  })

  it('orchestrates the sole maintenance VM without RPT lifecycle permissions', async () => {
    useSessionStore().permissions = [
      '/dcl/rpt-definition/query',
      '/dcl/rpt-definition/get',
      '/dcl/rpt-definition/create',
      '/dcl/rpt-definition/save',
      '/dcl/rpt-definition/submit',
      '/dcl/rpt-definition/versions',
      '/dcl/rpt-definition/audit-history',
    ]
    mockedPost.mockImplementation(((path: string) => {
      if (path === 'dcl/rpt-definition/query')
        return Promise.resolve({
          data: {
            items: [
              {
                code: definition.code,
                definitionId: definition.definitionId,
                name: definition.name,
                description: '',
                enabled: true,
                revision: 1,
                latestApproved: null,
                openVersion: {
                  name: definition.name,
                  description: '',
                  approval,
                  validity: 'VALID',
                },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        })
      if (path === 'dcl/rpt-definition/get')
        return Promise.resolve({ data: definition })
      if (path === 'dcl/rpt-definition/versions')
        return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
      if (path === 'dcl/rpt-definition/audit-history')
        return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
      return Promise.resolve({ data: {} })
    }) as typeof apiClient.postContract)

    const vm = createDclRptDefinitionViewModel()
    await vm.query()
    await vm.openDefinition(vm.rows[0]!)
    await vm.loadVersions()
    await vm.loadAudit()
    await vm.run('submit')

    expect(vm.permissions.submit).toBe(true)
    expect(vm.rows).toHaveLength(1)
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/rpt-definition/get',
      expect.objectContaining({ code: definition.code }),
    )
    expect(mockedPost).toHaveBeenCalledWith(
      'dcl/rpt-definition/submit',
      expect.any(Object),
    )
    expect(mockedPost.mock.calls.some(([path]) => String(path).startsWith('rpt/definition/'))).toBe(false)
  })
})
