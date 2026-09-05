import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import { useUserManagementViewModel } from '@/target/pages/app/user/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  createTargetUser: vi.fn(),
  getTargetUser: vi.fn(),
  queryTargetRoles: vi.fn(),
  queryTargetUsers: vi.fn(),
  resetTargetUserPassword: vi.fn(),
  saveTargetUser: vi.fn(),
  setTargetUserEnabled: vi.fn(),
}))

const queryUsers = vi.mocked(targetApi.queryTargetUsers)
const getUser = vi.mocked(targetApi.getTargetUser)
const queryRoles = vi.mocked(targetApi.queryTargetRoles)
const createUser = vi.mocked(targetApi.createTargetUser)
const saveUser = vi.mocked(targetApi.saveTargetUser)
const resetPassword = vi.mocked(targetApi.resetTargetUserPassword)

const userDetail = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  username: 'buyer',
  displayName: '采购员',
  status: 'ENABLED' as const,
  system: false,
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
  revision: '3',
  passwordChangedAt: '2026-09-05T00:00:00.000Z',
  roles: [{ id: 'role-1', code: 'ROL-0001', name: '采购' }],
  manageable: true,
  roleAssignmentEditable: true,
  ...overrides,
})

describe('APP user management public view-model seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useTargetSession().csrfToken = 'csrf-token'
    queryUsers.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    queryRoles.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    })
  })

  it('submits explicit filters with the fixed stable ordering', async () => {
    const vm = useUserManagementViewModel()
    vm.filters.search = 'buyer'
    vm.filters.status = 'ENABLED'

    await vm.query(2)

    expect(queryUsers).toHaveBeenCalledWith('csrf-token', {
      page: 2,
      pageSize: 20,
      filters: { search: 'buyer', status: 'ENABLED' },
      sort: [{ field: 'username', order: 'asc' }],
    })
  })

  it('creates a user then reads the committed server detail back', async () => {
    createUser.mockResolvedValue(userDetail() as never)
    getUser.mockResolvedValue(userDetail() as never)
    const vm = useUserManagementViewModel()
    vm.openCreate()
    Object.assign(vm.editor, {
      username: ' buyer ',
      displayName: ' 采购员 ',
      password: 'Temporary-1234',
      roleIds: ['role-1'],
    })

    await vm.save()

    expect(createUser).toHaveBeenCalledWith('csrf-token', {
      username: 'buyer',
      displayName: '采购员',
      password: 'Temporary-1234',
      roleIds: ['role-1'],
    })
    expect(getUser).toHaveBeenCalledWith('csrf-token', 'user-1')
    expect(vm.detail.value?.displayName).toBe('采购员')
  })

  it('saves an edited user with its revision then reads it back', async () => {
    getUser
      .mockResolvedValueOnce(userDetail() as never)
      .mockResolvedValueOnce(
        userDetail({ displayName: '高级采购员', revision: '4' }) as never,
      )
    saveUser.mockResolvedValue(userDetail({ revision: '4' }) as never)
    const vm = useUserManagementViewModel()
    await vm.openEdit('user-1')
    vm.editor.displayName = '高级采购员'

    await vm.save()

    expect(saveUser).toHaveBeenCalledWith('csrf-token', {
      id: 'user-1',
      displayName: '高级采购员',
      roleIds: ['role-1'],
      revision: 3,
    })
    expect(getUser).toHaveBeenCalledTimes(2)
    expect(vm.detail.value?.revision).toBe('4')
  })

  it('shows the one-time password only after a successful reset', async () => {
    getUser
      .mockResolvedValueOnce(userDetail() as never)
      .mockResolvedValueOnce(userDetail({ revision: '4' }) as never)
    resetPassword.mockResolvedValue({ temporaryPassword: 'Once-Only-1234' })
    const vm = useUserManagementViewModel()
    await vm.openEdit('user-1')

    await vm.resetPassword()

    expect(resetPassword).toHaveBeenCalledWith('csrf-token', {
      id: 'user-1',
      revision: 3,
    })
    expect(getUser).toHaveBeenCalledTimes(2)
    expect(vm.detail.value?.revision).toBe('4')
    expect(vm.temporaryPassword.value).toBe('Once-Only-1234')
  })
})
