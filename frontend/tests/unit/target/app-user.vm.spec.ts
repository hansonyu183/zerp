import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
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
  saveTargetUser: vi.fn(),
  setTargetUserEnabled: vi.fn(),
}))

const queryUsers = vi.mocked(targetApi.queryTargetUsers)
const getUser = vi.mocked(targetApi.getTargetUser)
const queryRoles = vi.mocked(targetApi.queryTargetRoles)
const createUser = vi.mocked(targetApi.createTargetUser)
const saveUser = vi.mocked(targetApi.saveTargetUser)
const setEnabled = vi.mocked(targetApi.setTargetUserEnabled)

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  code: 'buyer',
  py: 'caigouyuan',
  name: '采购员',
  enabled: true,
  revision: '9007199254740993',
  availableActions: ['VIEW', 'EDIT', 'DISABLE'] as const,
  ...overrides,
})

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...row(),
  roles: [
    {
      id: 'role-1',
      code: 'ROL-0001',
      name: '采购',
      status: 'ENABLED' as const,
      type: 'NORMAL' as const,
      assignable: true,
    },
  ],
  manageable: true,
  roleAssignmentEditable: true,
  ...overrides,
})

const role = (index: number, assignable = true) => ({
  id: `role-${index}`,
  code: `ROL-${String(index).padStart(4, '0')}`,
  name: `角色${index}`,
  description: null,
  status: 'ENABLED' as const,
  type: 'NORMAL' as const,
  revision: '1',
  assignable,
  availableActions: [],
})

function authorize(...paths: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf-token'
  session.apiPaths = paths
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
  return session
}

describe('APP user management public view-model seam', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    queryUsers.mockResolvedValue({
      items: [row()],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    queryRoles.mockResolvedValue({
      items: [role(1)],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    getUser.mockResolvedValue(detail() as never)
  })

  it('binds the fixed keyword page request and exact row action permissions', async () => {
    authorize(
      '/app/user/query',
      '/app/user/get',
      '/app/user/save',
      '/app/user/disable',
      '/app/role/query',
    )
    const vm = useUserManagementViewModel()
    vm.list.keyword.value = ' cai '

    await vm.list.submitSearch()

    expect(queryUsers).toHaveBeenCalledWith('csrf-token', {
      keyword: 'cai',
      page: 1,
      pageSize: 20,
    })
    expect(vm.list.canAction('edit', vm.list.items.value[0])).toBe(true)
    expect(vm.list.canAction('enable', vm.list.items.value[0])).toBe(false)
    expect(vm.list.canAction('disable', vm.list.items.value[0])).toBe(true)
  })

  it('does not query for create-only access and explains the missing role dependency without sending it', async () => {
    authorize('/app/user/create')
    const vm = useUserManagementViewModel()
    await vm.list.initialize()

    const editor = vm.list.create()
    await flushPromises()

    expect(queryUsers).not.toHaveBeenCalled()
    expect(queryRoles).not.toHaveBeenCalled()
    expect(vm.editorOpen.value).toBe(true)
    expect(vm.editorError.value).toContain('角色查询权限')
    expect(vm.canSave.value).toBe(false)
    vm.closeEditor()
    await editor
  })

  it('loads every active-role page and merges a stopped assigned role without removing or re-enabling it', async () => {
    authorize('/app/user/get', '/app/user/save', '/app/role/query')
    const firstRoles = Array.from({ length: 20 }, (_, index) => role(index + 1))
    queryRoles
      .mockResolvedValueOnce({
        items: firstRoles,
        total: 21,
        page: 1,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        items: [role(22)],
        total: 21,
        page: 2,
        pageSize: 20,
      } as never)
    getUser.mockResolvedValue(
      detail({
        roles: [
          {
            id: 'role-1',
            code: 'ROL-0001',
            name: '角色1',
            status: 'ENABLED',
            type: 'NORMAL',
            assignable: true,
          },
          {
            id: 'role-21',
            code: 'ROL-0021',
            name: '角色21',
            status: 'DISABLED',
            type: 'SYSTEM',
            assignable: false,
          },
        ],
      }) as never,
    )
    const vm = useUserManagementViewModel()

    const opening = vm.openEdit(row())
    await flushPromises()

    expect(queryRoles).toHaveBeenNthCalledWith(1, 'csrf-token', {
      page: 1,
      pageSize: 20,
      filters: { status: 'ENABLED' },
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(queryRoles).toHaveBeenNthCalledWith(2, 'csrf-token', {
      page: 2,
      pageSize: 20,
      filters: { status: 'ENABLED' },
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(vm.editor.roleIds).toEqual(['role-1', 'role-21'])
    expect(
      vm.roleOptions.value.find((option) => option.value === 'role-21'),
    ).toEqual({
      title: 'ROL-0021 · 角色21（停用 · 系统角色）',
      value: 'role-21',
      disabled: false,
    })
    vm.editor.roleIds = ['role-1']
    expect(
      vm.roleOptions.value.find((option) => option.value === 'role-21')
        ?.disabled,
    ).toBe(true)
    vm.closeEditor()
    await opening
  })

  it('keeps the edit promise pending on validation failure then saves the string revision without a readback', async () => {
    authorize(
      '/app/user/query',
      '/app/user/get',
      '/app/user/save',
      '/app/role/query',
    )
    saveUser.mockResolvedValue(
      detail({ name: '高级采购员', revision: '9007199254740994' }) as never,
    )
    const vm = useUserManagementViewModel()
    await vm.list.initialize()

    let editorSettled = false
    const opening = vm.list.edit(vm.list.items.value[0]!)
    void opening.finally(() => {
      editorSettled = true
    })
    await flushPromises()
    vm.editor.name = ' '
    await vm.saveEditor()
    expect(editorSettled).toBe(false)
    expect(vm.editorOpen.value).toBe(true)

    vm.editor.name = ' 高级采购员 '
    await vm.saveEditor()
    await opening

    expect(saveUser).toHaveBeenCalledWith('csrf-token', {
      id: 'user-1',
      name: '高级采购员',
      roleIds: ['role-1'],
      revision: '9007199254740993',
    })
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(queryUsers).toHaveBeenCalledTimes(2)
    expect(vm.editorOpen.value).toBe(false)
  })

  it('refuses cancellation during an in-flight save and refreshes after the confirmed result', async () => {
    authorize(
      '/app/user/query',
      '/app/user/get',
      '/app/user/save',
      '/app/role/query',
    )
    let resolveSave!: (value: ReturnType<typeof detail>) => void
    saveUser.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve
      }) as never,
    )
    const vm = useUserManagementViewModel()
    await vm.list.initialize()
    let editorSettled = false
    const opening = vm.list.edit(vm.list.items.value[0]!)
    void opening.finally(() => {
      editorSettled = true
    })
    await flushPromises()

    const saving = vm.saveEditor()
    await flushPromises()
    expect(vm.saving.value).toBe(true)
    expect(vm.canSave.value).toBe(true)
    vm.closeEditor()

    expect(vm.editorOpen.value).toBe(true)
    expect(vm.editor.name).toBe('采购员')
    expect(editorSettled).toBe(false)

    resolveSave(detail({ revision: '9007199254740994' }))
    await saving
    await opening

    expect(editorSettled).toBe(true)
    expect(vm.editorOpen.value).toBe(false)
    expect(queryUsers).toHaveBeenCalledTimes(2)
  })

  it('creates from the target fields, clears the password and does not force a detail read', async () => {
    authorize('/app/user/create', '/app/role/query')
    createUser.mockResolvedValue(detail() as never)
    const vm = useUserManagementViewModel()
    const opening = vm.list.create()
    await flushPromises()
    Object.assign(vm.editor, {
      code: ' buyer ',
      name: ' 采购员 ',
      password: 'Temporary-1234',
      roleIds: ['role-1'],
    })

    await vm.saveEditor()
    await opening

    expect(createUser).toHaveBeenCalledWith('csrf-token', {
      code: 'buyer',
      name: '采购员',
      password: 'Temporary-1234',
      roleIds: ['role-1'],
    })
    expect(getUser).not.toHaveBeenCalled()
    expect(vm.editor.password).toBe('')
    expect(vm.editorOpen.value).toBe(false)
  })

  it('keeps duplicate-code and user_changed forms open and never replays a stale revision', async () => {
    authorize(
      '/app/user/query',
      '/app/user/get',
      '/app/user/create',
      '/app/user/save',
      '/app/role/query',
    )
    createUser.mockRejectedValue(
      new targetApi.TargetApiError('conflict', 'diagnostic', 'request-1'),
    )
    const vm = useUserManagementViewModel()
    const creating = vm.list.create()
    await flushPromises()
    Object.assign(vm.editor, {
      code: 'buyer',
      name: '采购员',
      password: 'Temporary-1234',
      roleIds: ['role-1'],
    })
    await vm.saveEditor()

    expect(vm.editorOpen.value).toBe(true)
    expect(vm.editor.code).toBe('buyer')
    expect(vm.editor.password).toBe('Temporary-1234')
    expect(vm.editorError.value).toBe('用户编码已存在或当前状态不允许此操作。')
    vm.closeEditor()
    await creating

    await vm.list.initialize()
    saveUser.mockRejectedValue(
      new targetApi.TargetApiError('user_changed', 'diagnostic', 'request-2'),
    )
    let editSettled = false
    const editing = vm.list.edit(vm.list.items.value[0]!)
    void editing.finally(() => {
      editSettled = true
    })
    await flushPromises()
    await vm.saveEditor()

    expect(vm.editorOpen.value).toBe(true)
    expect(vm.editor.revision).toBe('9007199254740993')
    expect(vm.editorError.value).toBe(
      '数据已被其他操作修改，请刷新列表后重试。',
    )
    expect(vm.canSave.value).toBe(false)
    expect(editSettled).toBe(false)
    await vm.saveEditor()
    expect(saveUser).toHaveBeenCalledTimes(1)

    vm.closeEditor()
    await editing
    expect(vm.list.isRowBlocked('user-1')).toBe(false)

    const reopened = vm.list.edit(vm.list.items.value[0]!)
    await flushPromises()
    expect(getUser).toHaveBeenCalledTimes(2)
    vm.closeEditor()
    await reopened
  })

  it('verifies an uncertain disable through fresh detail and never converts revision to Number', async () => {
    authorize('/app/user/disable', '/app/user/get')
    setEnabled.mockRejectedValue(new TypeError('network interrupted'))
    getUser.mockResolvedValue(
      detail({ enabled: false, revision: '9007199254740994' }) as never,
    )
    const vm = useUserManagementViewModel()

    await vm.list.disable(row())

    expect(setEnabled).toHaveBeenCalledWith(
      'csrf-token',
      { id: 'user-1', revision: '9007199254740993' },
      false,
    )
    expect(getUser).toHaveBeenCalledWith('csrf-token', 'user-1')
    expect(vm.list.feedback.value).toBe('操作成功。')
  })

  it('does not verify an abandoned write with a replacement account session', async () => {
    const session = authorize('/app/user/disable', '/app/user/get')
    let rejectWrite!: (cause: unknown) => void
    setEnabled.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectWrite = reject
      }),
    )
    const vm = useUserManagementViewModel()
    const writing = vm.list.disable(row())

    vm.dispose()
    session.csrfToken = 'replacement-session'
    session.user = { id: 'another-admin', code: 'another', name: '另一管理员' }
    rejectWrite(new TypeError('network interrupted'))
    await writing

    expect(getUser).not.toHaveBeenCalled()
    expect(queryUsers).not.toHaveBeenCalled()
  })

  it('uses authorized query pages to verify an uncertain row write without detail permission', async () => {
    authorize('/app/user/query', '/app/user/disable')
    const vm = useUserManagementViewModel()
    await vm.list.initialize()
    vm.list.keyword.value = 'not submitted'
    setEnabled.mockRejectedValueOnce(new TypeError('network interrupted'))
    queryUsers
      .mockResolvedValueOnce({
        items: [row({ id: 'different-user', enabled: false, revision: '2' })],
        total: 21,
        page: 1,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        items: [row({ enabled: false, revision: '9007199254740994' })],
        total: 21,
        page: 2,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        items: [row({ enabled: false, revision: '9007199254740994' })],
        total: 1,
        page: 1,
        pageSize: 20,
      } as never)

    await vm.list.disable(vm.list.items.value[0]!)

    expect(getUser).not.toHaveBeenCalled()
    expect(queryUsers).toHaveBeenNthCalledWith(2, 'csrf-token', {
      keyword: 'buyer',
      page: 1,
      pageSize: 20,
    })
    expect(queryUsers).toHaveBeenNthCalledWith(3, 'csrf-token', {
      keyword: 'buyer',
      page: 2,
      pageSize: 20,
    })
    expect(queryUsers).toHaveBeenNthCalledWith(4, 'csrf-token', {
      keyword: '',
      page: 1,
      pageSize: 20,
    })
    expect(vm.list.appliedQuery.value).toEqual({ keyword: '', page: 1 })
    expect(vm.list.feedback.value).toBe('操作成功。')
    expect(setEnabled).toHaveBeenCalledTimes(1)
  })

  it('does not treat unchanged revision and matching edit fields as a confirmed uncertain save', async () => {
    authorize(
      '/app/user/query',
      '/app/user/get',
      '/app/user/save',
      '/app/role/query',
    )
    getUser
      .mockResolvedValueOnce(detail() as never)
      .mockResolvedValueOnce(detail() as never)
    saveUser.mockRejectedValue(new TypeError('network interrupted'))
    const vm = useUserManagementViewModel()
    await vm.list.initialize()

    const opening = vm.list.edit(vm.list.items.value[0]!)
    await flushPromises()
    await vm.saveEditor()
    await opening

    expect(getUser).toHaveBeenCalledTimes(2)
    expect(vm.list.feedback.value).toContain('结果未知')
    expect(vm.list.isRowBlocked('user-1')).toBe(true)
  })

  it('clears sensitive editor state and ignores late detail when disposed', async () => {
    authorize('/app/user/get', '/app/user/save', '/app/role/query')
    let resolveDetail!: (value: ReturnType<typeof detail>) => void
    getUser.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDetail = resolve
      }) as never,
    )
    const vm = useUserManagementViewModel()
    void vm.openEdit(row())
    vm.editor.password = 'secret'

    vm.dispose()
    resolveDetail(detail({ name: '晚到结果' }))
    await flushPromises()

    expect(vm.editorOpen.value).toBe(false)
    expect(vm.editor.password).toBe('')
    expect(vm.editor.name).toBe('')
  })
})
