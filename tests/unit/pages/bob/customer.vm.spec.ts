import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import {
  useCustomerViewModel,
  type BobStatus,
  type CustomerDetail,
  type CustomerListItem,
} from '@/pages/bob/customer/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

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
      summary: { name: '华东客户' },
    },
    updatedAt: '2026-07-24T09:40:18Z',
    ...overrides,
  }
}

function makeDetail(
  status: BobStatus = 'DRAFT',
  overrides: Partial<CustomerDetail> = {},
): CustomerDetail {
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
      data: { name: '华东客户' },
    },
    ...overrides,
  }
}

function grant(...actions: string[]): void {
  const session = useSessionStore()
  session.permissions = actions.map((action) => `/bob/customer/${action}`)
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
      '状态',
    ])
    expect(vm.columns[1]?.value(row)).toBe('华东客户')
    expect(vm.columns[2]?.format?.('EFFECTIVE', row)).toBe('有效')
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

  it('新增客户时提交编码和名称并刷新列表', async () => {
    grant('create')
    mockedApiClient.post
      .mockResolvedValueOnce({ data: makeDetail() })
      .mockResolvedValueOnce(emptyPage())

    const vm = useCustomerViewModel()
    vm.openCreate()
    await vm.saveCustomer({ code: ' C001 ', name: ' 华东客户 ' })

    expect(vm.drawerOpen.value).toBe(false)
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/customer/create',
      {
        code: 'C001',
        data: { name: '华东客户' },
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
    const detail = makeDetail()
    const saved = makeDetail('DRAFT', {
      objectRevision: 4,
      currentVersion: {
        ...detail.currentVersion,
        revision: 6,
        data: { name: '华南客户' },
      },
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
    expect(vm.editorModel.value).toEqual({
      code: 'C001',
      name: '华东客户',
    })

    await vm.saveCustomer({ code: 'C001', name: ' 华南客户 ' })
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/customer/save',
      {
        objectId: 'OBJ-1',
        objectRevision: 3,
        versionId: 'VER-1',
        revision: 5,
        data: { name: '华南客户' },
      },
    )
  })

  it('有效客户调用 edit 创建草稿后再进入编辑器', async () => {
    grant('get', 'edit', 'save')
    const effective = makeRow('EFFECTIVE')
    const draftDetail = makeDetail('DRAFT', {
      objectRevision: 4,
      currentVersion: {
        ...makeDetail().currentVersion,
        versionId: 'VER-2',
        version: 2,
        revision: 1,
      },
    })
    mockedApiClient.post.mockResolvedValueOnce({ data: draftDetail })

    const vm = useCustomerViewModel()
    await vm.openEdit(effective)

    expect(mockedApiClient.post).toHaveBeenCalledWith(
      'bob/customer/edit',
      {
        objectId: 'OBJ-1',
        objectRevision: 3,
        versionId: 'VER-1',
        revision: 5,
      },
    )
    expect(vm.selectedDetail.value).toEqual(draftDetail)
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
    await vm.saveCustomer({ code: 'C001', name: '华东客户' })

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
