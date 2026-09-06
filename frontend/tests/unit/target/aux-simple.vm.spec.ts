import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import {
  useEmployeeCategoryManagementViewModel,
  usePositionManagementViewModel,
} from '@/target/pages/aux/simple/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  createTargetEmployeeCategory: vi.fn(),
  createTargetPosition: vi.fn(),
  getTargetEmployeeCategory: vi.fn(),
  getTargetPosition: vi.fn(),
  queryTargetEmployeeCategories: vi.fn(),
  queryTargetPositions: vi.fn(),
  saveTargetEmployeeCategory: vi.fn(),
  saveTargetPosition: vi.fn(),
  setTargetEmployeeCategoryEnabled: vi.fn(),
  setTargetPositionEnabled: vi.fn(),
}))

const queryEmployeeCategories = vi.mocked(
  targetApi.queryTargetEmployeeCategories,
)
const getEmployeeCategory = vi.mocked(targetApi.getTargetEmployeeCategory)
const createEmployeeCategory = vi.mocked(targetApi.createTargetEmployeeCategory)
const saveEmployeeCategory = vi.mocked(targetApi.saveTargetEmployeeCategory)
const queryPositions = vi.mocked(targetApi.queryTargetPositions)
const getPosition = vi.mocked(targetApi.getTargetPosition)
const setPositionEnabled = vi.mocked(targetApi.setTargetPositionEnabled)

const category = (overrides: Record<string, unknown> = {}) => ({
  id: 'category-1',
  code: 'ECT-0001',
  py: 'caigou',
  name: '采购人员',
  enabled: true,
  revision: '9007199254740993',
  availableActions: ['edit', 'disable'] as const,
  ...overrides,
})

const detail = (overrides: Record<string, unknown> = {}) => ({
  ...category(),
  description: '采购岗位分类',
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

describe('AUX simple management public view-model seam', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    queryEmployeeCategories.mockResolvedValue({
      items: [category()],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    getEmployeeCategory.mockResolvedValue(detail() as never)
    queryPositions.mockResolvedValue({
      items: [category({ id: 'position-1', code: 'POS-0001', name: '采购员' })],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    getPosition.mockResolvedValue(
      detail({ id: 'position-1', code: 'POS-0001', name: '采购员' }) as never,
    )
  })

  it('queries employee categories with the fixed three-field search page and server action eligibility', async () => {
    authorize(
      '/aux/employee-category/query',
      '/aux/employee-category/get',
      '/aux/employee-category/save',
      '/aux/employee-category/disable',
    )
    const vm = useEmployeeCategoryManagementViewModel()
    vm.list.keyword.value = ' cai '

    await vm.list.submitSearch()

    expect(queryEmployeeCategories).toHaveBeenCalledWith('csrf-token', {
      keyword: 'cai',
      page: 1,
      pageSize: 20,
    })
    expect(vm.list.canAction('edit', vm.list.items.value[0])).toBe(true)
    expect(vm.list.canAction('enable', vm.list.items.value[0])).toBe(false)
    expect(vm.list.canAction('disable', vm.list.items.value[0])).toBe(true)
  })

  it('uses the same presentation contract for positions and never requests a page without query access', async () => {
    authorize('/aux/position/create')
    const vm = usePositionManagementViewModel()

    await vm.list.initialize()
    const opening = vm.list.create()
    await flushPromises()

    expect(queryPositions).not.toHaveBeenCalled()
    expect(vm.editorOpen.value).toBe(true)
    vm.closeEditor()
    await opening
  })

  it('creates and edits one name and description fact with a string revision', async () => {
    authorize(
      '/aux/employee-category/create',
      '/aux/employee-category/query',
      '/aux/employee-category/get',
      '/aux/employee-category/save',
    )
    createEmployeeCategory.mockResolvedValue(detail() as never)
    saveEmployeeCategory.mockResolvedValue(
      detail({ name: '高级采购人员', revision: '9007199254740994' }) as never,
    )
    const vm = useEmployeeCategoryManagementViewModel()

    const creating = vm.list.create()
    vm.editor.name = ' 采购人员 '
    vm.editor.description = ' 采购职责 '
    await vm.saveEditor()
    await creating
    expect(createEmployeeCategory).toHaveBeenCalledWith('csrf-token', {
      name: '采购人员',
      description: '采购职责',
    })

    const editing = vm.list.edit(category())
    await flushPromises()
    vm.editor.name = ' 高级采购人员 '
    vm.editor.description = ' 高级采购职责 '
    await vm.saveEditor()
    await editing
    expect(saveEmployeeCategory).toHaveBeenCalledWith('csrf-token', {
      id: 'category-1',
      name: '高级采购人员',
      description: '高级采购职责',
      revision: '9007199254740993',
    })
  })

  it('keeps a confirmed created identifier for operator verification when the list refresh fails and blocks replay', async () => {
    authorize('/aux/employee-category/create', '/aux/employee-category/query')
    queryEmployeeCategories
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      } as never)
      .mockRejectedValueOnce(new Error('refresh failed'))
    createEmployeeCategory.mockResolvedValue({
      id: 'category-created',
      revision: '9007199254740994',
      enabled: true,
    } as never)
    const vm = useEmployeeCategoryManagementViewModel()
    await vm.list.initialize()

    const creating = vm.list.create()
    vm.editor.name = '待核实人员分类'
    vm.editor.description = '列表刷新失败后保留 ID'
    await vm.saveEditor()
    await creating

    expect(vm.lastCreatedId.value).toBe('category-created')
    expect(vm.creationNotice.value).toContain('category-created')
    expect(vm.list.feedback.value).toBe('操作已成功，但列表刷新失败。')
    expect(vm.list.actionBlocked.value).toBe(true)
    await vm.list.create()
    expect(createEmployeeCategory).toHaveBeenCalledTimes(1)
  })

  it('locks an unknown position enablement result and keeps a later response from a closed editor out of view state', async () => {
    authorize(
      '/aux/position/get',
      '/aux/position/disable',
      '/aux/position/save',
    )
    setPositionEnabled.mockRejectedValue(new TypeError('network interrupted'))
    const loading = deferred<ReturnType<typeof detail>>()
    getPosition.mockReturnValueOnce(loading.promise as never)
    const vm = usePositionManagementViewModel()
    const item = category({ id: 'position-1', code: 'POS-0001' })

    const editing = vm.list.edit(item)
    vm.closeEditor()
    loading.resolve(detail({ id: 'position-1', code: 'POS-0001' }))
    await editing
    await flushPromises()
    expect(vm.editorOpen.value).toBe(false)
    expect(vm.editor.name).toBe('')

    await vm.list.disable(item)
    expect(setPositionEnabled).toHaveBeenCalledWith(
      'csrf-token',
      { id: 'position-1', revision: '9007199254740993' },
      false,
    )
    expect(getPosition).toHaveBeenCalledWith('csrf-token', 'position-1')
    expect(vm.list.feedback.value).toContain('结果未知')
    expect(vm.list.isRowBlocked('position-1')).toBe(true)
  })
})
