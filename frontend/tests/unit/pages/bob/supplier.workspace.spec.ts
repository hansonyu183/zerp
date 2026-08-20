import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { supplierPayload } from '@/pages/bob/supplier/payload'
import { createSupplierForm } from '@/pages/bob/supplier/form'
import { useSupplierViewModel } from '@/pages/bob/supplier/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), postContract: vi.fn() },
}))

const mockedApiClient = vi.mocked(apiClient)

function page(name: string) {
  return {
    data: {
      items: [
        {
          objectId: `${name}-id`,
          code: `SUP-${name}`,
          objectRevision: 1,
          enabled: true,
          updatedAt: '2026-08-20T00:00:00Z',
          effective: {
            versionId: `${name}-effective`,
            version: 1,
            revision: 1,
            status: 'EFFECTIVE',
            name: `有效${name}`,
            supplierType: 'GENERAL',
            defaultPurchaserCode: 'EMP-1',
            defaultPurchaserName: '采购员',
            submittedBy: 'reviewer',
          },
          candidate: {
            versionId: `${name}-candidate`,
            version: 2,
            revision: 2,
            status: 'DRAFT',
            name,
            supplierType: 'LOGISTICS_PLATFORM',
            defaultPurchaserCode: 'EMP-2',
            defaultPurchaserName: '候选采购员',
            submittedBy: null,
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  }
}

describe('supplier workspace view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = [
      '/bob/supplier/query',
      '/bob/supplier/get',
      '/bob/supplier/create',
      '/bob/supplier/save',
      '/bob/supplier/versions',
      '/bob/supplier/audit-history',
      '/bob/employee/query',
      '/aux/settlement-method/query',
    ]
    mockedApiClient.postContract.mockReset()
    mockedApiClient.post.mockReset()
  })

  it('keeps settlement method and default purchaser optional in a draft payload', () => {
    const form = createSupplierForm()
    form.name = ' 测试供应商 '
    form.taxNumber = ' ab-123 '

    expect(supplierPayload(form)).toMatchObject({
      name: '测试供应商',
      taxNumber: 'AB-123',
      settlementMethodId: null,
      defaultPurchaserEmployeeId: null,
    })
    expect(supplierPayload(form)).not.toHaveProperty('salespersonEmployeeId')
  })

  it('queries by supplier type and default purchaser while preserving the effective business summary', async () => {
    mockedApiClient.postContract.mockResolvedValue(page('新供应商'))
    const vm = useSupplierViewModel()
    vm.keyword.value = '供应商'
    vm.filters.value.supplierType = 'GENERAL'
    vm.filters.value.status = ['EFFECTIVE']
    vm.filters.value.defaultPurchaserEmployeeId = 'employee-1'

    await vm.query()

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
          keyword: '供应商',
          status: ['EFFECTIVE'],
          supplierType: 'GENERAL',
          defaultPurchaserEmployeeId: 'employee-1',
        },
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    expect(vm.rows.value).toMatchObject([
      {
        name: '有效新供应商',
        status: 'DRAFT',
        hasCandidate: true,
        effective: { name: '有效新供应商' },
        candidate: { name: '新供应商' },
      },
    ])
  })

  it('rereads the authoritative detail after create and keeps it open', async () => {
    mockedApiClient.post.mockResolvedValue({
      data: {
        objectId: 'created-id',
        objectRevision: 1,
        enabled: true,
        versionId: 'created-version',
        version: 1,
        status: 'DRAFT',
        revision: 1,
      },
    })
    mockedApiClient.postContract.mockImplementation(async (path) => {
      if (path === 'bob/supplier/query') return page('created')
      if (path === 'bob/supplier/get')
        return {
          data: {
            objectId: 'created-id',
            code: 'SUP-created',
            objectRevision: 1,
            enabled: true,
            updatedAt: '2026-08-20T00:00:00Z',
            effective: null,
            candidate: {
              version: {
                versionId: 'created-version',
                version: 1,
                revision: 1,
                status: 'DRAFT',
                submittedBy: null,
              },
              data: {
                name: '新供应商',
                supplierType: 'GENERAL',
                shortName: null,
                taxNumber: null,
                contactName: null,
                contactPhone: null,
                email: null,
                address: null,
                remark: null,
                settlementMethod: null,
                defaultPurchaserEmployeeId: null,
              },
            },
          },
        }
      return { data: [] }
    })
    const vm = useSupplierViewModel()
    vm.openCreate()
    vm.form.value.name = '新供应商'

    expect(await vm.save()).toBe(true)

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/get',
      { objectId: 'created-id' },
    )
    expect(vm.workspaceOpen.value).toBe(true)
    expect(vm.mode.value).toBe('edit')
    expect(vm.detail.value?.objectId).toBe('created-id')
  })

  it('opens history only after authoritative get and reads a selected version', async () => {
    const current = page('history')
    const detail = {
      data: {
        objectId: 'history-id',
        code: 'SUP-history',
        objectRevision: 2,
        enabled: true,
        updatedAt: '2026-08-20T00:00:00Z',
        effective: {
          version: {
            versionId: 'history-effective',
            version: 1,
            revision: 1,
            status: 'EFFECTIVE',
            submittedBy: 'reviewer',
          },
          data: {
            name: '历史供应商',
            supplierType: 'GENERAL',
            shortName: null,
            taxNumber: null,
            contactName: null,
            contactPhone: null,
            email: null,
            address: null,
            remark: null,
            settlementMethod: null,
            defaultPurchaserEmployeeId: null,
          },
        },
        candidate: null,
      },
    }
    mockedApiClient.postContract.mockImplementation(async (path) => {
      if (path === 'bob/supplier/query') return current
      if (path === 'bob/supplier/get') return detail
      return { data: [] }
    })
    mockedApiClient.post.mockResolvedValue({
      data: {
        items: [
          {
            versionId: 'history-effective',
            version: 1,
            status: 'EFFECTIVE',
            revision: 1,
            summary: { name: '历史供应商' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    const vm = useSupplierViewModel()
    await vm.query()

    await vm.openVersions(vm.rows.value[0]!)
    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/get',
      { objectId: 'history-id' },
    )
    expect(vm.versionsOpen.value).toBe(true)

    await vm.openHistoricalVersion(vm.versions.value[0]!)
    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/get',
      { objectId: 'history-id', versionId: 'history-effective' },
    )
    expect(vm.mode.value).toBe('view')
    expect(vm.historicalVersionId.value).toBe('history-effective')
  })

  it('matches a tax number and only prefills a new independent supplier draft', async () => {
    mockedApiClient.postContract.mockResolvedValue({
      data: [
        {
          sourceEntity: 'customer-group',
          objectId: 'CUS-GROUP-1',
          code: 'CUG-0001',
          companyName: '同税号公司',
          shortName: '同税号',
          taxNumber: '91310000MATCH',
          contactName: '张三',
          contactPhone: '13800000000',
          email: 'match@example.com',
          address: '上海市',
        },
      ],
    })
    const vm = useSupplierViewModel()
    vm.openCreate()
    vm.form.value.taxNumber = ' 91310000match '

    await vm.matchTaxNumber()
    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/tax-match',
      { taxNumber: '91310000match' },
    )
    vm.applyTaxMatch(vm.taxMatches.value[0]!)

    expect(vm.form.value).toMatchObject({
      name: '同税号公司',
      taxNumber: '91310000MATCH',
      contactName: '张三',
    })
    expect(vm.detail.value).toBeNull()
  })
})
