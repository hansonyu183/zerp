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

function row(status: BobStatus = 'DRAFT'): BobListItem {
  return {
    objectId: 'OBJ-1',
    entity: 'product',
    code: 'PRD-1',
    objectRevision: 3,
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
      customer: ['编码', '名称', '类型', '版本', '状态', '更新'],
      supplier: ['编码', '名称', '类型', '版本', '状态', '更新'],
      employee: ['编码', '姓名', '电话', '入职', '版本', '状态', '更新'],
      product: ['编码', '名称', '类型', '库存单位', '型号', '版本', '状态', '更新'],
      service: ['编码', '名称', '单位', '说明', '版本', '状态', '更新'],
      warehouse: ['编码', '名称', '地址', '联系人', '版本', '状态', '更新'],
      vehicle: ['编码', '名称', '车牌', '类型', '版本', '状态', '更新'],
      'fund-account': ['编码', '名称', '银行', '版本', '状态', '更新'],
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
    expect(statusOptions).toHaveLength(5)
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
    expect(vm.editorModel.value.code).toMatch(
      /^BOB-SUPPLIER-\d{17}-[A-Z0-9]{6}$/,
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
        items: [{
          objectId: 'EMP-1',
          code: 'DEMO-EMP-001',
          currentVersion: { summary: { name: '演示员工' } },
        }],
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

    vm.searchEditorReference(
      'salespersonEmployeeId',
      'DEMO-EMP-001',
      form,
    )
    await vi.advanceTimersByTimeAsync(300)

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      'bob/employee/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
          keyword: 'DEMO-EMP-001',
          status: ['EFFECTIVE'],
        },
        sort: [{ field: 'name', order: 'asc' }],
      },
    )
    expect(
      vm.editorFields.value.find(
        (field) => field.key === 'salespersonEmployeeId',
      )?.options,
    ).toEqual([{ title: 'DEMO-EMP-001 · 演示员工', value: 'EMP-1' }])
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
          code: 'SUP-001',
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

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      'bob/product/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
          keyword: '标准',
          status: ['DRAFT', 'EFFECTIVE'],
          categoryId: 'CAT-1',
        },
        sort: [{ field: 'updatedAt', order: 'desc' }],
      },
    )
  })

  it('按状态和精确权限计算完整动作集合', () => {
    grant(
      'product',
      'get',
      'edit',
      'save',
      'delete',
      'submit',
      'approve',
      'reject',
      'versions',
      'audit-history',
    )
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    expect(vm.actionAvailability(row())).toEqual({
      view: true,
      edit: true,
      delete: true,
      submit: true,
      approve: false,
      reject: false,
      versions: true,
      audit: true,
    })
    expect(vm.actionAvailability(row('PENDING'))).toMatchObject({
      edit: false,
      delete: false,
      submit: false,
      approve: true,
      reject: true,
    })
    expect(vm.actionAvailability(row('EFFECTIVE'))).toMatchObject({
      edit: true,
      delete: false,
      submit: false,
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
          code: 'PRD-2',
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

  it('有效对象先 edit 再 get，避免使用脱敏摘要编辑', async () => {
    grant('product', 'get', 'edit', 'save')
    mockedApiClient.post
      .mockResolvedValueOnce({ data: mutation() })
      .mockResolvedValueOnce({ data: objectView('VER-2') })

    const vm = useBobEntityViewModel(getBobEntityConfig('product'))
    await vm.openEdit(row('EFFECTIVE'))

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/product/edit',
      { objectId: 'OBJ-1', objectRevision: 3 },
    )
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/product/get',
      { objectId: 'OBJ-1', versionId: 'VER-2' },
    )
    expect(vm.editorModel.value.model).toBe('M1')
  })

  it('提交、驳回和审核历史使用当前版本 revision', async () => {
    grant(
      'product',
      'query',
      'submit',
      'reject',
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
      .mockResolvedValueOnce({ data: mutation('REJECTED') })
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
  })

  it('关联对象搜索带有效状态和实体约束', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = ['/aux/product-category/query']
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        items: [{
          objectId: 'CAT-1',
          code: 'CAT-1',
          currentVersion: { data: { name: '产品分类' } },
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useBobEntityViewModel(getBobEntityConfig('product'))

    vm.searchEditorReference(
      'categoryId',
      '分类',
      {
        code: 'PRD-1',
        name: '产品',
        categoryId: '',
      },
    )
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
