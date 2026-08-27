import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useOtherUnitViewModel } from '@/pages/bob/other-unit/vm'
import { usePartyViewModel } from '@/pages/bob/party/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    postContract: vi.fn(),
  },
}))

const mocked = vi.mocked(apiClient)

describe('Party 与其他单位页面编排', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = [
      '/bob/party/query',
      '/bob/party/get',
      '/dcl/party/create',
      '/dcl/party/save',
      '/dcl/party/merge-preflight',
      '/dcl/party/merge-confirm',
      '/bob/other-unit/query',
      '/bob/other-unit/get',
      '/bob/other-unit/create',
      '/bob/other-unit/save',
      '/bob/other-unit/delete',
      '/bob/operating-entity/query',
      '/aux/settlement-method/query',
    ]
    mocked.postContract.mockReset()
    mocked.postContract.mockReset()
  })

  it('主体列表只在显式提交时采用筛选并固定每页 20 条', async () => {
    mocked.postContract.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const vm = usePartyViewModel()
    vm.keywordDraft.value = ' 测试机构 '
    vm.kindDraft.value = 'ORGANIZATION'

    expect(mocked.postContract).not.toHaveBeenCalled()
    await vm.submitFilters()

    expect(mocked.postContract).toHaveBeenCalledWith('bob/party/query', {
      page: 1,
      pageSize: 20,
      filters: { keyword: '测试机构', kind: 'ORGANIZATION' },
    })
  })

  it('创建其他单位时原样提交新主体强标识和关系专属字段', async () => {
    mocked.postContract.mockImplementation(async (path: string) => {
      if (path === 'bob/operating-entity/query') {
        return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
      }
      if (path === 'bob/other-unit/query') {
        return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
      }
      if (path === 'aux/reference/query') return { data: [] }
      return { data: {} }
    })
    const scope = effectScope()
    const vm = scope.run(() => useOtherUnitViewModel())!
    vm.openCreate()
    vm.form.value.legalName = ' 测试律所 '
    vm.form.value.identifierType = 'UNIFIED_SOCIAL_CREDIT_CODE'
    vm.form.value.identifierValue = ' 9133-001 '
    vm.form.value.operatingEntityId = 'operating-1'
    vm.form.value.contactName = ' 业务联系人 '

    await expect(vm.save()).resolves.toBe(true)

    expect(mocked.postContract).toHaveBeenCalledWith(
      'bob/other-unit/create',
      expect.objectContaining({
        newParty: expect.objectContaining({
          legalName: '测试律所',
          strongIdentifiers: [
            { type: 'UNIFIED_SOCIAL_CREDIT_CODE', value: '9133-001' },
          ],
        }),
        data: expect.objectContaining({
          operatingEntityId: 'operating-1',
          contactName: '业务联系人',
        }),
      }),
    )
    scope.stop()
  })

  it('按新建或复用主体模式分别执行完整权限门禁', () => {
    const session = useSessionStore()
    const common = [
      '/bob/other-unit/create',
      '/bob/operating-entity/query',
      '/aux/settlement-method/query',
    ]
    session.permissions = [...common, '/dcl/party/create']
    const newPartyVm = useOtherUnitViewModel()
    expect(newPartyVm.canCreate.value).toBe(true)
    expect(newPartyVm.canCreateWithNewParty.value).toBe(true)
    expect(newPartyVm.canCreateWithExistingParty.value).toBe(false)

    session.permissions = [...common, '/bob/party/get', '/bob/party/query']
    const existingPartyVm = useOtherUnitViewModel()
    expect(existingPartyVm.canCreate.value).toBe(true)
    expect(existingPartyVm.canCreateWithNewParty.value).toBe(false)
    expect(existingPartyVm.canCreateWithExistingParty.value).toBe(true)
    existingPartyVm.openCreate()
    expect(existingPartyVm.form.value.partyMode).toBe('EXISTING')
  })

  it('其他单位列表显式提交主体、状态和经营主体筛选', async () => {
    mocked.postContract.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const vm = useOtherUnitViewModel()
    vm.keywordDraft.value = ' 律所 '
    vm.statusDraft.value = ['APPROVED']
    vm.operatingDraft.value = 'operating-1'

    expect(mocked.postContract).not.toHaveBeenCalled()
    await vm.submitFilters()

    expect(mocked.postContract).toHaveBeenCalledWith('bob/other-unit/query', {
      page: 1,
      pageSize: 20,
      filters: {
        keyword: '律所',
        status: ['APPROVED'],
        operatingEntityId: 'operating-1',
      },
    })
  })

  it('经营主体在读取现有关系后不可通过保存载荷变更', async () => {
    mocked.postContract.mockResolvedValueOnce({
      data: {
        objectId: 'other-unit-1',
        code: 'OTU-0001',
        objectRevision: 2,
        enabled: true,
        approval: {
          approvalEntryId: 'version-1',
          versionNo: 1,
          status: 'DRAFT',
          revision: 3,
          createdBy: 'USER-1',
          createdAt: '2026-08-20T00:00:00Z',
          updatedBy: 'USER-1',
          updatedAt: '2026-08-21T00:00:00Z',
          submittedBy: null,
          submittedAt: null,
          approvedBy: null,
          approvedAt: null,
        },
        partyId: 'party-1',
        partyKind: 'ORGANIZATION',
        partyDisplayName: '测试主体',
        operatingEntityId: 'operating-1',
        operatingEntityCode: 'OPE-0001',
        operatingEntityName: '经营主体一',
        data: { operatingEntityId: 'operating-1', contactName: '原联系人' },
        updatedAt: '2026-08-21T00:00:00Z',
      },
    })
    mocked.postContract.mockResolvedValueOnce({ data: [] })
    mocked.postContract.mockResolvedValueOnce({ data: {} })
    mocked.postContract.mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const scope = effectScope()
    const vm = scope.run(() => useOtherUnitViewModel())!
    await vm.open(
      {
        objectId: 'other-unit-1',
        code: 'OTU-0001',
        objectRevision: 1,
        enabled: true,
        approval: {
          approvalEntryId: 'stale',
          versionNo: 1,
          status: 'DRAFT',
          revision: 1,
          createdBy: 'USER-1',
          createdAt: '2026-08-19T00:00:00Z',
          updatedBy: 'USER-1',
          updatedAt: '2026-08-20T00:00:00Z',
          submittedBy: null,
          submittedAt: null,
          approvedBy: null,
          approvedAt: null,
        },
        partyId: 'party-1',
        partyKind: 'ORGANIZATION',
        partyDisplayName: '测试主体',
        operatingEntityId: 'operating-1',
        operatingEntityCode: 'OPE-0001',
        operatingEntityName: '经营主体一',
        data: { operatingEntityId: 'operating-1' },
        updatedAt: '2026-08-20T00:00:00Z',
      },
      'edit',
    )
    vm.form.value.operatingEntityId = 'tampered-operating'
    vm.form.value.contactName = '新联系人'
    await vm.save()

    expect(mocked.postContract).toHaveBeenCalledWith('bob/other-unit/save', {
      objectId: 'other-unit-1',
      approvalEntryId: 'version-1',
      approvalRevision: 3,
      data: expect.not.objectContaining({
        operatingEntityId: expect.anything(),
      }),
    })
    scope.stop()
  })

  it('经营主体远程搜索忽略旧响应并保留已选项', async () => {
    let resolveOld!: (value: unknown) => void
    let resolveNew!: (value: unknown) => void
    const oldResponse = new Promise((resolve) => {
      resolveOld = resolve
    })
    const newResponse = new Promise((resolve) => {
      resolveNew = resolve
    })
    mocked.postContract.mockImplementation(
      async (path: string, input: unknown) => {
        if (path !== 'bob/operating-entity/query') return { data: [] }
        const keyword = (input as { filters?: { keyword?: string } }).filters
          ?.keyword
        return keyword === '旧' ? oldResponse : newResponse
      },
    )
    const scope = effectScope()
    const vm = scope.run(() => useOtherUnitViewModel())!
    vm.form.value.operatingEntityId = 'operating-selected'
    vm.operatingOptions.value = [
      {
        objectId: 'operating-selected',
        approvalEntryId: 'version-selected',
        code: 'OPE-0001',
        name: '已选经营主体',
        title: 'OPE-0001 · 已选经营主体',
      },
    ]

    const oldSearch = vm.searchOperatingEntities('旧')
    const newSearch = vm.searchOperatingEntities('新')
    resolveNew({
      data: {
        items: [
          {
            objectId: 'operating-new',
            code: 'OPE-0002',
            latestApproved: {
              approval: { approvalEntryId: 'version-new' },
              summary: { name: '新结果' },
            },
          },
        ],
      },
    })
    await newSearch
    resolveOld({
      data: {
        items: [
          {
            objectId: 'operating-old',
            code: 'OPE-0003',
            latestApproved: {
              approval: { approvalEntryId: 'version-old' },
              summary: { name: '旧结果' },
            },
          },
        ],
      },
    })
    await oldSearch

    expect(vm.operatingOptions.value.map((item) => item.objectId)).toEqual([
      'operating-selected',
      'operating-new',
    ])
    scope.stop()
  })
})
