import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import {
  useCustomerViewModel,
  type BobStatus,
  type CustomerForm,
  type CustomerListItem,
  type CustomerMutationResult,
  type CustomerObjectView,
} from '@/pages/bob/customer/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

function makeCustomerData() {
  return {
    name: '华东客户',
    customerType: 'DEALER' as const,
    shortName: '华东',
    categoryId: 'CAT-1',
    taxNumber: 'TAX-001',
    contactName: '张三',
    contactPhone: '13800000000',
    email: 'sales@example.com',
    address: '上海市示例路',
    remark: '重点客户',
    settlementMethodId: 'SM-1',
    salespersonId: 'EMP-1',
  }
}

function makeForm(overrides: Partial<CustomerForm> = {}): CustomerForm {
  return {
    code: 'C001',
    ...makeCustomerData(),
    ...overrides,
  }
}

function makeRow(
  status: BobStatus = 'DRAFT',
  overrides: Partial<CustomerListItem> = {},
): CustomerListItem {
  return {
    objectId: 'OBJ-1',
    entity: 'customer',
    code: 'C001',
    objectRevision: 3,
    effectiveVersionId: status === 'EFFECTIVE' ? 'VER-1' : null,
    currentVersion: {
      versionId: 'VER-1',
      version: 1,
      status,
      revision: 5,
      summary: makeCustomerData(),
    },
    updatedAt: '2026-07-24T09:40:18Z',
    ...overrides,
  }
}

function makeObjectView(
  status: BobStatus = 'DRAFT',
  overrides: Partial<CustomerObjectView> = {},
): CustomerObjectView {
  return {
    objectId: 'OBJ-1',
    entity: 'customer',
    code: 'C001',
    objectRevision: 3,
    currentVersionId: 'VER-1',
    effectiveVersionId: status === 'EFFECTIVE' ? 'VER-1' : null,
    version: {
      versionId: 'VER-1',
      version: 1,
      status,
      revision: 5,
    },
    data: makeCustomerData(),
    ...overrides,
  }
}

function makeMutation(
  overrides: Partial<CustomerMutationResult> = {},
): CustomerMutationResult {
  return {
    objectId: 'OBJ-1',
    objectRevision: 4,
    versionId: 'VER-2',
    version: 2,
    status: 'DRAFT',
    revision: 1,
    ...overrides,
  }
}

function grant(...actions: string[]): void {
  const session = useSessionStore()
  session.permissions = actions.map((action) => `/bob/customer/${action}`)
}

function grantReferenceQueries(): void {
  const session = useSessionStore()
  session.permissions.push(
    '/bob/category/query',
    '/bob/settlement-method/query',
    '/bob/employee/query',
  )
}

function emptyPage(page = 1) {
  return {
    data: {
      items: [],
      total: 0,
      page,
      pageSize: 20,
    },
  }
}

function referencePage(
  objectId: string,
  code: string,
  name: string,
) {
  return {
    data: {
      items: [{
        objectId,
        code,
        currentVersion: { summary: { name } },
      }],
      total: 1,
      page: 1,
      pageSize: 100,
    },
  }
}

describe('useCustomerViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('按真实版本摘要结构查询和展示客户列表', async () => {
    const row = makeRow('EFFECTIVE')
    mockedApiClient.post.mockResolvedValue({
      data: {
        items: [row],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })

    const vm = useCustomerViewModel()
    vm.keyword.value = '华东'
    await vm.query()

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/customer/query', {
      page: 1,
      pageSize: 20,
      filters: { keyword: '华东' },
      sort: [{ field: 'updatedAt', order: 'desc' }],
    })
    expect(vm.columns.map((column) => column.label)).toEqual([
      '客户编码',
      '客户名称',
      '客户类型',
      '状态',
    ])
    expect(vm.columns[1]?.value(row)).toBe('华东客户')
    expect(vm.columns[2]?.format?.('DEALER', row)).toBe('经销商')
    expect(vm.columns[3]?.format?.('EFFECTIVE', row)).toBe('有效')
  })

  it('根据状态和精确权限控制新增、编辑和草稿删除', () => {
    grant('create', 'get', 'edit', 'save', 'delete')
    const vm = useCustomerViewModel()
    const draft = makeRow('DRAFT')
    const effective = makeRow('EFFECTIVE')
    const pending = makeRow('PENDING')

    expect(vm.canCreate.value).toBe(true)
    expect(vm.canEdit(draft)).toBe(true)
    expect(vm.canEdit(effective)).toBe(true)
    expect(vm.canEdit(pending)).toBe(false)
    expect(vm.canDelete(draft)).toBe(true)
    expect(vm.canDelete(makeRow('REJECTED'))).toBe(false)
    expect(vm.canDelete(makeRow('DRAFT', {
      effectiveVersionId: 'VER-0',
    }))).toBe(false)
    expect(vm.canDelete(makeRow('DRAFT', {
      currentVersion: {
        ...draft.currentVersion,
        version: 2,
      },
    }))).toBe(false)

    grant('edit', 'save')
    expect(vm.canEdit(draft)).toBe(false)
    expect(vm.canEdit(effective)).toBe(true)

    grant('get', 'save')
    expect(vm.canEdit(draft)).toBe(true)
    expect(vm.canEdit(effective)).toBe(false)
  })

  it('打开编辑器时加载并缓存客户分类、结算方式和业务员选项', async () => {
    grant('create')
    grantReferenceQueries()
    mockedApiClient.post
      .mockResolvedValueOnce(referencePage('CAT-1', 'CAT001', '重点客户'))
      .mockResolvedValueOnce(referencePage('SM-1', 'SM001', '月结 30 天'))
      .mockResolvedValueOnce(referencePage('EMP-1', 'EMP001', '张三'))

    const vm = useCustomerViewModel()
    vm.openCreate()

    await vi.waitFor(() => {
      expect(vm.categoryLoading.value).toBe(false)
      expect(vm.settlementMethodLoading.value).toBe(false)
      expect(vm.salespersonLoading.value).toBe(false)
      expect(vm.categoryOptions.value).toHaveLength(1)
    })

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/category/query', {
      page: 1,
      pageSize: 100,
      filters: {
        targetEntity: 'customer',
        status: ['EFFECTIVE'],
      },
      sort: [{ field: 'name', order: 'asc' }],
    })
    expect(mockedApiClient.post).toHaveBeenCalledWith(
      'bob/settlement-method/query',
      {
        page: 1,
        pageSize: 100,
        filters: { status: ['EFFECTIVE'] },
        sort: [{ field: 'name', order: 'asc' }],
      },
    )
    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/employee/query', {
      page: 1,
      pageSize: 100,
      filters: { status: ['EFFECTIVE'] },
      sort: [{ field: 'name', order: 'asc' }],
    })
    expect(vm.categoryOptions.value[0]?.title).toBe('CAT001 · 重点客户')
    expect(vm.settlementMethodOptions.value[0]?.value).toBe('SM-1')
    expect(vm.salespersonOptions.value[0]?.value).toBe('EMP-1')
    expect(vm.editorFields.value.map((field) => field.label)).toEqual([
      '客户编码',
      '客户名称',
      '客户类型',
      '客户简称',
      '客户分类',
      '税号',
      '结算方式',
      '业务员',
      '联系人',
      '联系电话',
      '邮箱',
      '地址',
      '备注',
    ])

    vm.closeEditor()
    vm.openCreate()
    await Promise.resolve()
    expect(mockedApiClient.post).toHaveBeenCalledTimes(3)
  })

  it('引用查询不可用时保持客户编辑器可用并禁用对应下拉', async () => {
    grant('create')

    const vm = useCustomerViewModel()
    vm.openCreate()
    await Promise.resolve()

    expect(vm.drawerOpen.value).toBe(true)
    expect(mockedApiClient.post).not.toHaveBeenCalled()
    expect(vm.categoryErrorMessage.value).toContain('缺少客户分类查询权限')
    expect(vm.settlementMethodErrorMessage.value).toContain('缺少结算方式查询权限')
    expect(vm.salespersonErrorMessage.value).toContain('缺少业务员查询权限')
    expect(
      vm.editorFields.value.find((field) => field.key === 'categoryId')?.disabled,
    ).toBe(true)
  })

  it('新增客户时提交编码和名称并刷新列表', async () => {
    grant('create')
    mockedApiClient.post
      .mockResolvedValueOnce({ data: makeMutation() })
      .mockResolvedValueOnce(emptyPage())

    const vm = useCustomerViewModel()
    vm.openCreate()
    await vm.saveCustomer(makeForm({
      code: ' C001 ',
      name: ' 华东客户 ',
      shortName: ' 华东 ',
      contactName: ' 张三 ',
      address: ' 上海市示例路 ',
    }))

    expect(vm.drawerOpen.value).toBe(false)
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/customer/create',
      {
        data: {
          code: 'C001',
          name: '华东客户',
          customerType: 'DEALER',
          shortName: '华东',
          categoryId: 'CAT-1',
          taxNumber: 'TAX-001',
          contactName: '张三',
          contactPhone: '13800000000',
          email: 'sales@example.com',
          address: '上海市示例路',
          remark: '重点客户',
          settlementMethodId: 'SM-1',
          salespersonId: 'EMP-1',
        },
      },
    )
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/customer/query',
      {
        page: 1,
        pageSize: 20,
        filters: {},
        sort: [{ field: 'updatedAt', order: 'desc' }],
      },
    )
  })

  it('加载草稿详情并携带 revision 保存名称', async () => {
    grant('get', 'save')
    const detail = makeObjectView()
    const saved = makeMutation({
      objectRevision: 4,
      versionId: 'VER-1',
      version: 1,
      revision: 6,
    })
    mockedApiClient.post
      .mockResolvedValueOnce({ data: detail })
      .mockResolvedValueOnce({ data: saved })
      .mockResolvedValueOnce(emptyPage())

    const vm = useCustomerViewModel()
    await vm.openEdit(makeRow())
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/customer/get',
      { objectId: 'OBJ-1', versionId: 'VER-1' },
    )
    expect(vm.editorModel.value).toEqual(makeForm())

    await vm.saveCustomer(makeForm({
      name: ' 华南客户 ',
      shortName: '',
      settlementMethodId: '',
      salespersonId: '',
    }))
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/customer/save',
      {
        objectId: 'OBJ-1',
        versionId: 'VER-1',
        revision: 5,
        data: {
          name: '华南客户',
          customerType: 'DEALER',
          shortName: '',
          categoryId: 'CAT-1',
          taxNumber: 'TAX-001',
          contactName: '张三',
          contactPhone: '13800000000',
          email: 'sales@example.com',
          address: '上海市示例路',
          remark: '重点客户',
          settlementMethodId: '',
          salespersonId: '',
        },
      },
    )
  })

  it('有效客户调用 edit 创建草稿后再进入编辑器', async () => {
    grant('get', 'edit', 'save')
    const effective = makeRow('EFFECTIVE')
    const mutation = makeMutation()
    mockedApiClient.post.mockResolvedValueOnce({ data: mutation })

    const vm = useCustomerViewModel()
    await vm.openEdit(effective)

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      'bob/customer/edit',
      {
        objectId: 'OBJ-1',
        objectRevision: 3,
      },
    )
    expect(vm.selectedCustomer.value).toEqual({
      objectId: 'OBJ-1',
      code: 'C001',
      objectRevision: 4,
      versionId: 'VER-2',
      revision: 1,
      ...makeForm(),
    })
    expect(vm.editorResetKey.value).toBe(2)
    expect(vm.drawerOpen.value).toBe(true)
  })

  it('删除当前页最后一个首版草稿后回退并刷新', async () => {
    grant('delete')
    const row = makeRow()
    mockedApiClient.post
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce(emptyPage(1))

    const vm = useCustomerViewModel()
    vm.rows.value = [row]
    vm.page.value = 2
    const deleted = await vm.deleteCustomer(row)

    expect(deleted).toBe(true)
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/customer/delete',
      {
        objectId: 'OBJ-1',
        objectRevision: 3,
        versionId: 'VER-1',
        revision: 5,
      },
    )
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/customer/query',
      {
        page: 1,
        pageSize: 20,
        filters: {},
        sort: [{ field: 'updatedAt', order: 'desc' }],
      },
    )
  })

  it('写操作失败时保留编辑器并显示请求编号', async () => {
    grant('create')
    mockedApiClient.post.mockRejectedValue(
      new ApiError('business', '编码已存在。', {
        requestId: 'REQ-1',
      }),
    )

    const vm = useCustomerViewModel()
    vm.openCreate()
    await vm.saveCustomer(makeForm())

    expect(vm.drawerOpen.value).toBe(true)
    expect(vm.editorErrorMessage.value).toBe(
      '编码已存在。（请求编号：REQ-1）',
    )
  })

  it('查询失败时清空列表并暴露错误', async () => {
    mockedApiClient.post.mockRejectedValue(new Error('network down'))

    const vm = useCustomerViewModel()
    vm.rows.value = [makeRow()]
    await vm.query()

    expect(vm.rows.value).toEqual([])
    expect(vm.total.value).toBe(0)
    expect(vm.errorMessage.value).toBe('network down')
  })
})
