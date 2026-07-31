import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
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
    setCsrfToken: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

function row(status: BobStatus = 'DRAFT', enabled = true): BobListItem {
  return {
    objectId: 'OBJ-1',
    entity: 'product',
    code: 'PRD-1',
    objectRevision: 3,
    enabled,
    effectiveVersionId: status === 'EFFECTIVE' ? 'VER-1' : null,
    currentVersion: {
      versionId: 'VER-1',
      version: status === 'EFFECTIVE' ? 2 : 1,
      status,
      revision: 5,
      summary: {
        name: '标准产品',
        unit: '件',
        productKind: 'RAW_MATERIAL',
        inventoryUnitId: 'UNIT-PIECE',
        pricingUnitId: 'UNIT-KG',
        pricingQuantityPerInventoryUnit: '1',
        returnable: false,
        packagingSpecs: [],
        categoryId: '',
        specification: '',
        model: 'M1',
        barcode: '',
        remark: '',
      },
    },
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
      unit: '件',
      productKind: 'RAW_MATERIAL',
      inventoryUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      pricingQuantityPerInventoryUnit: '1',
      returnable: false,
      packagingSpecs: [],
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

function supplierRow(): BobListItem {
  return {
    objectId: 'SUP-1',
    entity: 'supplier',
    code: 'SUP-001',
    objectRevision: 3,
    enabled: true,
    effectiveVersionId: null,
    currentVersion: {
      versionId: 'SUP-VER-1',
      version: 1,
      status: 'DRAFT',
      revision: 5,
      summary: {
        name: '示例供应商',
        supplierType: 'GENERAL',
        salespersonEmployeeId: 'EMP-1',
      },
    },
    updatedAt: '2026-07-24T10:00:00Z',
  }
}

function supplierObjectView(): BobObjectView {
  return {
    objectId: 'SUP-1',
    entity: 'supplier',
    code: 'SUP-001',
    objectRevision: 3,
    enabled: true,
    currentVersionId: 'SUP-VER-1',
    effectiveVersionId: null,
    version: {
      versionId: 'SUP-VER-1',
      version: 1,
      status: 'DRAFT',
      revision: 5,
    },
    data: {
      name: '示例供应商',
      supplierType: 'GENERAL',
      shortName: '',
      settlementMethodId: '',
      salespersonEmployeeId: 'EMP-1',
      taxNumber: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      remark: '',
    },
  }
}

function emptyPage() {
  return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
}

function grant(entity: string, ...actions: string[]) {
  useSessionStore().permissions = actions.map(
    (action) => `/bob/${entity}/${action}`,
  )
}

describe('shared BOB entity configuration and view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('定义全部八类业务对象和完整状态筛选', () => {
    const expectedColumns: Record<string, string[]> = {
      customer: ['编码', '名称', '类型', '状态'],
      supplier: ['编码', '名称', '类型', '状态'],
      employee: ['编码', '姓名', '电话', '入职', '状态'],
      product: ['编码', '名称', '类型', '库存单位', '型号', '状态'],
      service: ['编码', '名称', '单位', '说明', '状态'],
      warehouse: ['编码', '名称', '地址', '联系人', '状态'],
      vehicle: ['编码', '名称', '车牌', '类型', '状态'],
      'fund-account': ['编码', '名称', '银行', '状态'],
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

  it('迁出的辅助对象不再注册为 BOB 页面', () => {
    for (const entity of [
      'category',
      'department',
      'position',
      'settlement-method',
    ]) {
      expect(() => getBobEntityConfig(entity)).toThrow()
    }
  })

  it('供应商要求不可清空的业务员引用，并在引用不可用时阻止提交', async () => {
    grant('supplier', 'create')
    const config = getBobEntityConfig('supplier')
    const vm = useBobEntityViewModel(config)

    vm.openCreate()
    expect(vm.editorFields.value.some((field) => field.key === 'code')).toBe(
      false,
    )

    const salespersonField = vm.editorFields.value.find(
      (field) => field.key === 'salespersonEmployeeId',
    )
    expect(config.emptyForm().salespersonEmployeeId).toBe('')
    expect(config.detailKeys).toContain('salespersonEmployeeId')
    expect(config.requiredKeys).toContain('salespersonEmployeeId')
    expect(config.references?.salespersonEmployeeId).toEqual({
      entity: 'employee',
      label: '业务员',
    })
    expect(salespersonField).toMatchObject({
      label: '业务员',
      required: true,
      clearable: false,
      disabled: true,
      hint: '缺少业务员查询权限。',
    })

    const saved = await vm.save({
      ...config.emptyForm(),
      code: 'SUP-001',
      name: '示例供应商',
    })

    expect(saved).toBe(false)
    expect(vm.editorErrorMessage.value).toBe('请输入业务员。')
    expect(mockedApiClient.post).not.toHaveBeenCalled()
  })

  it('供应商业务员查询只加载有效员工', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = ['/bob/employee/query']
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        items: [
          {
            objectId: 'EMP-1',
            code: 'DEMO-EMP-001',
            currentVersion: { summary: { name: '演示员工' } },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useBobEntityViewModel(getBobEntityConfig('supplier'))
    const form = {
      ...vm.config.emptyForm(),
      code: 'SUP-001',
      name: '示例供应商',
    }

    vm.searchEditorReference('salespersonEmployeeId', 'DEMO-EMP-001', form)
    await vi.advanceTimersByTimeAsync(300)

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/employee/query', {
      page: 1,
      pageSize: 20,
      filters: {
        keyword: 'DEMO-EMP-001',
        status: ['EFFECTIVE'],
      },
      sort: [{ field: 'name', order: 'asc' }],
    })
    expect(
      vm.editorFields.value.find(
        (field) => field.key === 'salespersonEmployeeId',
      )?.options,
    ).toEqual([{ title: 'DEMO-EMP-001 · 演示员工', value: 'EMP-1' }])
  })

  it('按编码保存的引用在详情中补齐编码和名称', async () => {
    useSessionStore().permissions = [
      '/bob/customer/get',
      '/aux/dictionary-item/query',
    ]
    const customerRow = {
      ...row(),
      entity: 'customer',
      code: 'CUS-001',
      currentVersion: {
        ...row().currentVersion,
        summary: { name: '示例客户', customerType: 'DIT-0001' },
      },
    } as BobListItem
    const customerView = {
      ...objectView(),
      entity: 'customer',
      code: 'CUS-001',
      data: {
        name: '示例客户',
        customerType: 'DIT-0001',
        shortName: '',
        settlementMethodId: '',
        salespersonEmployeeId: '',
        taxNumber: '',
        contactName: '',
        contactPhone: '',
        email: '',
        address: '',
        remark: '',
      },
    } as BobObjectView
    mockedApiClient.post
      .mockResolvedValueOnce({ data: customerView })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              objectId: 'TYPE-1',
              code: 'DIT-0001',
              currentVersion: { data: { name: '终端客户' } },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })
    const vm = useBobEntityViewModel(getBobEntityConfig('customer'))

    await vm.openView(customerRow)

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'aux/dictionary-item/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
          dictionaryTypeCode: 'DCT-0001',
          keyword: 'DIT-0001',
          enabled: true,
        },
        sort: [{ field: 'name', order: 'asc' }],
      },
    )
    expect(
      vm.editorFields.value.find((field) => field.key === 'customerType')
        ?.options,
    ).toEqual([{ title: 'DIT-0001 · 终端客户', value: 'DIT-0001' }])
  })

  it('供应商创建和保存发送 salespersonEmployeeId', async () => {
    grant('supplier', 'create', 'query')
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation() })
      .mockResolvedValueOnce(emptyPage())
    const config = getBobEntityConfig('supplier')
    const vm = useBobEntityViewModel(config)
    const form = {
      ...config.emptyForm(),
      code: ' sup-001 ',
      name: ' 示例供应商 ',
      salespersonEmployeeId: 'EMP-1',
    }

    vm.openCreate()
    await vm.save(form)

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/supplier/create',
      {
        data: {
          name: '示例供应商',
          supplierType: 'GENERAL',
          salespersonEmployeeId: 'EMP-1',
        },
      },
    )

    vi.clearAllMocks()
    grant('supplier', 'get', 'save', 'query')
    mockedApiClient.post
      .mockResolvedValueOnce({ data: supplierObjectView() })
      .mockResolvedValueOnce({ data: mutation() })
      .mockResolvedValueOnce(emptyPage())

    await vm.openEdit(supplierRow())
    await vm.save({
      ...config.emptyForm(),
      ...supplierObjectView().data,
      code: 'SUP-001',
      salespersonEmployeeId: 'EMP-2',
    })

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/supplier/save',
      {
        objectId: 'SUP-1',
        versionId: 'SUP-VER-1',
        revision: 5,
        data: {
          name: '示例供应商',
          supplierType: 'GENERAL',
          shortName: '',
          settlementMethodId: '',
          salespersonEmployeeId: 'EMP-2',
          taxNumber: '',
          contactName: '',
          contactPhone: '',
          email: '',
          address: '',
          remark: '',
        },
      },
    )
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
      edit: false,
      delete: false,
      submit: false,
      unapprove: true,
      disable: true,
    })
  })

  it('创建时省略空可选字段，保存时显式发送清空值', async () => {
    grant('product', 'create', 'query', 'get', 'save')
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation() })
      .mockResolvedValueOnce(emptyPage())

    const vm = useBobEntityViewModel(getBobEntityConfig('product'))
    vm.openCreate()
    await vm.save({
      code: ' prd-2 ',
      name: ' 新产品 ',
      unit: ' 件 ',
      productKind: 'RAW_MATERIAL',
      inventoryUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      pricingQuantityPerInventoryUnit: '1',
      returnable: false,
      packagingSpecs: [],
      categoryId: '',
      specification: '',
      model: '',
      barcode: '',
      remark: '',
    })

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/product/create',
      {
        data: {
          name: '新产品',
          unit: '件',
          productKind: 'RAW_MATERIAL',
          inventoryUnitId: 'UNIT-PIECE',
          pricingUnitId: 'UNIT-KG',
          pricingQuantityPerInventoryUnit: '1',
          returnable: false,
          packagingSpecs: [],
        },
      },
    )

    vi.clearAllMocks()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: objectView() })
      .mockResolvedValueOnce({ data: mutation() })
      .mockResolvedValueOnce(emptyPage())
    await vm.openEdit(row())
    await vm.save({
      code: 'PRD-1',
      name: '标准产品',
      unit: '件',
      productKind: 'RAW_MATERIAL',
      inventoryUnitId: 'UNIT-PIECE',
      pricingUnitId: 'UNIT-KG',
      pricingQuantityPerInventoryUnit: '1',
      returnable: false,
      packagingSpecs: [],
      categoryId: '',
      specification: '',
      model: '',
      barcode: '',
      remark: '',
    })

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/product/save',
      {
        objectId: 'OBJ-1',
        versionId: 'VER-1',
        revision: 1,
        data: {
          name: '标准产品',
          unit: '件',
          productKind: 'RAW_MATERIAL',
          inventoryUnitId: 'UNIT-PIECE',
          pricingUnitId: 'UNIT-KG',
          pricingQuantityPerInventoryUnit: '1',
          returnable: false,
          packagingSpecs: [],
          categoryId: '',
          specification: '',
          model: '',
          barcode: '',
          remark: '',
        },
      },
    )
  })

  it('有效对象不能直接进入编辑', async () => {
    grant('product', 'get', 'save', 'unapprove')

    const vm = useBobEntityViewModel(getBobEntityConfig('product'))
    await vm.openEdit(row('EFFECTIVE'))

    expect(mockedApiClient.post).not.toHaveBeenCalled()
  })

  it('提交、审核、反向和启停动作使用当前并发版本', async () => {
    grant(
      'product',
      'query',
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
      .mockResolvedValueOnce({ data: mutation('PENDING') })
      .mockResolvedValueOnce(emptyPage())

    await vm.submitObject(row())
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/product/submit',
      { objectId: 'OBJ-1', versionId: 'VER-1', revision: 5 },
    )

    vi.clearAllMocks()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation('EFFECTIVE') })
      .mockResolvedValueOnce(emptyPage())
    await vm.review(row('PENDING'), 'approve', '不会提交的意见')
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
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
