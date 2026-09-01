import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclRelationshipViewModel } from '@/pages/dcl/shared/typed-business-archive/vm'
import { useSessionStore } from '@/stores/session'
vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const post = vi.mocked(apiClient.postContract)
describe('DCL typed business archive view model', () => { beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() }); it.each(['other-unit', 'sales-partner'] as const)('creates %s directly without a Party relationship', async (entity) => { useSessionStore().permissions = [`/dcl/${entity}/create`, '/bob/operating-entity/query', ...(entity === 'other-unit' ? ['/aux/settlement-method/query'] : [])]; post.mockResolvedValue({ data: { items: [] } } as never); const vm = useDclRelationshipViewModel(entity); vm.openCreate(); await expect(vm.save({ ...vm.editorModel.value, legalName: '档案甲', displayName: '档案甲', operatingEntityIds: ['OPE-1'], defaultOperatingEntityId: 'OPE-1' })).resolves.toBe(true); expect(post).toHaveBeenCalledWith(`dcl/${entity}/create`, { data: expect.objectContaining({ legalName: '档案甲', operatingEntityIds: ['OPE-1'], defaultOperatingEntityId: 'OPE-1' }) }) }) })

describe('DCL typed business archive strong identifiers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it.each(['other-unit', 'sales-partner'] as const)('round-trips every strong identifier when editing and disabling %s', async (entity) => {
    const view = {
      objectId: `${entity}-1`, entity, code: 'ARC-001', updatedAt: '2026-09-01T00:00:00Z', availableApprovalActions: [],
      approval: { approvalEntryId: `APR-${entity}`, revision: 3, status: 'APPROVED', versionNo: 1 },
      data: { kind: 'ORGANIZATION', legalName: '档案甲', strongIdentifiers: [{ type: 'UNIFIED_SOCIAL_CREDIT_CODE', value: '913500001' }, { type: 'TAX_NUMBER', value: 'TAX-1' }], enabled: true, operatingEntityIds: ['OPE-1'], defaultOperatingEntityId: 'OPE-1', operatingEntities: [{ sourceObjectId: 'OPE-1', code: 'OPE-001', name: '经营主体甲' }], ...(entity === 'other-unit' ? { settlementMethodId: null } : { capabilities: [] }) },
    } as never
    const row = { objectId: view.objectId, code: view.code, availableApprovalActions: [], latestApproved: { approval: view.approval, data: view.data }, openVersion: null } as never
    post.mockImplementation(async (path) => ({
      data: path === `dcl/${entity}/get` ? view : { items: [], total: 0, page: 1, pageSize: 20 },
    }) as never)
    useSessionStore().permissions = [`/dcl/${entity}/get`, `/dcl/${entity}/save`, '/bob/operating-entity/query', ...(entity === 'other-unit' ? ['/aux/settlement-method/query'] : [])]
    const vm = useDclRelationshipViewModel(entity)

    await vm.openEdit(row)

    expect(vm.editorModel.value.strongIdentifiers).toEqual(view.data.strongIdentifiers)
    await expect(vm.save(vm.editorModel.value)).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith(`dcl/${entity}/save`, expect.objectContaining({ data: expect.objectContaining({ strongIdentifiers: view.data.strongIdentifiers }) }))
    post.mockClear()
    post.mockImplementation(async (path) => ({
      data: path === `dcl/${entity}/get` ? view : { items: [], total: 0, page: 1, pageSize: 20 },
    }) as never)

    await expect(vm.changeEnabled(row)).resolves.toBe(true)

    expect(post).toHaveBeenCalledWith(`dcl/${entity}/save`, expect.objectContaining({ data: expect.objectContaining({ enabled: false, strongIdentifiers: view.data.strongIdentifiers }) }))
  })
})
