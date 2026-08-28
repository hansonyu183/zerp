import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclPartyViewModel } from '@/pages/dcl/party/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: 'party-v1',
  versionNo: 1,
  status: 'DRAFT' as const,
  revision: 3,
  createdBy: 'user-1',
  createdAt: '2026-08-28T00:00:00Z',
  updatedBy: 'user-1',
  updatedAt: '2026-08-28T00:00:00Z',
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
}
const data = {
  kind: 'ORGANIZATION' as const,
  legalName: '测试机构',
  displayName: '测试',
  strongIdentifiers: [
    { type: 'UNIFIED_SOCIAL_CREDIT_CODE' as const, value: '91330001' },
  ],
}
const row = {
  partyId: 'party-1',
  entity: 'party' as const,
  latestApproved: null,
  openVersion: { approval, data },
  updatedAt: '2026-08-28T00:00:00Z',
}
const view = {
  partyId: 'party-1',
  entity: 'party' as const,
  approval,
  data,
  impactRelationships: [
    {
      objectId: 'customer-1',
      entity: 'customer' as const,
      code: 'CUS-0001',
      operatingEntityId: 'ope-1',
      operatingEntityCode: 'OPE-0001',
      operatingEntityName: '经营主体',
      enabled: true,
      status: 'APPROVED' as const,
      version: 1,
    },
  ],
  updatedAt: '2026-08-28T00:00:00Z',
}

describe('DCL Party view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('only uses DCL query/get/save and preserves the impact preview returned by DCL', async () => {
    useSessionStore().permissions = [
      '/dcl/party/query',
      '/dcl/party/get',
      '/dcl/party/save',
    ]
    mockedPost
      .mockResolvedValueOnce({ data: view })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclPartyViewModel()
    await vm.open(row, 'edit')
    expect(vm.currentView.value?.impactRelationships).toHaveLength(1)
    vm.form.value!.displayName = '新显示名'
    await expect(vm.save()).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/party/get', {
      partyId: 'party-1',
      approvalEntryId: 'party-v1',
    })
    expect(mockedPost).toHaveBeenNthCalledWith(
      2,
      'dcl/party/save',
      expect.objectContaining({
        partyId: 'party-1',
        approvalEntryId: 'party-v1',
        approvalRevision: 3,
        data: expect.objectContaining({ displayName: '新显示名' }),
      }),
    )
    expect(mockedPost.mock.calls.map(([path]) => path)).not.toContain(
      'bob/party/save',
    )
  })

  it('uses the source and target approval entries and revisions for DCL merge preflight', async () => {
    useSessionStore().permissions = [
      '/dcl/party/query',
      '/dcl/party/get',
      '/dcl/party/merge-preflight',
      '/dcl/party/merge-confirm',
    ]
    const approved = {
      ...approval,
      approvalEntryId: 'party-v2',
      status: 'APPROVED' as const,
      revision: 5,
    }
    const target = {
      partyId: 'party-2',
      entity: 'party' as const,
      latestApproved: {
        approval: approved,
        data: { ...data, legalName: '保留主体' },
      },
      openVersion: null,
      updatedAt: '2026-08-28T00:00:00Z',
    }
    mockedPost.mockResolvedValueOnce({ data: view }).mockResolvedValueOnce({
      data: {
        preflightId: 'merge-1',
        canMerge: true,
        sourcePartyId: 'party-1',
        targetPartyId: 'party-2',
        sourceApprovalEntryId: 'party-v1',
        targetApprovalEntryId: 'party-v2',
        sourceApprovalRevision: 3,
        targetApprovalRevision: 5,
        blockReasons: [],
        relationshipConflicts: [],
      },
    })
    const vm = useDclPartyViewModel()
    await vm.open(row, 'view')
    vm.openMerge()
    vm.mergeTarget.value = target
    await expect(vm.preflightMerge()).resolves.toBe(true)
    expect(mockedPost).toHaveBeenLastCalledWith('dcl/party/merge-preflight', {
      sourcePartyId: 'party-1',
      targetPartyId: 'party-2',
      sourceApprovalEntryId: 'party-v1',
      targetApprovalEntryId: 'party-v2',
      sourceApprovalRevision: 3,
      targetApprovalRevision: 5,
    })
  })

  it('awaits list refresh after lifecycle actions and requires the exact DCL permission', async () => {
    const session = useSessionStore()
    session.permissions = ['/dcl/party/query', '/dcl/party/submit']
    const vm = useDclPartyViewModel()
    expect(vm.permissions(row).submit).toBe(true)
    mockedPost.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    await expect(vm.runAction(row, 'submit')).resolves.toBe(true)
    expect(mockedPost.mock.calls.map(([path]) => path)).toEqual([
      'dcl/party/submit',
      'dcl/party/query',
    ])
    session.permissions = ['/bob/party/submit']
    expect(vm.permissions(row).submit).toBe(false)
  })

  it('only offers deletion for a later draft candidate with an approved fallback', () => {
    useSessionStore().permissions = ['/dcl/party/delete']
    const vm = useDclPartyViewModel()
    expect(vm.permissions(row).delete).toBe(false)
    const laterCandidate = {
      ...row,
      latestApproved: {
        approval: { ...approval, status: 'APPROVED' as const },
        data,
      },
      openVersion: {
        approval: { ...approval, approvalEntryId: 'party-v2', versionNo: 2 },
        data,
      },
    }
    expect(vm.permissions(laterCandidate).delete).toBe(true)
  })
})
