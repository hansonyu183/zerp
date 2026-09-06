import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import {
  permissionActionLabels,
  useRoleManagementViewModel,
} from '@/target/pages/app/role/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  createTargetRole: vi.fn(),
  getTargetRole: vi.fn(),
  queryTargetPermissions: vi.fn(),
  queryTargetRoles: vi.fn(),
  saveTargetRole: vi.fn(),
  setTargetRoleEnabled: vi.fn(),
}))

const queryRoles = vi.mocked(targetApi.queryTargetRoles)
const getRole = vi.mocked(targetApi.getTargetRole)
const queryPermissions = vi.mocked(targetApi.queryTargetPermissions)
const createRole = vi.mocked(targetApi.createTargetRole)
const saveRole = vi.mocked(targetApi.saveTargetRole)
const setEnabled = vi.mocked(targetApi.setTargetRoleEnabled)

const role = (overrides: Record<string, unknown> = {}) => ({
  id: 'role-1',
  code: 'ROL-0001',
  py: 'caigou',
  name: '采购',
  description: null,
  enabled: true,
  type: 'NORMAL' as const,
  revision: '9007199254740993',
  manageable: true,
  assignable: true,
  availableActions: ['edit', 'disable'] as const,
  ...overrides,
})

const permission = (
  index: number,
  status: 'ENABLED' | 'DISABLED' = 'ENABLED',
) => ({
  id: `permission-${index}`,
  path: `/bob/customer/${index === 1 ? 'create' : 'query'}`,
  domain: 'bob',
  entity: 'customer',
  action: index === 1 ? 'create' : 'query',
  description: null,
  status,
  revision: '1',
  directRoleCount: 0,
})

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...role(),
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  permissions: [permission(1)],
  ...overrides,
})

function authorize(...paths: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf-token'
  session.apiPaths = paths
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('APP role management public view-model seam', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    queryRoles.mockResolvedValue({
      items: [role()],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    queryPermissions.mockResolvedValue({
      items: [permission(1)],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    getRole.mockResolvedValue(detail() as never)
  })

  it('maps every current permission catalog action to a Chinese label', () => {
    expect(Object.keys(permissionActionLabels).sort()).toEqual([
      'approve',
      'approve-child',
      'approve-over-credit-limit',
      'attachment-cleanup',
      'attachment-read',
      'attachment-stage',
      'audit-history',
      'cancel-child',
      'catalog',
      'create',
      'create-child',
      'delete',
      'disable',
      'enable',
      'export',
      'get',
      'lock',
      'open-document',
      'query',
      'reference',
      'reject',
      'reject-child',
      'reset',
      'reset-password',
      'retry-child',
      'save',
      'save-subunits',
      'submit-change',
      'submit-new',
      'trial',
      'unapprove',
      'unlock',
      'unreject',
      'versions',
    ])
    expect(Object.values(permissionActionLabels)).not.toContain('')
  })

  it('uses the native role query and lower-case server action eligibility', async () => {
    authorize(
      '/app/role/query',
      '/app/role/get',
      '/app/role/save',
      '/app/permission/query',
    )
    const vm = useRoleManagementViewModel()
    vm.list.keyword.value = ' cai '

    await vm.list.submitSearch()

    expect(queryRoles).toHaveBeenCalledWith('csrf-token', {
      keyword: 'cai',
      page: 1,
      pageSize: 20,
    })
    expect(vm.list.canAction('edit', vm.list.items.value[0])).toBe(true)
    expect(vm.list.canAction('disable', vm.list.items.value[0])).toBe(false)
  })

  it('loads every permission page and makes an associated stopped permission explicit', async () => {
    authorize('/app/role/get', '/app/role/save', '/app/permission/query')
    const first = Array.from({ length: 20 }, (_, index) =>
      permission(index + 1),
    )
    queryPermissions
      .mockResolvedValueOnce({
        items: first,
        total: 21,
        page: 1,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        items: [permission(21)],
        total: 21,
        page: 2,
        pageSize: 20,
      } as never)
    getRole.mockResolvedValue(
      detail({ permissions: [permission(22, 'DISABLED')] }) as never,
    )
    const vm = useRoleManagementViewModel()

    const opening = vm.openEdit(role())
    await flushPromises()

    expect(queryPermissions).toHaveBeenNthCalledWith(1, 'csrf-token', {
      page: 1,
      pageSize: 20,
    })
    expect(queryPermissions).toHaveBeenNthCalledWith(2, 'csrf-token', {
      page: 2,
      pageSize: 20,
    })
    expect(vm.editor.permissionIds).toEqual(['permission-22'])
    expect(vm.permissionOptions.value).toContainEqual({
      value: 'permission-22',
      title: '业务资料 · 客户 · 查询（停用）',
      disabled: false,
    })
    expect(vm.permissionOptions.value).toContainEqual({
      type: 'subheader',
      title: '业务资料 · 客户',
    })
    expect(vm.permissionOptions.value.filter((item) => 'type' in item)).toEqual(
      [{ type: 'subheader', title: '业务资料 · 客户' }],
    )
    expect(vm.canSave.value).toBe(false)
    expect(vm.editorError.value).toContain('停用权限')

    vm.editor.permissionIds = ['permission-1']
    expect(vm.canSave.value).toBe(true)
    vm.closeEditor()
    await opening
  })

  it('stops permission paging when the operator cancels the editor', async () => {
    authorize('/app/role/create', '/app/permission/query')
    const first = deferred<{
      items: ReturnType<typeof permission>[]
      total: number
      page: number
      pageSize: number
    }>()
    queryPermissions.mockReturnValueOnce(first.promise as never)
    const vm = useRoleManagementViewModel()

    const opening = vm.openCreate()
    vm.closeEditor()
    first.resolve({
      items: Array.from({ length: 20 }, (_, index) => permission(index + 1)),
      total: 21,
      page: 1,
      pageSize: 20,
    })
    await flushPromises()
    await opening

    expect(queryPermissions).toHaveBeenCalledTimes(1)
    expect(vm.permissionOptions.value).toEqual([])
  })

  it('creates with a nonempty enabled permission set and string revisions on save', async () => {
    authorize(
      '/app/role/create',
      '/app/role/query',
      '/app/role/get',
      '/app/role/save',
      '/app/permission/query',
    )
    createRole.mockResolvedValue(detail() as never)
    saveRole.mockResolvedValue(
      detail({ revision: '9007199254740994' }) as never,
    )
    const vm = useRoleManagementViewModel()

    const creating = vm.list.create()
    await flushPromises()
    Object.assign(vm.editor, {
      name: ' 采购 ',
      description: ' 采购职责 ',
      permissionIds: ['permission-1'],
    })
    await vm.saveEditor()
    await creating
    expect(createRole).toHaveBeenCalledWith('csrf-token', {
      name: '采购',
      description: '采购职责',
      permissionIds: ['permission-1'],
    })

    const editing = vm.openEdit(role())
    await flushPromises()
    vm.editor.name = '高级采购'
    await vm.saveEditor()
    await editing
    expect(saveRole).toHaveBeenCalledWith('csrf-token', {
      id: 'role-1',
      name: '高级采购',
      description: null,
      permissionIds: ['permission-1'],
      revision: '9007199254740993',
    })
  })

  it('locks an unknown save while retaining the editor input for operator review', async () => {
    authorize(
      '/app/role/query',
      '/app/role/get',
      '/app/role/save',
      '/app/permission/query',
    )
    saveRole.mockRejectedValue(new TypeError('network interrupted'))
    const vm = useRoleManagementViewModel()
    await vm.list.initialize()

    const editing = vm.list.edit(vm.list.items.value[0]!)
    await flushPromises()
    vm.editor.name = '待核实角色'
    await vm.saveEditor()
    await editing

    expect(vm.editorOpen.value).toBe(true)
    expect(vm.editor.name).toBe('待核实角色')
    expect(vm.canSave.value).toBe(false)
    expect(vm.editorError.value).toContain('结果未知')
    expect(vm.list.isRowBlocked('role-1')).toBe(true)
  })

  it('does not turn a matching role state into a confirmed outcome after an unknown enablement write', async () => {
    authorize('/app/role/disable', '/app/role/get')
    setEnabled.mockRejectedValue(new TypeError('network interrupted'))
    getRole.mockResolvedValue(
      detail({ enabled: false, revision: '9007199254740994' }) as never,
    )
    const vm = useRoleManagementViewModel()

    await vm.list.disable(role())

    expect(setEnabled).toHaveBeenCalledWith(
      'csrf-token',
      { id: 'role-1', revision: '9007199254740993' },
      false,
    )
    expect(getRole).toHaveBeenCalledWith('csrf-token', 'role-1')
    expect(vm.list.feedback.value).toContain('结果未知')
    expect(vm.list.isRowBlocked('role-1')).toBe(true)
  })
})
