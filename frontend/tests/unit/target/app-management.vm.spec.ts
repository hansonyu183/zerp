import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import { useMenuManagementViewModel } from '@/target/pages/app/menu/vm.ts'
import { usePermissionManagementViewModel } from '@/target/pages/app/permission/vm.ts'
import { useRoleManagementViewModel } from '@/target/pages/app/role/vm.ts'
import { useSystemParameterViewModel } from '@/target/pages/app/system-parameter/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  activateTargetMenu: vi.fn(),
  createTargetRole: vi.fn(),
  getTargetMenu: vi.fn(),
  getTargetPermission: vi.fn(),
  getTargetRole: vi.fn(),
  getTargetSystemParameter: vi.fn(),
  queryTargetPermissions: vi.fn(),
  queryTargetRoles: vi.fn(),
  queryTargetSystemParameters: vi.fn(),
  resetTargetBusinessMenu: vi.fn(),
  resetTargetSystemParameter: vi.fn(),
  saveTargetBusinessMenu: vi.fn(),
  saveTargetRole: vi.fn(),
  saveTargetSystemParameter: vi.fn(),
  setTargetRoleEnabled: vi.fn(),
}))

const role = (overrides: Record<string, unknown> = {}) => ({
  id: 'role-1',
  code: 'ROL-0001',
  name: '采购',
  description: null,
  status: 'ENABLED' as const,
  type: 'NORMAL' as const,
  availableActions: ['VIEW', 'EDIT', 'DISABLE'] as const,
  manageable: true,
  assignable: true,
  revision: '2',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
  permissions: [
    {
      id: 'permission-1',
      path: '/bob/supplier/query',
      domain: 'bob',
      entity: 'supplier',
      action: 'query',
      description: null,
      status: 'ENABLED' as const,
    },
  ],
  ...overrides,
})

const permission = {
  id: 'permission-1',
  path: '/bob/supplier/query',
  domain: 'bob',
  entity: 'supplier',
  action: 'query',
  description: null,
  status: 'ENABLED' as const,
  revision: '1',
  directRoleCount: 1,
}

const parameter = (overrides: Record<string, unknown> = {}) => ({
  parameterKey: 'app.enterprise-name',
  name: '企业名称',
  description: null,
  valueType: 'STRING' as const,
  configuredValue: 'ZERP',
  defaultValue: 'ZERP',
  editable: true,
  constraints: null,
  revision: '5',
  ...overrides,
})

const menu = (overrides: Record<string, unknown> = {}) => ({
  mode: 'DEFAULT' as const,
  revision: '4',
  defaultMenu: { items: [] },
  businessMenu: { items: [] },
  navigation: { items: [] },
  availableRoutes: [
    {
      routeKey: 'app-user',
      routePath: '/app/user',
      displayName: '用户管理',
      permissionCode: '/app/user/query',
    },
  ],
  ...overrides,
})

describe('remaining APP administration public seams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useTargetSession().csrfToken = 'csrf-token'
  })

  it('saves a role and reads its committed detail back', async () => {
    vi.mocked(targetApi.queryTargetPermissions).mockResolvedValue({
      items: [permission],
      total: 1,
      page: 1,
      pageSize: 100,
    })
    vi.mocked(targetApi.getTargetRole)
      .mockResolvedValueOnce(role() as never)
      .mockResolvedValueOnce(role({ name: '采购主管', revision: '3' }) as never)
    vi.mocked(targetApi.saveTargetRole).mockResolvedValue(role() as never)
    const vm = useRoleManagementViewModel()
    await vm.openEdit('role-1')
    vm.editor.name = '采购主管'
    await vm.save()

    expect(targetApi.saveTargetRole).toHaveBeenCalledWith('csrf-token', {
      id: 'role-1',
      name: '采购主管',
      description: null,
      permissionIds: ['permission-1'],
      revision: 2,
    })
    expect(targetApi.getTargetRole).toHaveBeenCalledTimes(2)
    expect(vm.detail.value?.revision).toBe('3')
  })

  it('queries permission facts and reads a selected permission', async () => {
    vi.mocked(targetApi.queryTargetPermissions).mockResolvedValue({
      items: [permission],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    vi.mocked(targetApi.getTargetPermission).mockResolvedValue(permission)
    const vm = usePermissionManagementViewModel()
    vm.filters.domain = 'bob'
    await vm.query(1)
    await vm.openDetail('permission-1')

    expect(targetApi.queryTargetPermissions).toHaveBeenCalledWith(
      'csrf-token',
      {
        page: 1,
        pageSize: 20,
        filters: { domain: 'bob' },
        sort: [{ field: 'path', order: 'asc' }],
      },
    )
    expect(vm.detail.value?.directRoleCount).toBe(1)
  })

  it('saves a system parameter and reads the committed value back', async () => {
    vi.mocked(targetApi.getTargetSystemParameter)
      .mockResolvedValueOnce(parameter() as never)
      .mockResolvedValueOnce(
        parameter({ configuredValue: 'ZERP China', revision: '6' }) as never,
      )
    vi.mocked(targetApi.saveTargetSystemParameter).mockResolvedValue(
      parameter() as never,
    )
    const vm = useSystemParameterViewModel()
    await vm.openEdit('app.enterprise-name')
    vm.configuredValue.value = 'ZERP China'
    await vm.save()

    expect(targetApi.saveTargetSystemParameter).toHaveBeenCalledWith(
      'csrf-token',
      {
        key: 'app.enterprise-name',
        configuredValue: 'ZERP China',
        revision: 5,
      },
    )
    expect(targetApi.getTargetSystemParameter).toHaveBeenCalledTimes(2)
    expect(vm.detail.value?.configuredValue).toBe('ZERP China')
  })

  it('saves a business menu and reads the resulting menu back', async () => {
    vi.mocked(targetApi.getTargetMenu)
      .mockResolvedValueOnce(menu() as never)
      .mockResolvedValueOnce(menu({ mode: 'BUSINESS', revision: '5' }) as never)
    vi.mocked(targetApi.saveTargetBusinessMenu).mockResolvedValue(
      menu() as never,
    )
    const vm = useMenuManagementViewModel()
    await vm.load()
    vm.addRoute('app-user')
    await vm.save()

    expect(targetApi.saveTargetBusinessMenu).toHaveBeenCalledWith(
      'csrf-token',
      expect.objectContaining({ revision: 4 }),
    )
    expect(targetApi.getTargetMenu).toHaveBeenCalledTimes(2)
    expect(vm.menu.value?.revision).toBe('5')
  })
})
