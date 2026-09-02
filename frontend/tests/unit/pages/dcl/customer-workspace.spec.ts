import { effectScope } from 'vue'
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

const approval = (
  status: 'DRAFT' | 'PENDING' | 'APPROVED',
  versionNo: number,
) => ({
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

  it('creates a customer from one root and its subunits without a persisted default', async () => {
    const session = useSessionStore()
    session.permissions = [
      '/dcl/customer/create',
      '/dcl/customer/save-subunits',
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    const vm = useDclCustomerViewModel()
    const form = createCustomerForm()
    form.legalName = '华南客户有限公司'
    form.defaultOperatingEntityId = 'OPE-1'
    form.subunits[0]!.name = '总部'
    form.subunits[0]!.primarySalesAttribution.subjectObjectId = 'EMP-1'
    vm.createForm.value = form
    vm.addSubunit()
    vm.createForm.value.subunits[1]!.name = '项目部'
    vm.createForm.value.subunits[1]!.primarySalesAttribution.subjectObjectId =
      'EMP-1'
    await vm.create()

    expect(mockedPost).toHaveBeenCalledWith('dcl/customer/create', {
      data: {
        root: expect.objectContaining({
          legalName: '华南客户有限公司',
          defaultOperatingEntityId: 'OPE-1',
        }),
        subunits: [
          expect.objectContaining({ name: '总部', enabled: true }),
          expect.objectContaining({ name: '项目部', enabled: true }),
        ],
      },
    })
    expect(mockedPost.mock.calls[0]?.[1]).not.toHaveProperty(
      'data.subunits.0.isDefault',
    )
  })

  it('allows a blank legal identifier in a draft but blocks an invalid non-empty enterprise identifier', async () => {
    const session = useSessionStore()
    session.permissions = [
      '/dcl/customer/create',
      '/dcl/customer/save-subunits',
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    const vm = useDclCustomerViewModel()
    const form = createCustomerForm()
    form.legalName = '待校验客户'
    form.legalIdentifier = '91350211M000100Y47'
    form.defaultOperatingEntityId = 'OPE-1'
    form.subunits[0]!.name = '总部'
    form.subunits[0]!.primarySalesAttribution.subjectObjectId = 'EMP-1'
    vm.createForm.value = form

    await expect(vm.create()).resolves.toBe(false)
    expect(vm.errorMessage.value).toBe(
      '统一社会信用代码须为校验通过的 18 位代码。',
    )
    expect(mockedPost).not.toHaveBeenCalledWith(
      'dcl/customer/create',
      expect.anything(),
    )
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
      icon: 'mdi-pencil-outline',
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

  it('keeps root and subunit maintenance permissions independent', () => {
    const session = useSessionStore()
    session.permissions = [
      '/dcl/customer/get',
      '/dcl/customer/save',
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    const rootEditor = useDclCustomerViewModel()
    expect(rootEditor.canEditRoot.value).toBe(true)
    expect(rootEditor.canEditSubunits.value).toBe(false)
    expect(rootEditor.canCreate.value).toBe(false)

    session.permissions = [
      '/dcl/customer/get',
      '/dcl/customer/save-subunits',
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    const subunitEditor = useDclCustomerViewModel()
    expect(subunitEditor.canEditRoot.value).toBe(false)
    expect(subunitEditor.canEditSubunits.value).toBe(true)
  })

  it('round-trips the single legal identifier and multi-currency credit limits', () => {
    const form = customerFormFromView({
      data: {
        kind: 'MAINLAND_ENTERPRISE',
        legalName: '客户甲',
        displayName: '客户甲',
        legalIdentifier: '91350211M000100Y46',
        remittanceProfiles: [],
        defaultOperatingEntityId: 'OPE-1',
        enabled: true,
        subunits: [
          {
            subunitId: 'SUB-1',
            enabled: true,
            name: '主账户',
            customerTypeId: 'TYPE-1',
            transportSurcharge: '0.00',
            pricingPolicy: {
              defaultPremiumUnitPrice: '0.00',
              defaultDiscountUnitPrice: '0.00',
              costItems: [],
              thirdPartyIntermediaryFixedUnitCost: '0.00',
              thirdPartyIntermediaryVariableUnitCost: '0.00',
            },
            creditLimits: [
              { currency: 'CNY', amount: '1000.00' },
              { currency: 'USD', amount: '200.00' },
            ],
            primarySalesAttribution: {
              type: 'INTERNAL_EMPLOYEE',
              subjectObjectId: 'EMP-1',
            },
          },
        ],
      },
    } as never)

    const payload = dclCustomerPayload(form)
    expect(payload.root.legalIdentifier).toBe('91350211M000100Y46')
    expect(payload.subunits[0]?.creditLimits).toEqual([
      { currency: 'CNY', amount: '1000.00' },
      { currency: 'USD', amount: '200.00' },
    ])
  })

  it('isolates async sales-attribution candidates by subunit', async () => {
    vi.useFakeTimers()
    const session = useSessionStore()
    mockedPost.mockImplementation(async (...args) => {
      const [path, payload] = args as [string, { entity?: string }]
      if (path !== 'bob/reference/query') return { data: [] } as never
      return {
        data:
          payload.entity === 'employee'
            ? [{ objectId: 'EMP-1', code: 'EMP-001', name: '内部业务员' }]
            : [{ objectId: 'PAR-1', code: 'PAR-001', name: '渠道伙伴' }],
      } as never
    })
    const vm = useDclCustomerViewModel()
    vm.addSubunit(vm.createForm.value)
    vm.createForm.value.subunits[1]!.primarySalesAttribution.type =
      'CHANNEL_PARTNER'
    session.permissions = [
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]

    vm.searchReference('primarySalesAttributionSubjectObjectId', '内部', 0)
    vm.searchReference('primarySalesAttributionSubjectObjectId', '渠道', 1)
    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()

    expect(
      vm.referenceOptionsForSubunit(
        0,
        'primarySalesAttributionSubjectObjectId',
      ),
    ).toEqual([{ value: 'EMP-1', title: 'EMP-001 · 内部业务员' }])
    expect(
      vm.referenceOptionsForSubunit(
        1,
        'primarySalesAttributionSubjectObjectId',
      ),
    ).toEqual([{ value: 'PAR-1', title: 'PAR-001 · 渠道伙伴' }])
    vi.useRealTimers()
  })

  it('does not write operating-entity references after its scope is disposed', async () => {
    const session = useSessionStore()
    session.permissions = [
      '/dcl/customer/create',
      '/dcl/customer/save-subunits',
      '/bob/operating-entity/query',
      '/aux/reference/query',
      '/bob/reference/query',
    ]
    let resolveOperatingEntityQuery!: (value: unknown) => void
    mockedPost.mockImplementation(
      ((path: string) => {
        if (path !== 'bob/operating-entity/query') return { data: [] }
        return new Promise((resolve) => {
          resolveOperatingEntityQuery = resolve
        })
      }) as never,
    )
    const scope = effectScope()
    const vm = scope.run(() => useDclCustomerViewModel())!

    vm.openCreate()
    scope.stop()
    resolveOperatingEntityQuery({
      data: {
        items: [
          {
            objectId: 'OPE-1',
            code: 'OPE-001',
            data: { name: '华南经营主体' },
          },
        ],
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(vm.referenceOptions.value.operatingEntityId).toEqual([])
  })
})
