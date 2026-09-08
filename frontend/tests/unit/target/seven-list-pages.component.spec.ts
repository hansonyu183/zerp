import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { targetResourceRegistry } from '@/target/navigation/registry.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  queryTargetAssetCategories: vi.fn(),
  queryTargetEmployeeCategories: vi.fn(),
  queryTargetEmployees: vi.fn(),
  queryTargetMeasurementUnits: vi.fn(),
  queryTargetOperatingEntities: vi.fn(),
  queryTargetPaymentMethods: vi.fn(),
  queryTargetPermissions: vi.fn(),
  queryTargetPositions: vi.fn(),
  queryTargetRoles: vi.fn(),
  queryTargetUsers: vi.fn(),
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
  AppSnackbar: { template: '<div />' },
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
  VSpacer: { template: '<span />' },
  VTextField: {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
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

describe('registered ListPage consumers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    configureApi()
  })

  it('mounts every registry definition through Host, queries once, displays contract fields, and cancels its retained editor without a refresh', async () => {
    const cases = [
      {
        domain: 'app',
        entity: 'user',
        query: queryUsers,
        paths: ['/app/user/query', '/app/user/create', '/app/role/query'],
        editor: '新增用户',
        code: 'user-code',
        name: 'user 名称',
      },
      {
        domain: 'app',
        entity: 'role',
        query: queryRoles,
        paths: ['/app/role/query', '/app/role/create', '/app/permission/query'],
        editor: '新增角色',
        code: 'role-code',
        name: 'role 名称',
      },
      {
        domain: 'aux',
        entity: 'employee-category',
        query: queryEmployeeCategories,
        paths: [
          '/aux/employee-category/query',
          '/aux/employee-category/create',
        ],
        editor: '新增员工分类',
        code: 'employee-category-code',
        name: 'employee-category 名称',
      },
      {
        domain: 'aux',
        entity: 'position',
        query: queryPositions,
        paths: ['/aux/position/query', '/aux/position/create'],
        editor: '新增岗位',
        code: 'position-code',
        name: 'position 名称',
      },
      {
        domain: 'aux',
        entity: 'measurement-unit',
        query: queryMeasurementUnits,
        paths: ['/aux/measurement-unit/query', '/aux/measurement-unit/create'],
        editor: '新增计量单位',
        code: 'measurement-unit-code',
        name: 'measurement-unit 名称',
      },
      {
        domain: 'aux',
        entity: 'payment-method',
        query: queryPaymentMethods,
        paths: ['/aux/payment-method/query', '/aux/payment-method/create'],
        editor: '新增收款方式',
        code: 'payment-method-code',
        name: 'payment-method 名称',
      },
      {
        domain: 'aux',
        entity: 'asset-category',
        query: queryAssetCategories,
        paths: ['/aux/asset-category/query', '/aux/asset-category/create'],
        editor: '新增资产类别',
        code: 'asset-category-code',
        name: 'asset-category 名称',
      },
      {
        domain: 'aux',
        entity: 'operating-entity',
        query: queryOperatingEntities,
        paths: ['/aux/operating-entity/query', '/aux/operating-entity/create'],
        editor: '新增经营主体',
        code: 'operating-entity-code',
        name: 'operating-entity 名称',
      },
      {
        domain: 'aux',
        entity: 'employee',
        query: queryEmployees,
        paths: ['/aux/employee/query', '/aux/employee/create'],
        editor: '新增员工',
        code: 'employee-code',
        name: 'employee 名称',
      },
    ] as const

    for (const current of cases) {
      vi.clearAllMocks()
      configureApi()
      const pinia = createPinia()
      setActivePinia(pinia)
      authorize([...current.paths])
      const wrapper = mount(ResourceHost, {
        props: {
          domain: current.domain,
          entity: current.entity,
          registry: targetResourceRegistry,
        },
        global: { plugins: [pinia], stubs },
      })
      await flushPromises()

      expect(current.query).toHaveBeenCalledTimes(1)
      expect(wrapper.text()).toContain(current.code)
      expect(wrapper.text()).toContain(current.name)
      expect(wrapper.text()).toContain('启用')

      await wrapper.get('[data-testid="list-create"]').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain(current.editor)
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '取消')!
        .trigger('click')
      await flushPromises()

      expect(current.query).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    }
  })

  it('keeps a resource with non-query authority reachable without list or reference requests', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    authorize(['/app/user/create'])
    const wrapper = mount(ResourceHost, {
      props: {
        domain: 'app',
        entity: 'user',
        registry: targetResourceRegistry,
      },
      global: { plugins: [pinia], stubs },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="list-create"]')).toBeTruthy()
    expect(wrapper.text()).toContain('当前账号没有查询权限')
    expect(queryUsers).not.toHaveBeenCalled()
    expect(queryRoles).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('passes an integer quantityScale filter of zero through the registered measurement-unit page', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    authorize(['/aux/measurement-unit/query'])
    const wrapper = mount(ResourceHost, {
      props: {
        domain: 'aux',
        entity: 'measurement-unit',
        registry: targetResourceRegistry,
      },
      global: { plugins: [pinia], stubs },
    })
    await flushPromises()

    await wrapper.get('[data-testid="field-quantityScale"]').setValue('0')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(queryMeasurementUnits).toHaveBeenLastCalledWith('csrf-token', {
      keyword: '',
      quantityScale: 0,
      page: 1,
      pageSize: 20,
    })
    wrapper.unmount()
  })
})
