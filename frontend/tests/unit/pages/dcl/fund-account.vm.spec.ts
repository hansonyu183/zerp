import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclFundAccountViewModel } from '@/pages/dcl/fund-account/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: 'VER-1',
  versionNo: 1,
  status: 'DRAFT' as const,
  revision: 2,
  createdBy: 'USER-1',
  createdAt: '2026-08-28T00:00:00Z',
  updatedBy: 'USER-1',
  updatedAt: '2026-08-28T00:00:00Z',
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
}

describe('DCL fund account view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('queries and submits the DCL candidate without using BOB lifecycle actions', async () => {
    useSessionStore().permissions = [
      '/dcl/fund-account/query',
      '/dcl/fund-account/submit',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              objectId: 'FND-1',
              entity: 'fund-account',
              code: 'FA-0001',
              enabled: true,
              latestApproved: null,
              openVersion: {
                approval,
                enabled: true,
                data: {
                  name: '基本户',
                  currency: 'CNY',
                  operatingEntityId: 'OPE-1',
                },
              },
              updatedAt: '2026-08-28T00:00:00Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclFundAccountViewModel()

    await vm.query()
    await expect(vm.submitObject(vm.rows.value[0]!)).resolves.toBe(true)

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'dcl/fund-account/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/fund-account/submit', {
      objectId: 'FND-1',
      approvalEntryId: 'VER-1',
      approvalRevision: 2,
    })
    expect(mockedPost.mock.calls.map(([path]) => String(path))).not.toContain(
      'bob/fund-account/submit',
    )
  })

  it('creates a DCL account from a current operating-entity selector', async () => {
    useSessionStore().permissions = [
      '/dcl/fund-account/create',
      '/bob/operating-entity/query',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              objectId: 'OPE-1',
              code: 'OPE-0001',
              sourceApprovalEntryId: 'VER-OPE-1',
              sourceVersionNo: 1,
              data: { name: '华东主体' },
            },
          ],
        },
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclFundAccountViewModel()

    vm.openCreate()
    await expect(
      vm.save({
        ...vm.editorModel.value,
        name: '基本户',
        currency: 'cny',
        operatingEntityId: 'OPE-1',
        accountNumber: 'abc-123',
      }),
    ).resolves.toBe(true)

    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'bob/operating-entity/query',
      {
        page: 1,
        pageSize: 20,
        filters: { enabled: true },
        sort: [{ field: 'name', order: 'asc' }],
      },
    )
    expect(
      vm.editorFields.value.find((field) => field.key === 'operatingEntityId')
        ?.options,
    ).toEqual([{ title: 'OPE-0001 · 华东主体', value: 'OPE-1' }])
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/fund-account/create', {
      data: {
        name: '基本户',
        currency: 'CNY',
        operatingEntityId: 'OPE-1',
        accountNumber: 'ABC-123',
      },
    })
  })

  it('does not create or open an editor when operating-entity query permission is missing', async () => {
    useSessionStore().permissions = [
      '/dcl/fund-account/create',
      '/dcl/fund-account/save',
    ]
    const vm = useDclFundAccountViewModel()

    vm.openCreate()

    expect(vm.canCreate.value).toBe(false)
    expect(vm.drawerOpen.value).toBe(false)
    await expect(
      vm.save({
        ...vm.editorModel.value,
        name: '基本户',
        operatingEntityId: 'OPE-1',
      }),
    ).resolves.toBe(false)
    expect(mockedPost).not.toHaveBeenCalled()

    useSessionStore().permissions = [
      '/dcl/fund-account/get',
      '/dcl/fund-account/save',
    ]
    mockedPost.mockResolvedValueOnce({
      data: {
        objectId: 'FND-1',
        entity: 'fund-account',
        code: 'FA-0001',
        enabled: true,
        approval,
        data: {
          name: '基本户',
          currency: 'CNY',
          operatingEntityId: 'OPE-1',
        },
        updatedAt: '2026-08-28T00:00:00Z',
      },
    })
    await vm.openById('FND-1', 'edit')

    expect(vm.editorMode.value).toBe('view')
    expect(mockedPost).toHaveBeenCalledTimes(1)
  })

  it('retains the current operating entity when it is absent from current candidates', async () => {
    useSessionStore().permissions = [
      '/dcl/fund-account/get',
      '/dcl/fund-account/save',
      '/bob/operating-entity/query',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          objectId: 'FND-1',
          entity: 'fund-account',
          code: 'FA-0001',
          enabled: true,
          approval,
          data: {
            name: '基本户',
            currency: 'CNY',
            operatingEntityId: 'OPE-1',
          },
          updatedAt: '2026-08-28T00:00:00Z',
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              objectId: 'OPE-2',
              code: 'OPE-0002',
              sourceApprovalEntryId: 'VER-OPE-2',
              sourceVersionNo: 1,
              data: { name: '其他主体' },
            },
          ],
        },
      })
    const vm = useDclFundAccountViewModel()

    await vm.openById('FND-1', 'edit')
    await Promise.resolve()

    expect(vm.editorMode.value).toBe('edit')
    expect(
      vm.editorFields.value.find((field) => field.key === 'operatingEntityId')
        ?.options,
    ).toEqual([
      { title: 'OPE-0002 · 其他主体', value: 'OPE-2' },
      { title: 'OPE-1', value: 'OPE-1' },
    ])
  })

  it('searches current operating entities and retains the selected stable ID', async () => {
    vi.useFakeTimers()
    try {
      useSessionStore().permissions = [
        '/dcl/fund-account/get',
        '/dcl/fund-account/save',
        '/bob/operating-entity/query',
      ]
      mockedPost
        .mockResolvedValueOnce({
          data: {
            objectId: 'FND-1',
            entity: 'fund-account',
            code: 'FA-0001',
            enabled: true,
            approval,
            data: {
              name: '基本户',
              currency: 'CNY',
              operatingEntityId: 'OPE-1',
            },
            updatedAt: '2026-08-28T00:00:00Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            items: [
              {
                objectId: 'OPE-1',
                code: 'OPE-0001',
                sourceApprovalEntryId: 'VER-OPE-1',
                sourceVersionNo: 1,
                data: { name: '当前主体' },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            items: [
              {
                objectId: 'OPE-2',
                code: 'OPE-0002',
                sourceApprovalEntryId: 'VER-OPE-2',
                sourceVersionNo: 1,
                data: { name: '搜索主体' },
              },
            ],
          },
        })
      const vm = useDclFundAccountViewModel()

      await vm.openById('FND-1', 'edit')
      await Promise.resolve()
      vm.searchEditorReference(
        'operatingEntityId',
        '搜索',
        vm.editorModel.value,
      )
      await vi.advanceTimersByTimeAsync(300)

      expect(mockedPost).toHaveBeenNthCalledWith(
        3,
        'bob/operating-entity/query',
        {
          page: 1,
          pageSize: 20,
          filters: {
            enabled: true,
            keyword: '搜索',
          },
          sort: [{ field: 'name', order: 'asc' }],
        },
      )
      expect(
        vm.editorFields.value.find((field) => field.key === 'operatingEntityId')
          ?.options,
      ).toEqual([
        { title: 'OPE-0002 · 搜索主体', value: 'OPE-2' },
        { title: 'OPE-0001 · 当前主体', value: 'OPE-1' },
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
