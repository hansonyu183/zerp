import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  customerFormFromView,
  dclCustomerPayload,
} from '@/pages/dcl/customer/data'
import {
  createCustomerForm,
  customerPrimaryAction,
  useDclCustomerViewModel,
} from '@/pages/dcl/customer/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = (status: 'DRAFT' | 'PENDING' | 'APPROVED', versionNo: number) => ({
  approvalEntryId: `ENTRY-${status}-${versionNo}`,
  revision: 1,
  status,
  versionNo,
  submittedBy: null,
})

describe('DCL customer workspace', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockedPost.mockResolvedValue({ data: { items: [], total: 0, page: 1 } })
  })

  it('keeps customer accounts in one complete customer payload with exactly one default', async () => {
    const session = useSessionStore()
    session.permissions = [
      '/dcl/customer/create',
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    const vm = useDclCustomerViewModel()
    const form = createCustomerForm()
    form.legalName = '华南客户有限公司'
    form.defaultOperatingEntityId = 'OPE-1'
    form.accounts[0]!.name = '主结算账户'
    form.accounts[0]!.primarySalesAttribution.subjectObjectId = 'EMP-1'
    vm.createForm.value = form
    vm.addAccount()
    vm.createForm.value.accounts[1]!.name = '备用结算账户'
    vm.createForm.value.accounts[1]!.primarySalesAttribution.subjectObjectId = 'EMP-1'
    vm.setDefaultAccount(1)

    await vm.create()

    expect(mockedPost).toHaveBeenCalledWith('dcl/customer/create', {
      data: expect.objectContaining({
        legalName: '华南客户有限公司',
        defaultOperatingEntityId: 'OPE-1',
        accounts: [
          expect.objectContaining({ isDefault: false, enabled: true }),
          expect.objectContaining({ isDefault: true, enabled: true }),
        ],
      }),
    })
  })

  it('maps the four customer list edit states without inferring approval actions', () => {
    const draft = {
      objectId: 'CUS-1',
      availableApprovalActions: [],
      openVersion: { approval: approval('DRAFT', 1) },
      latestApproved: null,
    } as never
    const approved = {
      objectId: 'CUS-2',
      availableApprovalActions: ['approve'],
      openVersion: null,
      latestApproved: { approval: approval('APPROVED', 1) },
    } as never
    const approvedWithDraft = {
      objectId: 'CUS-3',
      availableApprovalActions: [],
      openVersion: { approval: approval('DRAFT', 2) },
      latestApproved: { approval: approval('APPROVED', 1) },
    } as never
    const pending = {
      objectId: 'CUS-4',
      availableApprovalActions: ['approve'],
      openVersion: { approval: approval('PENDING', 2) },
      latestApproved: { approval: approval('APPROVED', 1) },
    } as never

    expect(customerPrimaryAction(draft, true)).toMatchObject({
      key: 'edit',
      label: '编辑草稿',
    })
    expect(customerPrimaryAction(approved, true)).toMatchObject({
      key: 'edit',
      label: '发起变更',
    })
    expect(customerPrimaryAction(approvedWithDraft, true)).toMatchObject({
      key: 'edit',
      label: '继续编辑草稿',
    })
    expect(customerPrimaryAction(pending, true)).toMatchObject({
      key: 'view',
      label: '查看',
    })
    expect(customerPrimaryAction(approved, false)).toMatchObject({
      key: 'view',
      label: '查看',
    })
  })

  it('round-trips all strong identifiers and multi-currency credit limits', () => {
    const form = customerFormFromView({
      data: {
        kind: 'ORGANIZATION', legalName: '多值客户', displayName: '多值客户',
        strongIdentifiers: [
          { type: 'UNIFIED_SOCIAL_CREDIT_CODE', value: '913500001' },
          { type: 'PERSON_ID', value: '350100199001010001' },
        ],
        remittanceProfiles: [], defaultOperatingEntityId: 'OPE-1', enabled: true,
        accounts: [{
          accountId: 'ACC-1', enabled: true, isDefault: true, name: '主账户',
          customerTypeId: 'TYPE-1', transportSurcharge: '0.00',
          pricingPolicy: {
            defaultPremiumUnitPrice: '0.00', defaultDiscountUnitPrice: '0.00', costItems: [],
            thirdPartyIntermediaryFixedUnitCost: '0.00', thirdPartyIntermediaryVariableUnitCost: '0.00',
          },
          creditLimits: [
            { currency: 'CNY', amount: '1000.00' },
            { currency: 'USD', amount: '200.00' },
          ],
          primarySalesAttribution: { type: 'INTERNAL_EMPLOYEE', subjectObjectId: 'EMP-1' },
        }],
      },
    } as never)

    const payload = dclCustomerPayload(form)
    expect(payload.strongIdentifiers).toEqual([
      { type: 'UNIFIED_SOCIAL_CREDIT_CODE', value: '913500001' },
      { type: 'PERSON_ID', value: '350100199001010001' },
    ])
    expect(payload.accounts[0]?.creditLimits).toEqual([
      { currency: 'CNY', amount: '1000.00' },
      { currency: 'USD', amount: '200.00' },
    ])
  })

  it('isolates async sales-attribution candidates by account', async () => {
    vi.useFakeTimers()
    const session = useSessionStore()
    mockedPost.mockImplementation(async (...args) => {
      const [path, payload] = args as [string, { entity?: string }]
      if (path !== 'bob/reference/query') return { data: [] } as never
      return {
        data: payload.entity === 'employee'
          ? [{ objectId: 'EMP-1', code: 'EMP-001', name: '内部业务员' }]
          : [{ objectId: 'PAR-1', code: 'PAR-001', name: '渠道伙伴' }],
      } as never
    })
    const vm = useDclCustomerViewModel()
    vm.addAccount(vm.createForm.value)
    vm.createForm.value.accounts[1]!.primarySalesAttribution.type = 'CHANNEL_PARTNER'
    session.permissions = [
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]

    vm.searchReference('primarySalesAttributionSubjectObjectId', '内部', 0)
    vm.searchReference('primarySalesAttributionSubjectObjectId', '渠道', 1)
    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()

    expect(vm.referenceOptionsForAccount(0, 'primarySalesAttributionSubjectObjectId')).toEqual([
      { value: 'EMP-1', title: 'EMP-001 · 内部业务员' },
    ])
    expect(vm.referenceOptionsForAccount(1, 'primarySalesAttributionSubjectObjectId')).toEqual([
      { value: 'PAR-1', title: 'PAR-001 · 渠道伙伴' },
    ])
    vi.useRealTimers()
  })
})
