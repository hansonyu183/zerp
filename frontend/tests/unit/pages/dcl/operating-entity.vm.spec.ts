import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclOperatingEntityViewModel } from '@/pages/dcl/operating-entity/vm'
import type { DclOperatingEntityListItem } from '@/pages/dcl/operating-entity/types'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    postContract: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedPost = vi.mocked(apiClient.postContract)

function approval(status: 'DRAFT' | 'PENDING' | 'APPROVED' = 'DRAFT') {
  return {
    approvalEntryId: 'ENTRY-1',
    versionNo: 1,
    status,
    revision: 2,
    createdBy: 'USER-1',
    createdAt: '2026-08-27T06:00:00Z',
    updatedBy: 'USER-1',
    updatedAt: '2026-08-27T06:00:00Z',
    submittedBy: status === 'PENDING' ? 'USER-2' : null,
    submittedAt: status === 'PENDING' ? '2026-08-27T06:30:00Z' : null,
    approvedBy: status === 'APPROVED' ? 'USER-2' : null,
    approvedAt: status === 'APPROVED' ? '2026-08-27T07:00:00Z' : null,
  } as const
}

function row(
  status: 'DRAFT' | 'PENDING' | 'APPROVED' = 'DRAFT',
  enabled = true,
  availableApprovalActions: DclOperatingEntityListItem['availableApprovalActions'] = [],
): DclOperatingEntityListItem {
  const version = {
    approval: approval(status),
    data: {
      name: '测试经营主体',
      shortName: '',
      taxNumber: '',
      address: '',
      phone: '',
      remark: '',
    },
    enabled,
  }
  return {
    objectId: 'OBJECT-1',
    entity: 'operating-entity',
    code: 'OPE-0001',
    enabled,
    availableApprovalActions,
    latestApproved: status === 'APPROVED' ? version : null,
    openVersion: status === 'APPROVED' ? null : version,
    updatedAt: '2026-08-27T06:00:00Z',
  }
}

function emptyPage() {
  return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
}

function objectView(status: 'DRAFT' | 'PENDING' | 'APPROVED' = 'DRAFT') {
  return {
    objectId: 'OBJECT-1',
    entity: 'operating-entity' as const,
    code: 'OPE-0001',
    enabled: true,
    approval: approval(status),
    data: {
      name: '测试经营主体',
      shortName: '',
      taxNumber: '',
      address: '',
      phone: '',
      remark: '',
    },
    updatedAt: '2026-08-27T06:00:00Z',
  }
}

describe('DCL operating entity view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('只通过 DCL 候选接口查询并规范化类型化快照', async () => {
    useSessionStore().permissions = [
      '/dcl/operating-entity/query',
      '/dcl/operating-entity/create',
      '/bob/operating-entity/get',
    ]
    mockedPost.mockResolvedValueOnce({
      data: {
        items: [
          {
            objectId: 'OBJECT-1',
            entity: 'operating-entity',
            code: 'OPE-0001',
            enabled: true,
            availableApprovalActions: [],
            latestApproved: null,
            openVersion: {
              approval: approval(),
              data: {
                name: '申报中的经营主体',
                shortName: '申报主体',
                taxNumber: '91310000DCL',
                address: '',
                phone: '',
                remark: '',
              },
              enabled: true,
            },
            updatedAt: '2026-08-27T06:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useDclOperatingEntityViewModel()

    await vm.query()

    expect(mockedPost).toHaveBeenCalledWith('dcl/operating-entity/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(vm.rows.value[0]?.openVersion?.data).toMatchObject({
      name: '申报中的经营主体',
      taxNumber: '91310000DCL',
    })
    expect(vm.canCreate.value).toBe(true)
    expect(vm.actionAvailability(vm.rows.value[0]!).view).toBe(false)
  })

  it('新建和生命周期动作只调用 DCL 写接口', async () => {
    useSessionStore().permissions = [
      '/dcl/operating-entity/query',
      '/dcl/operating-entity/get',
      '/dcl/operating-entity/create',
      '/dcl/operating-entity/submit',
      '/dcl/operating-entity/approve',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          objectId: 'OBJECT-1',
          enabled: true,
          approval: approval(),
        },
      })
      .mockResolvedValueOnce(emptyPage())
    const vm = useDclOperatingEntityViewModel()

    vm.openCreate()
    await expect(
      vm.save({
        ...vm.config.emptyForm(),
        name: ' 新经营主体 ',
        shortName: '',
        taxNumber: ' 91310000dcl ',
      }),
    ).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'dcl/operating-entity/create',
      {
        data: {
          name: '新经营主体',
          taxNumber: '91310000DCL',
        },
      },
    )

    vi.clearAllMocks()
    mockedPost
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(emptyPage())
    await expect(vm.submitObject(row('DRAFT', true, ['submit']))).resolves.toBe(
      true,
    )
    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'dcl/operating-entity/submit',
      {
        objectId: 'OBJECT-1',
        approvalEntryId: 'ENTRY-1',
        approvalRevision: 2,
      },
    )

    vi.clearAllMocks()
    mockedPost
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(emptyPage())
    await expect(
      vm.review(row('PENDING', true, ['approve']), 'approve', ''),
    ).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'dcl/operating-entity/approve',
      {
        objectId: 'OBJECT-1',
        approvalEntryId: 'ENTRY-1',
        approvalRevision: 2,
      },
    )
    expect(
      mockedPost.mock.calls.some(([path]) => String(path).startsWith('bob/')),
    ).toBe(false)
  })

  it('生命周期资格只消费服务端动作数组', () => {
    useSessionStore().permissions = ['/dcl/operating-entity/approve']
    const vm = useDclOperatingEntityViewModel()
    const pending = row('PENDING', true, ['unsubmit'])

    expect(vm.actionAvailability(pending)).toMatchObject({
      submit: false,
      unsubmit: true,
      reject: false,
      approve: false,
      unapprove: false,
    })
  })

  it('版本和审计只通过 DCL 历史接口读取', async () => {
    useSessionStore().permissions = [
      '/dcl/operating-entity/versions',
      '/dcl/operating-entity/audit-history',
    ]
    mockedPost
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              approval: approval('APPROVED'),
              data: { name: '正式经营主体', taxNumber: '91310000DCL' },
              enabled: true,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclOperatingEntityViewModel()
    const approved = row('APPROVED')

    await vm.openVersions(approved)
    await vm.openAudit(approved)

    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'dcl/operating-entity/versions',
      { objectId: 'OBJECT-1', page: 1, pageSize: 20 },
    )
    expect(vm.versions.value[0]).toMatchObject({
      approval: { approvalEntryId: 'ENTRY-1' },
      data: { name: '正式经营主体', taxNumber: '91310000DCL' },
    })
    expect(mockedPost).toHaveBeenNthCalledWith(
      2,
      'dcl/operating-entity/audit-history',
      { objectId: 'OBJECT-1', page: 1, pageSize: 20 },
    )
  })

  it('编辑正式版本和启停都通过 DCL save 生成候选', async () => {
    useSessionStore().permissions = [
      '/dcl/operating-entity/query',
      '/dcl/operating-entity/get',
      '/dcl/operating-entity/save',
    ]
    mockedPost
      .mockResolvedValueOnce({ data: objectView('APPROVED') })
      .mockResolvedValueOnce({
        data: {
          objectId: 'OBJECT-1',
          enabled: true,
          approval: { ...approval(), approvalEntryId: 'ENTRY-2' },
        },
      })
      .mockResolvedValueOnce(emptyPage())
    const vm = useDclOperatingEntityViewModel()
    const approved = row('APPROVED')

    await vm.openEdit(approved)
    await expect(
      vm.save({
        ...vm.config.emptyForm(),
        name: '变更后的经营主体',
      }),
    ).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/operating-entity/save', {
      objectId: 'OBJECT-1',
      approvalEntryId: 'ENTRY-1',
      approvalRevision: 2,
      enabled: true,
      data: { name: '变更后的经营主体' },
    })

    vi.clearAllMocks()
    mockedPost
      .mockResolvedValueOnce({ data: objectView('APPROVED') })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(emptyPage())
    await expect(vm.changeEnabled(approved)).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/operating-entity/save', {
      objectId: 'OBJECT-1',
      approvalEntryId: 'ENTRY-1',
      approvalRevision: 2,
      enabled: false,
      data: objectView('APPROVED').data,
    })
  })

  it('保存失败后刷新列表和已打开详情且不重放保存', async () => {
    useSessionStore().permissions = [
      '/dcl/operating-entity/query',
      '/dcl/operating-entity/get',
      '/dcl/operating-entity/save',
    ]
    const refreshed = {
      ...objectView(),
      approval: { ...approval(), revision: 3 },
      data: { ...objectView().data, name: '服务端最新经营主体' },
    }
    mockedPost
      .mockResolvedValueOnce({ data: objectView() })
      .mockRejectedValueOnce(new Error('approval stale revision'))
      .mockResolvedValueOnce({
        data: { items: [row()], total: 1, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({ data: refreshed })
    const vm = useDclOperatingEntityViewModel()

    await vm.openEdit(row())
    await expect(
      vm.save({ ...vm.config.emptyForm(), name: '本地旧编辑' }),
    ).resolves.toBe(false)

    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'dcl/operating-entity/save',
      ),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'dcl/operating-entity/query',
      ),
    ).toHaveLength(1)
    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'dcl/operating-entity/get',
      ),
    ).toHaveLength(2)
    expect(vm.currentView.value?.approval.revision).toBe(3)
    expect(vm.editorModel.value.name).toBe('服务端最新经营主体')
    expect(vm.editorErrorMessage.value).toBe('操作失败，请稍后重试。')
  })

  it('启停必须同时具备 get 与 save 权限', () => {
    const session = useSessionStore()
    session.permissions = ['/dcl/operating-entity/save']
    const vm = useDclOperatingEntityViewModel()

    expect(vm.actionAvailability(row('APPROVED', true)).disable).toBe(false)
    expect(vm.actionAvailability(row('APPROVED', false)).enable).toBe(false)

    session.permissions.push('/dcl/operating-entity/get')
    expect(vm.actionAvailability(row('APPROVED', true)).disable).toBe(true)
    expect(vm.actionAvailability(row('APPROVED', false)).enable).toBe(true)
  })

  it('撤回成功提示和 loading 必须等待列表刷新完成', async () => {
    useSessionStore().permissions = [
      '/dcl/operating-entity/query',
      '/dcl/operating-entity/unsubmit',
    ]
    let finishQuery!: (value: ReturnType<typeof emptyPage>) => void
    mockedPost.mockResolvedValueOnce({ data: {} }).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishQuery = resolve
        }),
    )
    const vm = useDclOperatingEntityViewModel()

    const pending = vm.reverse(
      row('PENDING', true, ['unsubmit']),
      'unsubmit',
      '退回修改',
    )
    await vi.waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2))
    expect(vm.successMessage.value).toBeNull()
    expect(vm.actionLoading.value).toBe('unsubmit:OBJECT-1')

    finishQuery(emptyPage())
    await expect(pending).resolves.toBe(true)
    expect(vm.successMessage.value).toBe('OPE-0001 已撤回。')
    expect(vm.actionLoading.value).toBeNull()
  })

  it('生命周期动作失败后刷新服务端资格且不重放动作', async () => {
    useSessionStore().permissions = ['/dcl/operating-entity/query']
    mockedPost
      .mockRejectedValueOnce(new Error('approval entry changed'))
      .mockResolvedValueOnce({
        data: {
          items: [row('PENDING', true, [])],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })
    const vm = useDclOperatingEntityViewModel()

    await expect(
      vm.review(row('PENDING', true, ['approve']), 'approve', ''),
    ).resolves.toBe(false)

    expect(mockedPost).toHaveBeenCalledTimes(2)
    expect(
      mockedPost.mock.calls.filter(
        ([path]) => path === 'dcl/operating-entity/approve',
      ),
    ).toHaveLength(1)
    expect(mockedPost).toHaveBeenNthCalledWith(
      2,
      'dcl/operating-entity/query',
      {
        page: 1,
        pageSize: 20,
        filters: {},
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    expect(vm.actionAvailability(vm.rows.value[0]!).approve).toBe(false)
    expect(vm.errorMessage.value).toBe('操作失败，请稍后重试。')
  })

  it('删除和生命周期动作使用 DCL，撤回不发送原因', async () => {
    useSessionStore().permissions = [
      '/dcl/operating-entity/query',
      '/dcl/operating-entity/delete',
      '/dcl/operating-entity/unsubmit',
      '/dcl/operating-entity/reject',
      '/dcl/operating-entity/unapprove',
    ]
    const vm = useDclOperatingEntityViewModel()

    for (const [action, target, reason, path] of [
      [
        'unsubmit',
        row('PENDING', true, ['unsubmit']),
        ' 退回修改 ',
        'unsubmit',
      ],
      ['reject', row('PENDING', true, ['reject']), ' 资料不全 ', 'reject'],
      [
        'unapprove',
        row('APPROVED', true, ['unapprove']),
        ' 重新申报 ',
        'unapprove',
      ],
    ] as const) {
      vi.clearAllMocks()
      mockedPost
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce(emptyPage())
      const succeeded =
        action === 'reject'
          ? await vm.review(target, action, reason)
          : await vm.reverse(target, action, reason)
      expect(succeeded).toBe(true)
      expect(mockedPost).toHaveBeenNthCalledWith(
        1,
        `dcl/operating-entity/${path}`,
        action === 'unsubmit'
          ? {
              objectId: 'OBJECT-1',
              approvalEntryId: 'ENTRY-1',
              approvalRevision: 2,
            }
          : {
              objectId: 'OBJECT-1',
              approvalEntryId: 'ENTRY-1',
              approvalRevision: 2,
              reason: reason.trim(),
            },
      )
    }

    vi.clearAllMocks()
    mockedPost
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(emptyPage())
    await expect(vm.deleteObject(row())).resolves.toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'dcl/operating-entity/delete',
      {
        objectId: 'OBJECT-1',
        approvalEntryId: 'ENTRY-1',
        approvalRevision: 2,
      },
    )
  })
})
