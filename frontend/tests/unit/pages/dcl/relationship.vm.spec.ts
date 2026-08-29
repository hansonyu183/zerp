import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclRelationshipViewModel } from '@/pages/dcl/relationship/vm'
import type { DclRelationshipListItem } from '@/pages/dcl/relationship/types'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: 'REL-V1',
  versionNo: 1,
  status: 'APPROVED' as const,
  revision: 2,
  createdBy: 'USER-1',
  createdAt: '2026-08-28T00:00:00Z',
  updatedBy: 'USER-1',
  updatedAt: '2026-08-28T00:00:00Z',
  submittedBy: 'USER-1',
  submittedAt: '2026-08-28T00:00:00Z',
  approvedBy: 'USER-2',
  approvedAt: '2026-08-28T00:00:00Z',
}

const otherUnitRow: DclRelationshipListItem = {
  objectId: 'OUT-1',
  entity: 'other-unit',
  code: 'OUT-0001',
  partyId: 'PARTY-1',
  partyKind: 'ORGANIZATION',
  partyDisplayName: '服务主体',
  operatingEntityId: 'OPE-1',
  operatingEntityCode: 'OPE-0001',
  operatingEntityName: '经营主体',
  enabled: true,
  latestApproved: {
    approval,
    enabled: true,
    data: {
      contactName: '李四',
      contactPhone: '13800000000',
      email: 'service@example.test',
      address: '上海',
      settlementMethodId: 'SET-1',
      settlementMethodApprovalEntryId: 'SET-V1',
      settlementMethodCode: 'SET-0001',
      settlementMethodName: '月结',
      remark: '原始备注',
    },
  },
  openVersion: null,
}

describe('DCL relationship view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('requires the complete create permission and reference-query closure', () => {
    const session = useSessionStore()
    session.permissions = [
      '/dcl/other-unit/create',
      '/bob/party/query',
      '/bob/operating-entity/query',
    ]
    const vm = useDclRelationshipViewModel('other-unit')
    expect(vm.canCreate.value).toBe(false)
    vm.openCreate()
    expect(vm.drawerOpen.value).toBe(false)

    session.permissions.push('/aux/settlement-method/query')
    expect(vm.canCreate.value).toBe(true)
  })

  it('loads the approved detail and preserves its complete snapshot when disabling', async () => {
    useSessionStore().permissions = [
      '/dcl/other-unit/get',
      '/dcl/other-unit/save',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          ...otherUnitRow,
          approval,
          data: otherUnitRow.latestApproved!.data,
          updatedAt: '2026-08-28T00:00:00Z',
        },
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclRelationshipViewModel('other-unit')

    await expect(vm.changeEnabled(otherUnitRow)).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/other-unit/get', {
      objectId: 'OUT-1',
      approvalEntryId: 'REL-V1',
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/other-unit/save', {
      objectId: 'OUT-1',
      approvalEntryId: 'REL-V1',
      approvalRevision: 2,
      enabled: false,
      data: {
        contactName: '李四',
        contactPhone: '13800000000',
        email: 'service@example.test',
        address: '上海',
        settlementMethodId: 'SET-1',
        remark: '原始备注',
      },
    })
  })

  it('requires and submits a trimmed unapprove reason', async () => {
    useSessionStore().permissions = ['/dcl/other-unit/unapprove']
    const vm = useDclRelationshipViewModel('other-unit')
    await expect(vm.reverse(otherUnitRow, 'unapprove', '  ')).resolves.toBe(
      false,
    )
    expect(mockedPost).not.toHaveBeenCalled()

    mockedPost.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    await expect(
      vm.reverse(otherUnitRow, 'unapprove', '  业务调整  '),
    ).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/other-unit/unapprove', {
      objectId: 'OUT-1',
      approvalEntryId: 'REL-V1',
      approvalRevision: 2,
      reason: '业务调整',
    })
  })

  it('unsubmits without collecting or sending a reason', async () => {
    useSessionStore().permissions = ['/dcl/other-unit/unsubmit']
    mockedPost.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const pending = {
      ...otherUnitRow,
      openVersion: {
        ...otherUnitRow.latestApproved!,
        approval: {
          ...otherUnitRow.latestApproved!.approval,
          status: 'PENDING' as const,
        },
      },
    }
    const vm = useDclRelationshipViewModel('other-unit')

    await expect(vm.reverse(pending, 'unsubmit', '')).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/other-unit/unsubmit', {
      objectId: 'OUT-1',
      approvalEntryId: 'REL-V1',
      approvalRevision: 2,
    })
  })
})
