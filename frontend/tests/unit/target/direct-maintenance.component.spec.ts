import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  getTargetUser: vi.fn(),
  createTargetUser: vi.fn(),
  saveTargetUser: vi.fn(),
  getTargetRole: vi.fn(),
  createTargetRole: vi.fn(),
  saveTargetRole: vi.fn(),
  getTargetEmployeeCategory: vi.fn(),
  createTargetEmployeeCategory: vi.fn(),
  saveTargetEmployeeCategory: vi.fn(),
  getTargetPosition: vi.fn(),
  createTargetPosition: vi.fn(),
  saveTargetPosition: vi.fn(),
  getTargetMeasurementUnit: vi.fn(),
  createTargetMeasurementUnit: vi.fn(),
  saveTargetMeasurementUnit: vi.fn(),
  getTargetPaymentMethod: vi.fn(),
  createTargetPaymentMethod: vi.fn(),
  saveTargetPaymentMethod: vi.fn(),
  getTargetAssetCategory: vi.fn(),
  createTargetAssetCategory: vi.fn(),
  saveTargetAssetCategory: vi.fn(),
  getTargetOperatingEntity: vi.fn(),
  createTargetOperatingEntity: vi.fn(),
  saveTargetOperatingEntity: vi.fn(),
  getTargetEmployee: vi.fn(),
  createTargetEmployee: vi.fn(),
  saveTargetEmployee: vi.fn(),
  getTargetWarehouse: vi.fn(),
  createTargetWarehouse: vi.fn(),
  saveTargetWarehouse: vi.fn(),
  getTargetFundAccount: vi.fn(),
  createTargetFundAccount: vi.fn(),
  saveTargetFundAccount: vi.fn(),
  getTargetVehicle: vi.fn(),
  createTargetVehicle: vi.fn(),
  saveTargetVehicle: vi.fn(),
  setTargetUserEnabled: vi.fn(),
  setTargetRoleEnabled: vi.fn(),
  setTargetEmployeeCategoryEnabled: vi.fn(),
  setTargetPositionEnabled: vi.fn(),
  setTargetMeasurementUnitEnabled: vi.fn(),
  setTargetPaymentMethodEnabled: vi.fn(),
  setTargetAssetCategoryEnabled: vi.fn(),
  setTargetOperatingEntityEnabled: vi.fn(),
  setTargetEmployeeEnabled: vi.fn(),
  setTargetWarehouseEnabled: vi.fn(),
  setTargetFundAccountEnabled: vi.fn(),
  setTargetVehicleEnabled: vi.fn(),
  queryTargetUsers: vi.fn(),
  queryTargetRoles: vi.fn(),
  queryTargetEmployeeCategories: vi.fn(),
  queryTargetPositions: vi.fn(),
  queryTargetMeasurementUnits: vi.fn(),
  queryTargetPaymentMethods: vi.fn(),
  queryTargetAssetCategories: vi.fn(),
  queryTargetOperatingEntities: vi.fn(),
  queryTargetEmployees: vi.fn(),
  queryTargetWarehouses: vi.fn(),
  queryTargetFundAccounts: vi.fn(),
  queryTargetVehicles: vi.fn(),
  queryTargetPermissions: vi.fn(),
  queryTargetDepartments: vi.fn(),
  queryTargetAuxReferences: vi.fn(),
  queryTargetBobReferences: vi.fn(),
  deleteTargetWarehouse: vi.fn(),
  deleteTargetFundAccount: vi.fn(),
  deleteTargetVehicle: vi.fn(),
}))

const queryAssetCategories = vi.mocked(targetApi.queryTargetAssetCategories)
const queryEmployeeCategories = vi.mocked(
  targetApi.queryTargetEmployeeCategories,
)
const queryEmployees = vi.mocked(targetApi.queryTargetEmployees)
const queryMeasurementUnits = vi.mocked(targetApi.queryTargetMeasurementUnits)
const queryOperatingEntities = vi.mocked(targetApi.queryTargetOperatingEntities)
const queryPaymentMethods = vi.mocked(targetApi.queryTargetPaymentMethods)
const queryPermissions = vi.mocked(targetApi.queryTargetPermissions)
const queryPositions = vi.mocked(targetApi.queryTargetPositions)
const queryRoles = vi.mocked(targetApi.queryTargetRoles)
const queryUsers = vi.mocked(targetApi.queryTargetUsers)

const buttonStub = {
  props: ['disabled', 'loading'],
  emits: ['click'],
  template:
    '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
}

const stubs = {
  AppSnackbar: { props: ['message'], template: '<div>{{message}}</div>' },
  ManagementPageFrame: {
    props: ['title'],
    template:
      '<main><h1>{{ title }}</h1><slot name="actions" /><slot name="alerts" /><slot name="filters" /><slot /><slot name="footer" /></main>',
  },
  VAlert: { template: '<div><slot /></div>' },
  VBtn: buttonStub,
  VCard: {
    props: ['title'],
    template: '<section><h2>{{ title }}</h2><slot /></section>',
  },
  VCardActions: { template: '<div><slot /></div>' },
  VCardText: { template: '<div><slot /></div>' },
  VCheckbox: { template: '<input type="checkbox" />' },
  VDataTable: {
    props: ['headers', 'items'],
    setup(
      props: { headers: Array<{ key: string }>; items: object[] },
      {
        slots,
      }: { slots: Record<string, (props: { item: object }) => unknown> },
    ) {
      return () =>
        h(
          'table',
          props.items.map((item) =>
            h(
              'tr',
              props.headers.map((header) =>
                h('td', slots[`item.${header.key}`]?.({ item })),
              ),
            ),
          ),
        )
    },
  },
  VDialog: {
    props: ['modelValue'],
    template: '<div v-if="modelValue"><slot /></div>',
  },
  VPagination: { template: '<div />' },
  VProgressLinear: { template: '<div />' },
  VSelect: {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template:
      '<select :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
  },
  VAutocomplete: {
    props: ['modelValue', 'items', 'label', 'multiple', 'disabled'],
    emits: ['update:modelValue'],
    template: `<label>{{label}}<select :aria-label="label" :multiple="multiple" :disabled="disabled" @change="$emit('update:modelValue',multiple ? [...$event.target.selectedOptions].map(o=>o.value) : $event.target.value)"><option v-for="item in items" :key="item.id" :value="item.id" :selected="Array.isArray(modelValue) ? modelValue.includes(item.id) : modelValue === item.id" :disabled="item.props?.disabled">{{item.name}}</option></select></label>`,
  },
  VSpacer: { template: '<span />' },
  VTextField: {
    props: ['modelValue', 'disabled', 'label'],
    emits: ['update:modelValue'],
    template:
      '<input :aria-label="label" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VTextarea: {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template:
      '<textarea :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VForm: {
    emits: ['submit'],
    template:
      '<form @submit.prevent="$emit(\'submit\', $event)"><slot /></form>',
  },
}

function page(items: readonly object[]) {
  return { items, total: items.length, page: 1, pageSize: 20 }
}

const identity = (id: string) => ({
  id,
  code: `${id}-code`,
  py: `${id}-py`,
  name: `${id} 名称`,
  enabled: true,
  revision: '1',
  availableActions: [],
})

function configureApi(): void {
  queryUsers.mockResolvedValue(page([identity('user')]) as never)
  queryRoles.mockResolvedValue(
    page([
      {
        ...identity('role'),
        type: 'NORMAL',
        manageable: true,
        assignable: true,
        description: null,
      },
    ]) as never,
  )
  queryPermissions.mockResolvedValue(page([]) as never)
  queryEmployeeCategories.mockResolvedValue(
    page([identity('employee-category')]) as never,
  )
  queryEmployees.mockResolvedValue(page([identity('employee')]) as never)
  queryPositions.mockResolvedValue(page([identity('position')]) as never)
  queryMeasurementUnits.mockResolvedValue(
    page([
      { ...identity('measurement-unit'), symbol: 'kg', quantityScale: 0 },
    ]) as never,
  )
  queryPaymentMethods.mockResolvedValue(
    page([identity('payment-method')]) as never,
  )
  queryAssetCategories.mockResolvedValue(
    page([identity('asset-category')]) as never,
  )
  vi.mocked(targetApi.queryTargetDepartments).mockResolvedValue(
    page([identity('department')]) as never,
  )
  queryOperatingEntities.mockResolvedValue(
    page([identity('operating-entity')]) as never,
  )
}

function authorize(paths: string[]): void {
  const session = useTargetSession()
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
  session.csrfToken = 'csrf-token'
  session.apiPaths = paths
}

describe('direct maintenance through the registered resource Host', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    configureApi()
  })
  it('owns measurement-unit creation and cancels without querying again', async () => {
    authorize(['/aux/measurement-unit/query', '/aux/measurement-unit/create'])
    const wrapper = mount(ResourceHost, {
      props: { domain: 'aux', entity: 'measurement-unit' },
      global: { stubs },
    })
    await flushPromises()
    await wrapper.get('[data-testid="list-create"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="direct-edit-form"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('新增计量单位')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '取消')!
      .trigger('click')
    await flushPromises()
    expect(queryMeasurementUnits).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('creates a unit with zero precision through the typed API then refreshes once', async () => {
    authorize(['/aux/measurement-unit/query', '/aux/measurement-unit/create'])
    vi.mocked(targetApi.createTargetMeasurementUnit).mockResolvedValue({
      id: 'new-unit',
    } as never)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'aux', entity: 'measurement-unit' },
      global: { stubs },
    })
    await flushPromises()
    await wrapper.get('[data-testid="list-create"]').trigger('click')
    await flushPromises()
    const inputs = wrapper
      .get('[data-testid="direct-edit-form"]')
      .findAll('input')
    await inputs[0]!.setValue('千克')
    await inputs[1]!.setValue('kg')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '保存')!
      .trigger('click')
    await flushPromises()
    expect(targetApi.createTargetMeasurementUnit).toHaveBeenCalledWith(
      'csrf-token',
      { name: '千克', symbol: 'kg', quantityScale: 0 },
      {},
    )
    expect(queryMeasurementUnits).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('loads user role choices into the dynamic form with a searchable multiselect', async () => {
    authorize(['/app/user/create', '/app/role/query'])
    const wrapper = mount(ResourceHost, {
      props: { domain: 'app', entity: 'user' },
      global: { stubs },
    })
    await flushPromises()
    await wrapper.get('[data-testid="list-create"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="direct-edit-form"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ReferencePicker' }).exists()).toBe(
      true,
    )
    expect(queryRoles).toHaveBeenCalledTimes(1)
    expect(queryUsers).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('loads all four employee references independently and retains their visible choices', async () => {
    authorize([
      '/aux/employee/create',
      '/aux/operating-entity/query',
      '/aux/employee-category/query',
      '/aux/department/query',
      '/aux/position/query',
    ])
    const wrapper = mount(ResourceHost, {
      props: { domain: 'aux', entity: 'employee' },
      global: { stubs },
    })
    await flushPromises()
    await wrapper.get('[data-testid="list-create"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="direct-edit-form"]').text()).toContain(
      'department 名称',
    )
    for (const label of [
      'operating-entity 名称',
      'employee-category 名称',
      'position 名称',
    ])
      expect(wrapper.text()).toContain(label)
    expect(queryEmployees).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('loads only the visible vehicle carrier source under its own authorization', async () => {
    authorize([
      '/aux/vehicle/create',
      '/aux/reference/query',
      '/aux/operating-entity/query',
    ])
    vi.mocked(targetApi.queryTargetAuxReferences).mockResolvedValue([
      { objectId: 'type', code: '罐车' },
    ] as never)
    const wrapper = mount(ResourceHost, {
      props: { domain: 'aux', entity: 'vehicle' },
      global: { stubs },
    })
    await flushPromises()
    await wrapper.get('[data-testid="list-create"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="direct-edit-form"]').text()).toContain(
      '罐车',
    )
    expect(wrapper.text()).toContain('operating-entity 名称')
    expect(targetApi.queryTargetBobReferences).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

const revision = '90071992547409931234'
const refSummary = { id: 'ref-1', code: 'REF', name: '关联资料', enabled: true }
const scalarCases = [
  {
    entity: 'employee-category',
    name: 'EmployeeCategory',
    plural: 'EmployeeCategories',
    input: { name: '类别', description: '说明' },
  },
  {
    entity: 'position',
    name: 'Position',
    plural: 'Positions',
    input: { name: '岗位', description: '' },
  },
  {
    entity: 'measurement-unit',
    name: 'MeasurementUnit',
    plural: 'MeasurementUnits',
    input: { name: '公斤', symbol: 'kg', quantityScale: 0 },
  },
  {
    entity: 'payment-method',
    name: 'PaymentMethod',
    plural: 'PaymentMethods',
    input: {
      name: '收款',
      description: '说明',
      defaultSalesSurcharge: '12345678901234567890.12',
    },
  },
  {
    entity: 'asset-category',
    name: 'AssetCategory',
    plural: 'AssetCategories',
    input: {
      name: '机器',
      description: '设备',
      defaultUsefulLifeMonths: 120,
      defaultResidualRate: '3.25',
    },
  },
  {
    entity: 'operating-entity',
    name: 'OperatingEntity',
    plural: 'OperatingEntities',
    input: {
      legalName: '法人',
      shortName: '简称',
      legalIdentifier: '登记号',
      registeredAddress: '地址',
      contactName: '联系人',
      contactPhone: '电话',
      invoiceTitle: '抬头',
      invoiceAddress: '开票地址',
      invoicePhone: '电话',
      invoiceBank: '银行',
      invoiceAccount: '账号',
      remark: '备注',
    },
  },
] as const
function mockApi(name: string) {
  return vi.mocked(targetApi[name as keyof typeof targetApi]) as ReturnType<
    typeof vi.fn
  >
}
function button(wrapper: ReturnType<typeof mount>, label: string) {
  const value = wrapper.findAll('button').find((item) => item.text() === label)
  if (!value) throw new Error(`missing button ${label}`)
  return value
}
function host(entity: string, domain = 'aux') {
  return mount(ResourceHost, { props: { domain, entity }, global: { stubs } })
}
function prepare(
  entity: string,
  name: string,
  plural: string,
  input: object,
  extra: object = {},
) {
  const row = {
    ...identity(entity),
    revision,
    availableActions: ['edit', 'enable', 'disable', 'delete'],
    ...input,
    ...extra,
  }
  mockApi(`queryTarget${plural}`).mockResolvedValue(page([row]))
  mockApi(`getTarget${name}`).mockResolvedValue(row)
  mockApi(`saveTarget${name}`).mockResolvedValue(row)
  authorize([
    `/${entity === 'user' || entity === 'role' ? 'app' : 'aux'}/${entity}/query`,
    ...['get', 'save', 'create', 'enable', 'disable', 'delete'].map(
      (action) =>
        `/${entity === 'user' || entity === 'role' ? 'app' : 'aux'}/${entity}/${action}`,
    ),
    '/app/role/query',
    '/app/permission/query',
    '/aux/operating-entity/query',
    '/aux/employee-category/query',
    '/aux/department/query',
    '/aux/position/query',
    '/aux/employee/query',
    '/aux/reference/query',
    '/bob/reference/query',
  ])
  return row
}
describe('direct resource persistence mapping', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    configureApi()
  })
  it.each(scalarCases)(
    'reads and saves $entity without losing fields or revision precision',
    async ({ entity, name, plural, input }) => {
      prepare(entity, name, plural, input)
      const wrapper = host(entity)
      await flushPromises()
      await button(wrapper, '编辑').trigger('click')
      await flushPromises()
      await button(wrapper, '保存').trigger('click')
      await flushPromises()
      expect(mockApi(`saveTarget${name}`)).toHaveBeenCalledExactlyOnceWith(
        'csrf-token',
        { ...input, id: entity, revision },
      )
      expect(mockApi(`queryTarget${plural}`)).toHaveBeenCalledTimes(2)
      wrapper.unmount()
    },
  )
  it('retains stopped assigned roles and readonly role assignment while saving a user name', async () => {
    const role = {
      ...refSummary,
      type: 'NORMAL',
      assignable: false,
      enabled: false,
    }
    const input = {
      name: '用户',
      code: 'user-code',
      roles: [role],
      roleAssignmentEditable: false,
      manageable: true,
    }
    prepare('user', 'User', 'Users', input)
    const wrapper = host('user', 'app')
    await flushPromises()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    expect(
      wrapper.get('select[aria-label="角色"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.text()).toContain('关联资料（停用')
    await wrapper.get('input[aria-label="名称"]').setValue('修改后')
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(targetApi.saveTargetUser).toHaveBeenCalledExactlyOnceWith(
      'csrf-token',
      { id: 'user', revision, name: '修改后', roleIds: ['ref-1'] },
    )
    wrapper.unmount()
  })
  it('requires explicit removal of an associated stopped permission before saving a role', async () => {
    const permission = {
      id: 'p1',
      path: '/app/user/query',
      domain: 'app',
      entity: 'user',
      action: 'query',
      description: null,
      status: 'DISABLED',
    }
    prepare('role', 'Role', 'Roles', {
      name: '角色',
      description: null,
      type: 'NORMAL',
      permissions: [permission],
    })
    const wrapper = host('role', 'app')
    await flushPromises()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('停用')
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(targetApi.saveTargetRole).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('含停用关联')
    wrapper.unmount()
  })
  it('saves employee reference IDs and retains saved reference labels', async () => {
    const input = {
      identityKind: 'PERSON',
      legalName: '员工',
      displayName: '显示名称',
      legalIdentifier: '证件号',
      contactName: '',
      phone: '',
      address: '',
      employmentDate: '2026-01-01',
      workPhone: '',
      workEmail: '',
      remark: '',
    }
    prepare('employee', 'Employee', 'Employees', input, {
      operatingEntity: refSummary,
      employeeCategory: refSummary,
      department: refSummary,
      position: refSummary,
    })
    const wrapper = host('employee')
    await flushPromises()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(targetApi.saveTargetEmployee).toHaveBeenCalledExactlyOnceWith(
      'csrf-token',
      {
        ...input,
        id: 'employee',
        revision,
        operatingEntityId: 'ref-1',
        employeeCategoryId: 'ref-1',
        departmentId: 'ref-1',
        positionId: 'ref-1',
      },
    )
    wrapper.unmount()
  })
  it.each([
    {
      entity: 'warehouse',
      name: 'Warehouse',
      plural: 'Warehouses',
      input: {
        name: '仓库',
        address: '',
        contactName: '',
        contactPhone: '',
        remark: '',
      },
      extra: { manager: null },
      reference: { managerEmployeeId: null },
    },
    {
      entity: 'fund-account',
      name: 'FundAccount',
      plural: 'FundAccounts',
      input: {
        name: '资金',
        currency: 'CNY',
        accountName: '账户名',
        bank: '银行',
        branch: '',
        accountNumber: '0001',
        remark: '',
      },
      extra: { operatingEntity: refSummary },
      reference: { operatingEntityId: 'ref-1' },
    },
  ])(
    'saves $entity with its actual reference contract',
    async ({ entity, name, plural, input, extra, reference }) => {
      prepare(entity, name, plural, input, extra)
      const wrapper = host(entity)
      await flushPromises()
      await button(wrapper, '编辑').trigger('click')
      await flushPromises()
      await button(wrapper, '保存').trigger('click')
      await flushPromises()
      expect(mockApi(`saveTarget${name}`)).toHaveBeenCalledExactlyOnceWith(
        'csrf-token',
        { ...input, ...reference, id: entity, revision },
      )
      wrapper.unmount()
    },
  )
  it('saves the exact external carrier entry and false vehicle flag', async () => {
    const input = {
      name: '车辆',
      plateNumber: '粤B12345',
      vin: '',
      engineNumber: '',
      ratedLoadKg: 0,
      bulkWaterCarrier: false,
      remark: '',
    }
    const carrier = {
      kind: 'EXTERNAL',
      otherUnitId: 'ref-1',
      approvalEntryId: 'old-entry',
      code: 'REF',
      name: '历史承运单位',
    }
    prepare('vehicle', 'Vehicle', 'Vehicles', input, {
      vehicleType: refSummary,
      carrier,
    })
    vi.mocked(targetApi.queryTargetAuxReferences).mockResolvedValue([])
    vi.mocked(targetApi.queryTargetBobReferences).mockResolvedValue([
      {
        objectId: 'ref-1',
        sourceApprovalEntryId: 'new-entry',
        code: 'REF',
        name: '新版本',
      },
    ] as never)
    const wrapper = host('vehicle')
    await flushPromises()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(targetApi.saveTargetVehicle).toHaveBeenCalledExactlyOnceWith(
      'csrf-token',
      {
        ...input,
        id: 'vehicle',
        revision,
        vehicleTypeId: 'ref-1',
        carrier: {
          kind: 'EXTERNAL',
          otherUnitId: 'ref-1',
          approvalEntryId: 'old-entry',
        },
      },
    )
    wrapper.unmount()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function openUnit() {
  prepare('measurement-unit', 'MeasurementUnit', 'MeasurementUnits', {
    name: '计量',
    symbol: 'kg',
    quantityScale: 0,
  })
  const wrapper = host('measurement-unit')
  await flushPromises()
  return wrapper
}
describe('direct runtime failure and asynchronous isolation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    configureApi()
  })
  it('retains input on a revision conflict and never replays the stale save', async () => {
    const wrapper = await openUnit()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    vi.mocked(targetApi.saveTargetMeasurementUnit).mockRejectedValue(
      new targetApi.TargetApiError('conflict', 'stale', 'request'),
    )
    await wrapper.get('input[aria-label="名称"]').setValue('保留输入')
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(wrapper.get('input[aria-label="名称"]').element.value).toBe(
      '保留输入',
    )
    expect(button(wrapper, '保存').attributes('disabled')).toBeDefined()
    expect(targetApi.saveTargetMeasurementUnit).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('keeps an unknown save locked even after cancelling and querying', async () => {
    const wrapper = await openUnit()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    vi.mocked(targetApi.saveTargetMeasurementUnit).mockRejectedValue(
      new Error('transport'),
    )
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('请求结果未知')
    await button(wrapper, '取消').trigger('click')
    await flushPromises()
    await wrapper.get('form.dynamic-form').trigger('submit')
    await flushPromises()
    expect(wrapper.findAll('button').some((b) => b.text() === '编辑')).toBe(
      false,
    )
    expect(targetApi.saveTargetMeasurementUnit).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('does not replay a confirmed create when its one refresh fails', async () => {
    const wrapper = await openUnit()
    await button(wrapper, '新增计量单位').trigger('click')
    await flushPromises()
    await wrapper.get('input[aria-label="名称"]').setValue('新单位')
    await wrapper.get('input[aria-label="符号"]').setValue('kg')
    vi.mocked(targetApi.createTargetMeasurementUnit).mockResolvedValue({
      id: 'confirmed',
    } as never)
    queryMeasurementUnits.mockRejectedValueOnce(new Error('refresh failed'))
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(targetApi.createTargetMeasurementUnit).toHaveBeenCalledTimes(1)
    expect(queryMeasurementUnits).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('新建成功（ID：confirmed）')
    expect(wrapper.text()).toContain('列表刷新失败')
    wrapper.unmount()
  })
  it('prevents cancellation and duplicate submission while a write is pending', async () => {
    const wrapper = await openUnit()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    const pending = deferred<never>()
    vi.mocked(targetApi.saveTargetMeasurementUnit).mockReturnValue(
      pending.promise,
    )
    await button(wrapper, '保存').trigger('click')
    expect(button(wrapper, '取消').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '保存').attributes('disabled')).toBeDefined()
    expect(targetApi.saveTargetMeasurementUnit).toHaveBeenCalledTimes(1)
    pending.resolve(undefined as never)
    await flushPromises()
    expect(queryMeasurementUnits).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('ignores detail and write completion from a replaced resource', async () => {
    const wrapper = await openUnit()
    const pending = deferred<never>()
    vi.mocked(targetApi.getTargetMeasurementUnit).mockReturnValue(
      pending.promise,
    )
    await button(wrapper, '编辑').trigger('click')
    await wrapper.setProps({ entity: 'position' })
    await flushPromises()
    pending.resolve({
      ...identity('late'),
      revision,
      availableActions: ['edit'],
      symbol: 'kg',
      quantityScale: 0,
    } as never)
    await flushPromises()
    expect(wrapper.text()).not.toContain('late')
    expect(wrapper.find('[data-testid="direct-edit-form"]').exists()).toBe(
      false,
    )
    wrapper.unmount()
  })
  it('ignores an old write after the Session generation changes without refreshing', async () => {
    const wrapper = await openUnit()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    const pending = deferred<never>()
    vi.mocked(targetApi.saveTargetMeasurementUnit).mockReturnValue(
      pending.promise,
    )
    await button(wrapper, '保存').trigger('click')
    useTargetSession().generation++
    await flushPromises()
    const queries = queryMeasurementUnits.mock.calls.length
    pending.resolve(undefined as never)
    await flushPromises()
    expect(queryMeasurementUnits).toHaveBeenCalledTimes(queries)
    expect(wrapper.find('[data-testid="direct-edit-form"]').exists()).toBe(
      false,
    )
    wrapper.unmount()
  })
  it('stops role pagination when the editor is cancelled', async () => {
    authorize(['/app/user/create', '/app/role/query'])
    const pending = deferred<never>()
    queryRoles.mockReturnValue(pending.promise)
    const wrapper = host('user', 'app')
    await flushPromises()
    await button(wrapper, '新增用户').trigger('click')
    await flushPromises()
    await button(wrapper, '取消').trigger('click')
    await flushPromises()
    pending.resolve({
      items: [{ ...identity('role'), type: 'NORMAL', assignable: true }],
      total: 40,
      page: 1,
      pageSize: 20,
    } as never)
    await flushPromises()
    expect(queryRoles).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('explains missing candidate permission and prevents save without sending an unauthorized request', async () => {
    authorize(['/app/user/create'])
    const wrapper = host('user', 'app')
    await flushPromises()
    await button(wrapper, '新增用户').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('角色查询权限')
    expect(button(wrapper, '保存').attributes('disabled')).toBeDefined()
    expect(queryRoles).not.toHaveBeenCalled()
    expect(queryUsers).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it.each([
    { entity: 'warehouse', name: 'Warehouse', plural: 'Warehouses' },
    { entity: 'fund-account', name: 'FundAccount', plural: 'FundAccounts' },
    { entity: 'vehicle', name: 'Vehicle', plural: 'Vehicles' },
  ])(
    'confirms $entity deletion with the exact revision and locks an unknown result',
    async ({ entity, name, plural }) => {
      prepare(entity, name, plural, {})
      mockApi(`deleteTarget${name}`).mockRejectedValue(new Error('network'))
      const wrapper = host(entity)
      await flushPromises()
      await button(wrapper, '删除').trigger('click')
      await flushPromises()
      const deletes = wrapper
        .findAll('button')
        .filter((b) => b.text() === '删除')
      await deletes.at(-1)!.trigger('click')
      await flushPromises()
      expect(mockApi(`deleteTarget${name}`)).toHaveBeenCalledExactlyOnceWith(
        'csrf-token',
        { id: entity, revision },
      )
      await wrapper.get('form.dynamic-form').trigger('submit')
      await flushPromises()
      expect(wrapper.findAll('button').some((b) => b.text() === '删除')).toBe(
        false,
      )
      wrapper.unmount()
    },
  )
})

describe('fresh editor lifecycle and optional references', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    configureApi()
  })
  it('can create after cancelling an unresolved detail read', async () => {
    const wrapper = await openUnit()
    const pending = deferred<never>()
    vi.mocked(targetApi.getTargetMeasurementUnit).mockReturnValue(
      pending.promise,
    )
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    await button(wrapper, '取消').trigger('click')
    await flushPromises()
    await button(wrapper, '新增计量单位').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="direct-edit-form"]').exists()).toBe(true)
    expect(button(wrapper, '保存').attributes('disabled')).toBeUndefined()
    pending.resolve({
      ...identity('late'),
      symbol: 'stale',
      quantityScale: 0,
    } as never)
    await flushPromises()
    expect(wrapper.get('input[aria-label="符号"]').element.value).toBe('')
    wrapper.unmount()
  })
  it('creates a warehouse with a null optional manager without employee query permission', async () => {
    authorize(['/aux/warehouse/create'])
    vi.mocked(targetApi.createTargetWarehouse).mockResolvedValue({
      id: 'warehouse',
    } as never)
    const wrapper = host('warehouse')
    await flushPromises()
    await button(wrapper, '新增仓库').trigger('click')
    await flushPromises()
    await wrapper.get('input[aria-label="名称"]').setValue('新仓库')
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(targetApi.createTargetWarehouse).toHaveBeenCalledExactlyOnceWith(
      'csrf-token',
      {
        name: '新仓库',
        address: '',
        contactName: '',
        contactPhone: '',
        managerEmployeeId: null,
        remark: '',
      },
      {},
    )
    expect(queryEmployees).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

it('explicitly reads an uncertain user create without treating a match as proof or unlocking replay', async () => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  configureApi()
  authorize(['/app/user/create', '/app/user/query', '/app/role/query'])
  vi.mocked(targetApi.createTargetUser).mockRejectedValue(new Error('network'))
  const wrapper = host('user', 'app')
  await flushPromises()
  await button(wrapper, '新增用户').trigger('click')
  await flushPromises()
  const form = wrapper.get('[data-testid="direct-edit-form"]')
  await form.get('input[aria-label="用户编码"]').setValue('new-code')
  await form.get('input[aria-label="名称"]').setValue('待核实')
  await form.get('input[aria-label="初始密码"]').setValue('test-only')
  await form.get('select[aria-label="角色"]').setValue(['role'])
  await button(wrapper, '保存').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('请求结果未知')
  await button(wrapper, '核实当前资料').trigger('click')
  await flushPromises()
  expect(queryUsers).toHaveBeenLastCalledWith('csrf-token', {
    keyword: 'new-code',
    page: 1,
    pageSize: 20,
  })
  expect(wrapper.text()).toContain('仍未确认，保持锁定')
  expect(button(wrapper, '保存').attributes('disabled')).toBeDefined()
  expect(targetApi.createTargetUser).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})

it('uses the submitted query after editing while discarding a late older response', async () => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  configureApi()
  const wrapper = await openUnit()
  const keyword = wrapper.get('input[aria-label="编码、拼音或名称"]')
  await keyword.setValue('已提交')
  await wrapper.get('form.dynamic-form').trigger('submit')
  await flushPromises()
  const prior = deferred<never>()
  queryMeasurementUnits.mockReturnValueOnce(prior.promise)
  await wrapper.get('form.dynamic-form').trigger('submit')
  await keyword.setValue('未提交输入')
  await button(wrapper, '编辑').trigger('click')
  await flushPromises()
  await button(wrapper, '保存').trigger('click')
  await flushPromises()
  expect(queryMeasurementUnits).toHaveBeenLastCalledWith('csrf-token', {
    keyword: '已提交',
    quantityScale: undefined,
    page: 1,
    pageSize: 20,
  })
  prior.resolve(
    page([{ ...identity('late'), symbol: 'late', quantityScale: 0 }]) as never,
  )
  await flushPromises()
  expect(wrapper.text()).not.toContain('late 名称')
  wrapper.unmount()
})

it('does not display a late verification response for a different unknown row write', async () => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  configureApi()
  const row = prepare(
    'measurement-unit',
    'MeasurementUnit',
    'MeasurementUnits',
    { name: '甲', symbol: 'kg', quantityScale: 0 },
  )
  queryMeasurementUnits.mockResolvedValue(
    page([row, { ...row, id: 'second', name: '乙' }]) as never,
  )
  vi.mocked(targetApi.setTargetMeasurementUnitEnabled).mockRejectedValue(
    new Error('unknown'),
  )
  const wrapper = host('measurement-unit')
  await flushPromises()
  await button(wrapper, '停用').trigger('click')
  await flushPromises()
  const pending = deferred<never>()
  vi.mocked(targetApi.getTargetMeasurementUnit).mockReturnValue(pending.promise)
  await button(wrapper, '核实当前资料').trigger('click')
  await button(wrapper, '停用').trigger('click')
  await flushPromises()
  pending.resolve({ ...row, name: '不应显示的迟到核实' } as never)
  await flushPromises()
  expect(wrapper.text()).not.toContain('不应显示的迟到核实')
  expect(button(wrapper, '核实当前资料').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it('loads the complete paginated role set and keeps nonassignable choices disabled', async () => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  configureApi()
  authorize(['/app/user/create', '/app/role/query'])
  queryRoles.mockResolvedValueOnce({
    items: [{ ...identity('first'), type: 'NORMAL', assignable: false }],
    total: 2,
    page: 1,
    pageSize: 20,
  } as never)
  queryRoles.mockResolvedValueOnce({
    items: [{ ...identity('last'), type: 'NORMAL', assignable: true }],
    total: 2,
    page: 2,
    pageSize: 20,
  } as never)
  const wrapper = host('user', 'app')
  await flushPromises()
  await button(wrapper, '新增用户').trigger('click')
  await flushPromises()
  expect(queryRoles).toHaveBeenNthCalledWith(2, 'csrf-token', {
    keyword: '',
    page: 2,
    pageSize: 20,
  })
  expect(
    wrapper.get('option[value="first"]').attributes('disabled'),
  ).toBeDefined()
  expect(wrapper.get('option[value="last"]').text()).toContain('last 名称')
  wrapper.unmount()
})

it('loads all permissions with the exact pagination contract and enforces delegation choices', async () => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  configureApi()
  authorize(['/app/role/create', '/app/permission/query', '/app/user/query'])
  const permission = {
    id: 'allowed',
    path: '/app/user/query',
    domain: 'app',
    entity: 'user',
    action: 'query',
    description: null,
    status: 'ENABLED',
  }
  queryPermissions.mockResolvedValueOnce({
    items: [permission],
    total: 2,
    page: 1,
    pageSize: 20,
  } as never)
  queryPermissions.mockResolvedValueOnce({
    items: [
      {
        ...permission,
        id: 'forbidden',
        path: '/app/user/save',
        action: 'save',
      },
    ],
    total: 2,
    page: 2,
    pageSize: 20,
  } as never)
  const wrapper = host('role', 'app')
  await flushPromises()
  await button(wrapper, '新增角色').trigger('click')
  await flushPromises()
  expect(queryPermissions).toHaveBeenNthCalledWith(2, 'csrf-token', {
    page: 2,
    pageSize: 20,
  })
  expect(
    wrapper.get('option[value="forbidden"]').attributes('disabled'),
  ).toBeDefined()
  await wrapper.get('input[aria-label="名称"]').setValue('授权角色')
  await wrapper.get('select[aria-label="权限"]').setValue(['allowed'])
  await button(wrapper, '保存').trigger('click')
  await flushPromises()
  expect(targetApi.createTargetRole).toHaveBeenCalledExactlyOnceWith(
    'csrf-token',
    { name: '授权角色', description: null, permissionIds: ['allowed'] },
    expect.any(Object),
  )
  wrapper.unmount()
})

it('keeps the established asset category creation defaults', async () => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  configureApi()
  authorize(['/aux/asset-category/create'])
  const wrapper = host('asset-category')
  await flushPromises()
  await button(wrapper, '新增资产类别').trigger('click')
  await flushPromises()
  expect(
    wrapper.get('input[aria-label="默认使用期限（月）"]').element.value,
  ).toBe('120')
  expect(wrapper.get('input[aria-label="默认残值率（%）"]').element.value).toBe(
    '5.00',
  )
  wrapper.unmount()
})
