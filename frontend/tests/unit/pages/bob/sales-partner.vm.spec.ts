import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useSalesPartnerViewModel } from '@/pages/bob/sales-partner/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
}))

const mockedApiClient = vi.mocked(apiClient)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function page(code: string) {
  return {
    data: {
      items: [
        {
          objectId: code,
          code,
          objectRevision: 1,
          enabled: true,
          partyId: `party-${code}`,
          partyKind: 'ORGANIZATION' as const,
          partyDisplayName: `${code} 主体`,
          operatingEntityId: 'ope-1',
          operatingEntityCode: 'OPE-0001',
          operatingEntityName: '经营主体',
          effective: null,
          candidate: {
            approvalEntryId: `version-${code}`,
            version: 1,
            status: 'DRAFT' as const,
            revision: 1,
            capabilities: ['EXTERNAL_PART_TIME' as const],
            submittedBy: null,
          },
          updatedAt: '2026-08-22T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20 as const,
    },
  }
}

describe('销售合作关系 ViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = [
      '/bob/sales-partner/query',
      '/bob/sales-partner/get',
      '/bob/sales-partner/create',
      '/bob/sales-partner/save',
      '/bob/sales-partner/submit',
      '/bob/sales-partner/approve',
      '/bob/sales-partner/enable',
      '/bob/sales-partner/disable',
      '/bob/party/create',
      '/bob/party/get',
      '/bob/party/query',
      '/bob/operating-entity/query',
    ]
    mockedApiClient.postContract.mockReset()
  })

  it('仅在显式提交筛选后查询，并固定每页 20 条和编码升序', async () => {
    mockedApiClient.postContract.mockResolvedValue(page('SLP-0001'))
    const vm = useSalesPartnerViewModel()
    vm.keywordDraft.value = ' 渠道 '
    vm.capabilityDraft.value = 'CHANNEL_PARTNER'

    expect(mockedApiClient.postContract).not.toHaveBeenCalled()
    await vm.submitFilters()

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/sales-partner/query',
      {
        page: 1,
        pageSize: 20,
        filters: { keyword: '渠道', capability: 'CHANNEL_PARTNER' },
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    expect(vm.rows.value[0]?.code).toBe('SLP-0001')
  })

  it('分别约束新主体和已有主体的创建权限', () => {
    const session = useSessionStore()
    session.permissions = [
      '/bob/sales-partner/query',
      '/bob/sales-partner/create',
      '/bob/operating-entity/query',
      '/bob/party/create',
    ]
    const newPartyVm = useSalesPartnerViewModel()
    expect(newPartyVm.canCreateWithNewParty.value).toBe(true)
    expect(newPartyVm.canCreateWithExistingParty.value).toBe(false)

    session.permissions = [
      '/bob/sales-partner/query',
      '/bob/sales-partner/create',
      '/bob/operating-entity/query',
      '/bob/party/get',
      '/bob/party/query',
    ]
    const existingPartyVm = useSalesPartnerViewModel()
    expect(existingPartyVm.canCreateWithNewParty.value).toBe(false)
    expect(existingPartyVm.canCreateWithExistingParty.value).toBe(true)
  })

  it('允许保存无能力草稿并由提交动作执行能力校验', async () => {
    mockedApiClient.postContract.mockResolvedValueOnce({
      data: {
        objectId: 'slp-draft',
        objectRevision: 1,
        approvalEntryId: 'slp-draft-v1',
        version: 1,
        status: 'DRAFT',
        revision: 1,
      },
    })
    mockedApiClient.postContract.mockResolvedValueOnce({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    const vm = useSalesPartnerViewModel()
    vm.openCreate()
    vm.newParty.value.legalName = '无能力草稿主体'
    vm.operatingEntity.value = {
      objectId: 'ope-1',
      approvalEntryId: 'ope-v1',
      code: 'OPE-0001',
      name: '经营主体',
    }

    expect(vm.data.value.capabilities).toEqual([])
    expect(vm.formValid.value).toBe(true)
    expect(await vm.save()).toBe(true)
    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/sales-partner/create',
      expect.objectContaining({
        data: expect.objectContaining({ capabilities: [] }),
      }),
    )
  })

  it('忽略过期列表与引用搜索响应，并在销毁后不写入状态', async () => {
    const first = deferred<ReturnType<typeof page>>()
    const second = deferred<ReturnType<typeof page>>()
    const oldReferences = deferred<{
      data: Array<{
        objectId: string
        approvalEntryId: string
        code: string
        name: string
      }>
    }>()
    const currentReferences = deferred<{
      data: Array<{
        objectId: string
        approvalEntryId: string
        code: string
        name: string
      }>
    }>()
    mockedApiClient.postContract.mockImplementation((path: string) => {
      if (path === 'bob/sales-partner/query') {
        return mockedApiClient.postContract.mock.calls.filter(
          ([calledPath]) => calledPath === 'bob/sales-partner/query',
        ).length === 1
          ? first.promise
          : second.promise
      }
      return mockedApiClient.postContract.mock.calls.filter(
        ([calledPath]) => calledPath === 'bob/reference/query',
      ).length === 1
        ? oldReferences.promise
        : currentReferences.promise
    })
    const scope = effectScope()
    const vm = scope.run(() => useSalesPartnerViewModel())!

    const oldQuery = vm.submitFilters()
    vm.keywordDraft.value = '最新'
    const currentQuery = vm.submitFilters()
    second.resolve(page('SLP-NEW'))
    await currentQuery
    first.resolve(page('SLP-OLD'))
    await oldQuery
    expect(vm.rows.value.map((item) => item.code)).toEqual(['SLP-NEW'])

    const oldSearch = vm.searchOperatingEntities('旧')
    const currentSearch = vm.searchOperatingEntities('新')
    currentReferences.resolve({
      data: [
        {
          objectId: 'ope-new',
          approvalEntryId: 'v2',
          code: 'OPE-2',
          name: '新主体',
        },
      ],
    })
    await currentSearch
    oldReferences.resolve({
      data: [
        {
          objectId: 'ope-old',
          approvalEntryId: 'v1',
          code: 'OPE-1',
          name: '旧主体',
        },
      ],
    })
    await oldSearch
    expect(vm.operatingOptions.value.map((item) => item.objectId)).toEqual([
      'ope-new',
    ])

    const afterDispose = vm.searchOperatingEntities('销毁后')
    scope.stop()
    currentReferences.resolve({ data: [] })
    await afterDispose
    expect(vm.operatingOptions.value.map((item) => item.objectId)).toEqual([
      'ope-new',
    ])
  })
})
