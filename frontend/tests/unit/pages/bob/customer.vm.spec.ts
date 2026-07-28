import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  customerConfig,
  useCustomerViewModel,
} from '@/pages/bob/customer/vm'
import type {
  BobListItem,
  BobObjectView,
} from '@/pages/bob/shared/types'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

const customerForm = {
  code: 'CUS-001',
  name: '华东客户',
  customerType: 'DEALER',
  shortName: '华东',
  settlementMethodId: 'SM-1',
  salespersonEmployeeId: 'EMP-1',
  taxNumber: 'TAX-001',
  contactName: '张三',
  contactPhone: '13800000000',
  email: 'sales@example.com',
  address: '上海市示例路',
  remark: '重点客户',
}

function row(): BobListItem {
  const { code: _code, ...summary } = customerForm
  return {
    objectId: 'OBJ-1',
    entity: 'customer',
    code: 'CUS-001',
    objectRevision: 3,
    effectiveVersionId: null,
    currentVersion: {
      versionId: 'VER-1',
      version: 1,
      status: 'DRAFT',
      revision: 5,
      summary,
    },
    updatedAt: '2026-07-25T00:00:00Z',
  }
}

function objectView(): BobObjectView {
  const { code: _code, ...data } = customerForm
  return {
    objectId: 'OBJ-1',
    entity: 'customer',
    code: 'CUS-001',
    objectRevision: 3,
    currentVersionId: 'VER-1',
    effectiveVersionId: null,
    version: {
      versionId: 'VER-1',
      version: 1,
      status: 'DRAFT',
      revision: 5,
    },
    data,
  }
}

function emptyPage() {
  return { data: { items: [], total: 0, page: 1, pageSize: 20 } }
}

function grant(...actions: string[]): void {
  useSessionStore().permissions = actions.map(
    (action) => `/bob/customer/${action}`,
  )
}

describe('customer shared BOB configuration and view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('声明客户字段、默认值、引用约束和专属筛选', () => {
    expect(customerConfig.emptyForm()).toEqual({
      code: '',
      name: '',
      customerType: 'END_USER',
      shortName: '',
      settlementMethodId: '',
      salespersonEmployeeId: '',
      taxNumber: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      remark: '',
    })
    expect(customerConfig.requiredKeys).toEqual([
      'code',
      'name',
      'customerType',
      'salespersonEmployeeId',
    ])
    expect(customerConfig.references?.settlementMethodId).toMatchObject({
      domain: 'aux',
      entity: 'settlement-method',
    })
    expect(customerConfig.filters.map((field) => field.key)).toEqual([
      'status',
      'customerType',
      'salespersonEmployeeId',
    ])
    expect(customerConfig.columns.map((column) => column.label)).toEqual([
      '编码',
      '名称',
      '类型',
      '简称',
      '版本',
      '状态',
      '更新',
    ])
  })

  it('查询只发送客户允许且有值的筛选字段', async () => {
    mockedApiClient.post.mockResolvedValueOnce(emptyPage())
    const vm = useCustomerViewModel()
    vm.keyword.value = '  华东  '
    vm.filters.value.status = ['DRAFT', 'EFFECTIVE']
    vm.filters.value.customerType = 'DEALER'
    vm.filters.value.salespersonEmployeeId = 'EMP-1'

    await vm.query()

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/customer/query', {
      page: 1,
      pageSize: 20,
      filters: {
        keyword: '华东',
        status: ['DRAFT', 'EFFECTIVE'],
        customerType: 'DEALER',
        salespersonEmployeeId: 'EMP-1',
      },
      sort: [{ field: 'updatedAt', order: 'desc' }],
    })
  })

  it('结算方式从 AUX 查询启用对象', async () => {
    vi.useFakeTimers()
    useSessionStore().permissions = ['/aux/settlement-method/query']
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useCustomerViewModel()

    vm.searchEditorReference('settlementMethodId', '月结', customerForm)
    await vi.advanceTimersByTimeAsync(300)

    expect(mockedApiClient.post).toHaveBeenCalledWith('aux/settlement-method/query', {
      page: 1,
      pageSize: 20,
      filters: {
        keyword: '月结',
        enabled: true,
      },
      sort: [{ field: 'name', order: 'asc' }],
    })
  })

  it('创建省略空可选字段并校验必填业务员', async () => {
    grant('create')
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          objectId: 'OBJ-1',
          objectRevision: 1,
          versionId: 'VER-1',
          version: 1,
          status: 'DRAFT',
          revision: 1,
        },
      })
      .mockResolvedValueOnce(emptyPage())
    const vm = useCustomerViewModel()
    vm.openCreate()

    expect(await vm.save({
      ...customerForm,
      code: ' cus-002 ',
      name: ' 新客户 ',
      shortName: '',
      settlementMethodId: '',
      taxNumber: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      remark: '',
    })).toBe(true)
    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      1,
      'bob/customer/create',
      {
        data: {
          code: 'CUS-002',
          name: '新客户',
          customerType: 'DEALER',
          salespersonEmployeeId: 'EMP-1',
        },
      },
    )

    vi.clearAllMocks()
    vm.openCreate()
    expect(await vm.save({
      ...customerForm,
      salespersonEmployeeId: '',
    })).toBe(false)
    expect(vm.editorErrorMessage.value).toBe('请输入业务员。')
    expect(mockedApiClient.post).not.toHaveBeenCalled()
  })

  it('保存发送完整客户数据和当前版本 revision', async () => {
    grant('get', 'save')
    mockedApiClient.post
      .mockResolvedValueOnce({ data: objectView() })
      .mockResolvedValueOnce({
        data: {
          objectId: 'OBJ-1',
          objectRevision: 4,
          versionId: 'VER-1',
          version: 1,
          status: 'DRAFT',
          revision: 6,
        },
      })
      .mockResolvedValueOnce(emptyPage())
    const vm = useCustomerViewModel()

    await vm.openEdit(row())
    await vm.save({
      ...customerForm,
      shortName: '',
      settlementMethodId: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      remark: '',
    })

    expect(mockedApiClient.post).toHaveBeenNthCalledWith(
      2,
      'bob/customer/save',
      {
        objectId: 'OBJ-1',
        versionId: 'VER-1',
        revision: 5,
        data: {
          name: '华东客户',
          customerType: 'DEALER',
          shortName: '',
          settlementMethodId: '',
          salespersonEmployeeId: 'EMP-1',
          taxNumber: 'TAX-001',
          contactName: '',
          contactPhone: '',
          email: '',
          address: '',
          remark: '',
        },
      },
    )
  })

  it('按客户精确权限开放完整生命周期动作', () => {
    grant(
      'get',
      'save',
      'delete',
      'submit',
      'approve',
      'reject',
      'versions',
      'audit-history',
    )
    const vm = useCustomerViewModel()

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
  })
})
