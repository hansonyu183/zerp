import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  supplierPayload,
  supplierSavePayload,
} from '@/pages/bob/supplier/payload'
import { createSupplierForm } from '@/pages/bob/supplier/form'
import { useSupplierViewModel } from '@/pages/bob/supplier/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
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
          partyId: `${name}-party`,
          partyKind: 'ORGANIZATION',
          partyDisplayName: `有效${name}`,
          operatingEntityId: 'operating-1',
          operatingEntityCode: 'OE-001',
          operatingEntityName: '测试经营主体',
          updatedAt: '2026-08-20T00:00:00Z',
          latestApproved: {
            approval: {
              approvalEntryId: `${name}-approved`,
              versionNo: 1,
              revision: 1,
              status: 'APPROVED',
              submittedBy: 'reviewer',
            },
            defaultPurchaserCode: 'EMP-1',
            defaultPurchaserName: '采购员',
          },
          openVersion: {
            approval: {
              approvalEntryId: `${name}-open`,
              versionNo: 2,
              revision: 2,
              status: 'DRAFT',
              submittedBy: null,
            },
            defaultPurchaserCode: 'EMP-2',
            defaultPurchaserName: '候选采购员',
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
      '/dcl/party/create',
      '/bob/party/get',
      '/bob/party/query',
      '/bob/employee/query',
      '/bob/operating-entity/query',
      '/aux/settlement-method/query',
    ]
    mockedApiClient.postContract.mockReset()
    mockedApiClient.postContract.mockReset()
  })

  it('keeps settlement method and default purchaser optional in a draft payload', () => {
    const form = createSupplierForm()
    form.name = ' 测试供应商 '
    form.taxNumber = ' ab-123 '

    expect(supplierPayload(form)).toMatchObject({
      operatingEntityId: '',
      settlementMethodId: null,
      defaultPurchaserEmployeeId: null,
    })
    expect(supplierPayload(form)).not.toHaveProperty('name')
    expect(supplierPayload(form)).not.toHaveProperty('taxNumber')
    expect(supplierPayload(form)).not.toHaveProperty('salespersonEmployeeId')
    expect(supplierSavePayload(form)).not.toHaveProperty('operatingEntityId')
  })

  it('queries by default purchaser while preserving the Party identity', async () => {
    mockedApiClient.postContract.mockResolvedValue(page('新供应商'))
    const vm = useSupplierViewModel()
    vm.keyword.value = '供应商'
    vm.filters.value.status = ['APPROVED']
    vm.filters.value.defaultPurchaserEmployeeId = 'employee-1'

    await vm.query()

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
          keyword: '供应商',
          status: ['APPROVED'],
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
      },
    ])
  })

  it('rereads the authoritative detail after create and keeps it open', async () => {
    mockedApiClient.postContract.mockResolvedValue({
      data: {
        objectId: 'created-id',
        objectRevision: 1,
        enabled: true,
        approvalEntryId: 'created-version',
        version: 1,
        status: 'DRAFT',
        revision: 1,
      },
    })
    mockedApiClient.postContract.mockImplementation(async (path) => {
      if (path === 'bob/supplier/query') return page('created')
      if (path === 'bob/supplier/create')
        return {
          data: {
            objectId: 'created-id',
            objectRevision: 1,
            enabled: true,
            approvalEntryId: 'created-version',
            version: 1,
            status: 'DRAFT',
            revision: 1,
          },
        }
      if (path === 'bob/supplier/get')
        return {
          data: {
            objectId: 'created-id',
            code: 'SUP-created',
            objectRevision: 1,
            enabled: true,
            partyId: 'created-party',
            partyKind: 'ORGANIZATION',
            partyDisplayName: '新供应商',
            operatingEntityId: 'operating-1',
            operatingEntityCode: 'OE-001',
            operatingEntityName: '测试经营主体',
            updatedAt: '2026-08-20T00:00:00Z',
            latestApproved: null,
            openVersion: {
              approval: {
                approvalEntryId: 'created-entry',
                versionNo: 1,
                revision: 1,
                status: 'DRAFT',
                submittedBy: null,
              },
              data: {
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
    vm.form.value.identifierType = 'UNIFIED_SOCIAL_CREDIT_CODE'
    vm.form.value.identifierValue = '91310000TEST000001'
    vm.form.value.operatingEntity = {
      objectId: 'operating-1',
      approvalEntryId: 'operating-version',
      code: 'OE-001',
      name: '测试经营主体',
      entity: 'operating-entity',
    }

    expect(await vm.save()).toBe(true)

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/create',
      expect.objectContaining({
        newParty: expect.objectContaining({
          strongIdentifiers: [
            {
              type: 'UNIFIED_SOCIAL_CREDIT_CODE',
              value: '91310000TEST000001',
            },
          ],
        }),
      }),
    )

    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/get',
      { objectId: 'created-id' },
    )
    expect(vm.workspaceOpen.value).toBe(true)
    expect(vm.mode.value).toBe('edit')
    expect(vm.detail.value?.objectId).toBe('created-id')

    vm.openCreate()
    vm.form.value.partyMode = 'existing'
    vm.form.value.selectedParty = {
      partyId: 'existing-party',
      kind: 'ORGANIZATION',
      legalName: '已有主体',
      displayName: '已有主体',
      revision: 1,
      updatedAt: '2026-08-20T00:00:00Z',
    }
    vm.form.value.operatingEntity = {
      objectId: 'operating-1',
      approvalEntryId: 'operating-version',
      code: 'OE-001',
      name: '测试经营主体',
      entity: 'operating-entity',
    }

    expect(await vm.save()).toBe(true)
    expect(mockedApiClient.postContract).toHaveBeenCalledWith(
      'bob/supplier/create',
      expect.objectContaining({
        partyId: 'existing-party',
        data: expect.objectContaining({ operatingEntityId: 'operating-1' }),
      }),
    )
  })

  it('opens history only after authoritative get and reads a selected version', async () => {
    const current = page('history')
    const detail = {
      data: {
        objectId: 'history-id',
        code: 'SUP-history',
        objectRevision: 2,
        enabled: true,
        partyId: 'history-party',
        partyKind: 'ORGANIZATION',
        partyDisplayName: '历史供应商',
        operatingEntityId: 'operating-1',
        operatingEntityCode: 'OE-001',
        operatingEntityName: '测试经营主体',
        updatedAt: '2026-08-20T00:00:00Z',
        latestApproved: {
          approval: {
            approvalEntryId: 'history-approved',
            versionNo: 1,
            revision: 1,
            status: 'APPROVED',
            submittedBy: 'reviewer',
          },
          data: {
            contactName: null,
            contactPhone: null,
            email: null,
            address: null,
            remark: null,
            settlementMethod: null,
            defaultPurchaserEmployeeId: null,
          },
        },
        openVersion: null,
      },
    }
    mockedApiClient.postContract.mockImplementation(async (path) => {
      if (path === 'bob/supplier/query') return current
      if (path === 'bob/supplier/get') return detail
      if (path === 'bob/supplier/versions')
        return {
          data: {
            items: [
              {
                approvalEntryId: 'history-approved',
                versionNo: 1,
                status: 'APPROVED',
                revision: 1,
                summary: { name: '历史供应商' },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        }
      return { data: [] }
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
      { objectId: 'history-id', approvalEntryId: 'history-approved' },
    )
    expect(vm.mode.value).toBe('view')
    expect(vm.historicalApprovalEntryId.value).toBe('history-approved')
  })
})
