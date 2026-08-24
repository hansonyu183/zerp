import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import { getBobEntityConfig, statusOptions } from '@/pages/bob/shared/config'
import { useBobEntityViewModel } from '@/pages/bob/shared/vm'
import type {
  BobListItem,
  BobMutationResult,
  BobObjectView,
  BobStatus,
} from '@/pages/bob/shared/types'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    postContract: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

function row(status: BobStatus = 'DRAFT', enabled = true): BobListItem {
  const version = {
    versionId: 'VER-1',
    version: status === 'EFFECTIVE' ? 2 : 1,
    status,
    revision: 5,
    submittedBy: null,
    summary: {
      name: '标准产品',
      productTypeId: 'TYPE-RAW',
      behaviorProfile: 'RAW_MATERIAL',
      defaultInputUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      unitConversions: [
        { unit: { objectId: 'UNIT-PIECE' }, factor: '1' },
        { unit: { objectId: 'UNIT-KG' }, factor: '1' },
      ],
      returnable: false,
      defaultPackagingSpec: '1',
      categoryId: '',
      specification: '',
      model: 'M1',
      barcode: '',
      remark: '',
    },
  } satisfies NonNullable<BobListItem['effective']>
  return {
    objectId: 'OBJ-1',
    entity: 'product',
    code: 'PRD-1',
    objectRevision: 3,
    enabled,
    effective: status === 'EFFECTIVE' ? version : null,
    candidate: status === 'EFFECTIVE' ? null : version,
    updatedAt: '2026-07-24T10:00:00Z',
  }
}

function objectView(versionId = 'VER-1'): BobObjectView {
  return {
    objectId: 'OBJ-1',
    entity: 'product',
    code: 'PRD-1',
    objectRevision: 4,
    enabled: true,
    currentVersionId: versionId,
    effectiveVersionId: null,
    version: {
      versionId,
      version: 2,
      status: 'DRAFT',
      revision: 1,
    },
    data: {
      name: '标准产品',
      productTypeId: 'TYPE-RAW',
      behaviorProfile: 'RAW_MATERIAL',
      defaultInputUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      unitConversions: [
        { unit: { objectId: 'UNIT-PIECE' }, factor: '1' },
        { unit: { objectId: 'UNIT-KG' }, factor: '1' },
      ],
      returnable: false,
      defaultPackagingSpec: '1',
      categoryId: '',
      specification: '',
      model: 'M1',
      barcode: '',
      remark: '',
    },
  }
}

function mutation(status: BobStatus = 'DRAFT'): BobMutationResult {
  return {
    objectId: 'OBJ-1',
    objectRevision: 4,
    enabled: true,
    versionId: 'VER-2',
    version: 2,
    status,
    revision: 1,
  }
}

function emptyPage() {
  return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
}

function grant(entity: string, ...actions: string[]) {
  useSessionStore().permissions = [
    ...actions.map((action) => `/bob/${entity}/${action}`),
    ...(entity === 'product'
      ? [
          '/bob/product/query',
          '/aux/product-type/query',
          '/aux/measurement-unit/query',
          '/aux/product-category/query',
        ]
      : []),
  ]
}

describe('shared BOB entity configuration and view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('通过对象深链接标识打开现有编辑抽屉并复用详情 revision', async () => {
    grant('product', 'get', 'save')
    mockedApiClient.post.mockResolvedValueOnce({ data: objectView() })
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    await vm.openById('OBJ-1', 'edit')

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/product/get', {
      objectId: 'OBJ-1',
    })
    expect(vm.drawerOpen.value).toBe(true)
    expect(vm.editorMode.value).toBe('edit')
    expect(vm.currentView.value?.version.revision).toBe(1)
  })

  it('详情请求失败时不展示默认值空抽屉', async () => {
    grant('product', 'get')
    mockedApiClient.post.mockRejectedValueOnce(new Error('详情加载失败'))
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    await vm.openView(row())

    expect(vm.drawerOpen.value).toBe(false)
    expect(vm.currentView.value).toBeNull()
    expect(vm.editorErrorMessage.value).toBe('详情加载失败')
  })

  it('产品编辑入口要求全部编辑器引用查询权限', async () => {
    useSessionStore().permissions = [
      '/bob/product/create',
      '/bob/product/get',
      '/bob/product/save',
      '/aux/product-type/query',
      '/aux/measurement-unit/query',
    ]
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    expect(vm.canCreate.value).toBe(false)
    expect(vm.actionAvailability(row()).edit).toBe(false)

    useSessionStore().permissions = [
      ...useSessionStore().permissions,
      '/aux/product-category/query',
    ]
    expect(vm.canCreate.value).toBe(false)
    expect(vm.actionAvailability(row()).edit).toBe(false)

    useSessionStore().permissions.push('/bob/product/query')
    expect(vm.canCreate.value).toBe(true)
    expect(vm.actionAvailability(row()).edit).toBe(true)
  })

  it('定义仍使用通用工作区的六类业务对象和完整状态筛选', () => {
    const expectedColumns: Record<string, string[]> = {
      supplier: ['编码', '主体名称', '状态'],
      product: ['编码', '名称', '产品类型', '默认录入单位', '型号', '状态'],
      warehouse: ['编码', '名称', '仓库负责人', '地址', '联系人', '状态'],
      vehicle: ['编码', '名称', '车牌', '类型', '状态'],
      'fund-account': ['编码', '名称', '银行', '状态'],
      'operating-entity': ['编码', '法定公司名称', '税号', '状态'],
    }

    for (const [entity, columns] of Object.entries(expectedColumns)) {
      const config = getBobEntityConfig(entity)
      expect(config.entity).toBe(entity)
      expect(config.detailKeys).toContain('name')
      expect(config.columns.map((column) => column.label)).toEqual(columns)
      expect(config.filters[0]).toMatchObject({
        key: 'status',
        multiple: true,
      })
    }
    expect(statusOptions).toHaveLength(4)
  })

  it('迁出的辅助对象和员工不再注册为通用 BOB 页面', () => {
    for (const entity of ['category', 'department', 'position', 'employee']) {
      expect(() => getBobEntityConfig(entity)).toThrow()
    }
  })

  it('阻止提交人审核自己的待审核版本并说明原因', () => {
    grant('product', 'get', 'approve', 'reject')
    const session = useSessionStore()
    session.user = {
      id: 'USER-1',
      username: 'reviewer',
      displayName: '审核人',
    }
    const pending = row('PENDING')
    pending.candidate!.submittedBy = 'USER-1'
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    expect(vm.actionAvailability(pending).approve).toBe(false)
    expect(vm.actionAvailability(pending).reject).toBe(false)
    expect(vm.actionBlockedReason(pending, 'approve')).toBe(
      '提交人不能审核自己提交的版本，请由其他审核人处理。',
    )

    pending.candidate!.submittedBy = 'USER-2'
    expect(vm.actionAvailability(pending).approve).toBe(true)
  })

  it('只发送有值的完整查询筛选', async () => {
    grant('product', 'query')
    mockedApiClient.post.mockResolvedValueOnce(emptyPage())
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))
    vm.keyword.value = '  标准  '
    vm.filters.value.status = ['DRAFT', 'EFFECTIVE']
    vm.filters.value.categoryId = 'CAT-1'

    await vm.query()

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/product/query', {
      page: 1,
      pageSize: 20,
      filters: {
        keyword: '标准',
        status: ['DRAFT', 'EFFECTIVE'],
        categoryId: 'CAT-1',
      },
      sort: [{ field: 'code', order: 'asc' }],
    })
  })

  it('产品提交和批准入口要求详情读取权限', () => {
    grant('product', 'submit', 'approve')
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    expect(vm.actionAvailability(row()).submit).toBe(false)
    expect(vm.actionAvailability(row('PENDING')).approve).toBe(false)

    useSessionStore().permissions.push('/bob/product/get')
    expect(vm.actionAvailability(row()).submit).toBe(true)
    expect(vm.actionAvailability(row('PENDING')).approve).toBe(true)
  })

  it('分页变化时重新查询并保持固定页大小', async () => {
    grant('product', 'query')
    mockedApiClient.post.mockResolvedValueOnce({
      data: { items: [], total: 0, page: 2, pageSize: 20 },
    })
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    await vm.changePage(2)

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      'bob/product/query',
      expect.objectContaining({ page: 2, pageSize: 20 }),
    )
  })

  it('按状态和精确权限计算完整动作集合', () => {
    grant(
      'product',
      'get',
      'save',
      'delete',
      'submit',
      'unsubmit',
      'approve',
      'unapprove',
      'reject',
      'enable',
      'disable',
      'versions',
      'audit-history',
    )
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    expect(vm.actionAvailability(row())).toEqual({
      view: true,
      edit: true,
      delete: true,
      submit: true,
      unsubmit: false,
      approve: false,
      unapprove: false,
      reject: false,
      enable: false,
      disable: false,
      versions: true,
      audit: true,
    })
    expect(vm.actionAvailability(row('PENDING'))).toMatchObject({
      edit: false,
      delete: false,
      submit: false,
      unsubmit: true,
      approve: true,
      reject: true,
    })
    expect(vm.actionAvailability(row('EFFECTIVE'))).toMatchObject({
      edit: true,
      delete: false,
      submit: false,
      unapprove: true,
      disable: true,
    })
  })

  it('创建时省略空可选字段，保存时显式发送清空值', async () => {
    grant('product', 'create', 'query', 'get', 'save')
    let persistedName = '标准产品'
    mockedApiClient.post.mockImplementation(async (path) => {
      if (path === 'bob/product/create') {
        persistedName = '新产品'
        return { data: mutation() }
      }
      if (path === 'bob/product/save') {
        persistedName = '标准产品'
        return { data: mutation() }
      }
      if (path === 'bob/product/get') {
        const view = objectView()
        view.data.model = ''
        view.data.name = persistedName
        return { data: view }
      }
      return emptyPage()
    })

    const vm = useBobEntityViewModel(getBobEntityConfig('product'))
    vm.openCreate()
    const savedCreated = await vm.save({
      code: ' prd-2 ',
      name: ' 新产品 ',
      productTypeId: 'TYPE-RAW',
      behaviorProfile: 'RAW_MATERIAL',
      defaultInputUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      unitConversions: [
        { unit: { objectId: 'UNIT-PIECE' }, factor: '1' },
        { unit: { objectId: 'UNIT-KG' }, factor: '1' },
      ],
      returnable: false,
      defaultPackagingSpec: '1',
      categoryId: '',
      specification: '',
      model: '',
      barcode: '',
      remark: '',
    })

    expect(
      savedCreated,
      `${vm.editorErrorMessage.value ?? ''} ${JSON.stringify(mockedApiClient.post.mock.calls)}`,
    ).toBe(true)

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/product/create', {
      data: {
        name: '新产品',
        productTypeId: 'TYPE-RAW',
        defaultInputUnitId: 'UNIT-PIECE',
        pricingUnitId: 'UNIT-KG',
        unitConversions: [
          { unit: { objectId: 'UNIT-PIECE' }, factor: '1' },
          { unit: { objectId: 'UNIT-KG' }, factor: '1' },
        ],
        returnable: false,
        defaultPackagingSpec: '1',
      },
    })

    vi.clearAllMocks()
    await vm.openEdit(row())
    const savedUpdate = await vm.save({
      code: 'PRD-1',
      name: '标准产品',
      productTypeId: 'TYPE-RAW',
      behaviorProfile: 'RAW_MATERIAL',
      defaultInputUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      unitConversions: [
        { unit: { objectId: 'UNIT-PIECE' }, factor: '1' },
        { unit: { objectId: 'UNIT-KG' }, factor: '1' },
      ],
      returnable: false,
      defaultPackagingSpec: '1',
      categoryId: '',
      specification: '',
      model: '',
      barcode: '',
      remark: '',
    })

    expect(savedUpdate, vm.editorErrorMessage.value ?? '').toBe(true)

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/product/save', {
      objectId: 'OBJ-1',
      versionId: 'VER-1',
      revision: 1,
      data: {
        name: '标准产品',
        productTypeId: 'TYPE-RAW',
        defaultInputUnitId: 'UNIT-PIECE',
        pricingUnitId: 'UNIT-KG',
        unitConversions: [
          { unit: { objectId: 'UNIT-PIECE' }, factor: '1' },
          { unit: { objectId: 'UNIT-KG' }, factor: '1' },
        ],
        returnable: false,
        defaultPackagingSpec: '1',
        categoryId: '',
        specification: '',
        model: '',
        barcode: '',
        remark: '',
      },
    })
  })

  it('保存接口成功后立即反馈，不等待列表刷新', async () => {
    grant('fund-account', 'create', 'query')
    let resolveQuery!: (value: ReturnType<typeof emptyPage>) => void
    const pendingQuery = new Promise<ReturnType<typeof emptyPage>>(
      (resolve) => {
        resolveQuery = resolve
      },
    )
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation() })
      .mockReturnValueOnce(pendingQuery)

    const config = getBobEntityConfig('fund-account')
    const vm = useBobEntityViewModel(config)
    vm.openCreate()
    const saving = vm.save({
      ...config.emptyForm(),
      name: '测试资金账户',
      operatingEntityId: 'OPE-1',
    })

    await vi.waitFor(() => {
      expect(mockedApiClient.post).toHaveBeenCalledTimes(2)
    })
    expect(vm.successMessage.value).toBe('资金账户已保存。')
    expect(vm.drawerOpen.value).toBe(false)

    resolveQuery(emptyPage())
    await expect(saving).resolves.toBe(true)
  })

  it('有效产品直接进入候选版本编辑', async () => {
    grant('product', 'get', 'save', 'unapprove')
    const effective = objectView()
    effective.version.status = 'EFFECTIVE'
    mockedApiClient.post.mockResolvedValueOnce({ data: effective })

    const vm = useBobEntityViewModel(getBobEntityConfig('product'))
    await vm.openEdit(row('EFFECTIVE'))

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/product/get', {
      objectId: 'OBJ-1',
      versionId: 'VER-1',
    })
    expect(vm.editorMode.value).toBe('edit')
  })

  it('提交、审核、反向和启停动作使用当前并发版本', async () => {
    grant(
      'product',
      'query',
      'get',
      'submit',
      'unsubmit',
      'approve',
      'unapprove',
      'reject',
      'enable',
      'disable',
      'versions',
      'audit-history',
    )
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))
    mockedApiClient.post
      .mockResolvedValueOnce({ data: objectView() })
      .mockResolvedValueOnce({ data: mutation('PENDING') })
      .mockResolvedValueOnce(emptyPage())

    await vm.submitObject(row())
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/product/submit',
      { objectId: 'OBJ-1', versionId: 'VER-1', revision: 5 },
    )

    vi.clearAllMocks()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: objectView() })
      .mockResolvedValueOnce({ data: mutation('EFFECTIVE') })
      .mockResolvedValueOnce(emptyPage())
    await vm.review(row('PENDING'), 'approve', '不会提交的意见')
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/product/approve',
      {
        objectId: 'OBJ-1',
        versionId: 'VER-1',
        revision: 5,
      },
    )

    vi.clearAllMocks()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation('DRAFT') })
      .mockResolvedValueOnce(emptyPage())
    await vm.review(row('PENDING'), 'reject', ' 资料不完整 ')
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/product/reject',
      {
        objectId: 'OBJ-1',
        versionId: 'VER-1',
        revision: 5,
        comment: '资料不完整',
      },
    )

    vi.clearAllMocks()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation('DRAFT') })
      .mockResolvedValueOnce(emptyPage())
    await vm.reverse(row('PENDING'), 'unsubmit', ' 退回修改 ')
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/product/unsubmit',
      {
        objectId: 'OBJ-1',
        objectRevision: 3,
        versionId: 'VER-1',
        revision: 5,
        reason: '退回修改',
      },
    )

    vi.clearAllMocks()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation('PENDING') })
      .mockResolvedValueOnce(emptyPage())
    await vm.reverse(row('EFFECTIVE'), 'unapprove', ' 重新维护 ')
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/product/unapprove',
      {
        objectId: 'OBJ-1',
        objectRevision: 3,
        versionId: 'VER-1',
        revision: 5,
        reason: '重新维护',
      },
    )

    vi.clearAllMocks()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation('EFFECTIVE') })
      .mockResolvedValueOnce(emptyPage())
    await vm.changeEnabled(row('EFFECTIVE'))
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/product/disable',
      { objectId: 'OBJ-1', objectRevision: 3 },
    )

    vi.clearAllMocks()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation('EFFECTIVE') })
      .mockResolvedValueOnce(emptyPage())
    await vm.changeEnabled(row('EFFECTIVE', false))
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/product/enable',
      { objectId: 'OBJ-1', objectRevision: 3 },
    )
  })

  it('撤回接口成功后立即反馈并在后台刷新列表', async () => {
    grant('product', 'query', 'unsubmit')
    let resolveQuery!: (value: ReturnType<typeof emptyPage>) => void
    const pendingQuery = new Promise<ReturnType<typeof emptyPage>>(
      (resolve) => {
        resolveQuery = resolve
      },
    )
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation('DRAFT') })
      .mockReturnValueOnce(pendingQuery)
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    await expect(
      vm.reverse(row('PENDING'), 'unsubmit', '退回修改'),
    ).resolves.toBe(true)

    expect(mockedApiClient.post).toHaveBeenCalledTimes(2)
    expect(vm.successMessage.value).toBe('PRD-1 已撤回提交。')
    expect(vm.actionLoading.value).toBeNull()

    resolveQuery(emptyPage())
    await vi.waitFor(() => expect(vm.loading.value).toBe(false))
  })

  it('停用被引用资料时显示冲突且不请求接任候选', async () => {
    grant('product', 'query', 'disable')
    mockedApiClient.post.mockRejectedValueOnce(
      new ApiError('business', 'object has active direct references', {
        code: 3001,
        details: {
          references: [
            { entity: 'product', field: 'formula-material', count: 2 },
          ],
        },
      }),
    )
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    await expect(vm.changeEnabled(row('EFFECTIVE'))).resolves.toBe(false)

    expect(mockedApiClient.postContract).not.toHaveBeenCalled()
    expect(vm.errorMessage.value).toBe(
      '该资料仍被当前有效业务对象引用，请先修改引用方资料并完成审核后再停用。',
    )
  })

  it('关联对象搜索带有效状态和实体约束', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = ['/aux/product-category/query']
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        items: [
          {
            objectId: 'CAT-1',
            code: 'CAT-1',
            currentVersion: { data: { name: '产品分类' } },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    vm.searchEditorReference('categoryId', '分类', {
      code: 'PRD-1',
      name: '产品',
      categoryId: '',
    })
    await vi.advanceTimersByTimeAsync(300)

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      'aux/product-category/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
          keyword: '分类',
          enabled: true,
        },
        sort: [{ field: 'name', order: 'asc' }],
      },
    )
  })
})
