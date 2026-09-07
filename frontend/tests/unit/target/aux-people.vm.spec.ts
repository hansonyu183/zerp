import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import { useEmployeeManagementViewModel } from '@/target/pages/aux/employee/vm.ts'
import { useOperatingEntityManagementViewModel } from '@/target/pages/aux/operating-entity/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  createTargetEmployee: vi.fn(),
  createTargetOperatingEntity: vi.fn(),
  getTargetEmployee: vi.fn(),
  getTargetOperatingEntity: vi.fn(),
  queryTargetDepartments: vi.fn(),
  queryTargetEmployeeCategories: vi.fn(),
  queryTargetEmployees: vi.fn(),
  queryTargetOperatingEntities: vi.fn(),
  queryTargetPositions: vi.fn(),
  saveTargetEmployee: vi.fn(),
  saveTargetOperatingEntity: vi.fn(),
  setTargetEmployeeEnabled: vi.fn(),
  setTargetOperatingEntityEnabled: vi.fn(),
}))

const createOperatingEntity = vi.mocked(targetApi.createTargetOperatingEntity)
const queryOperatingEntities = vi.mocked(targetApi.queryTargetOperatingEntities)
const queryEmployees = vi.mocked(targetApi.queryTargetEmployees)
const queryEmployeeCategories = vi.mocked(
  targetApi.queryTargetEmployeeCategories,
)
const queryDepartments = vi.mocked(targetApi.queryTargetDepartments)
const queryPositions = vi.mocked(targetApi.queryTargetPositions)
const createEmployee = vi.mocked(targetApi.createTargetEmployee)

const page = (items: readonly object[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
})

const operatingEntity = (overrides: Record<string, unknown> = {}) => ({
  id: 'ope-1',
  code: 'OPE-0001',
  py: 'beijing',
  name: '北京示例有限公司',
  enabled: true,
  revision: '9007199254740993',
  availableActions: ['edit', 'disable'] as const,
  ...overrides,
})

const employee = (overrides: Record<string, unknown> = {}) => ({
  id: 'emp-1',
  code: 'EMP-0001',
  py: 'zhangsan',
  name: '张三',
  enabled: true,
  revision: '9007199254740993',
  availableActions: ['edit', 'disable'] as const,
  ...overrides,
})

function authorize(...paths: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf-token'
  session.apiPaths = paths
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
}

describe('AUX operating entity and employee management public view-model seam', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    queryOperatingEntities.mockResolvedValue(page([operatingEntity()]) as never)
    queryEmployees.mockResolvedValue(page([employee()]) as never)
    queryEmployeeCategories.mockResolvedValue(
      page([
        { id: 'category-1', code: 'ECT-0001', name: '员工分类', enabled: true },
      ]) as never,
    )
    queryDepartments.mockResolvedValue(
      page([
        { id: 'department-1', code: 'DEP-0001', name: '部门', enabled: true },
      ]) as never,
    )
    queryPositions.mockResolvedValue(
      page([
        { id: 'position-1', code: 'POS-0001', name: '岗位', enabled: true },
      ]) as never,
    )
  })

  it('creates an operating entity with its legal fields and lets the server derive its list name', async () => {
    authorize('/aux/operating-entity/create', '/aux/operating-entity/query')
    createOperatingEntity.mockResolvedValue({ id: 'ope-created' } as never)
    const vm = useOperatingEntityManagementViewModel()
    await vm.list.initialize()

    const creating = vm.list.create()
    Object.assign(vm.editor, {
      legalName: ' 北京示例有限公司 ',
      shortName: ' 示例 ',
      legalIdentifier: '91110000100000000X',
      registeredAddress: ' 北京 ',
      contactName: ' 李四 ',
      contactPhone: '13800000000',
      invoiceTitle: '北京示例有限公司',
      invoiceAddress: '北京',
      invoicePhone: '010-12345678',
      invoiceBank: '示例银行',
      invoiceAccount: '6222000000000000',
      remark: ' 备注 ',
    })
    await vm.saveEditor()
    await creating

    expect(createOperatingEntity).toHaveBeenCalledWith('csrf-token', {
      legalName: '北京示例有限公司',
      shortName: '示例',
      legalIdentifier: '91110000100000000X',
      registeredAddress: '北京',
      contactName: '李四',
      contactPhone: '13800000000',
      invoiceTitle: '北京示例有限公司',
      invoiceAddress: '北京',
      invoicePhone: '010-12345678',
      invoiceBank: '示例银行',
      invoiceAccount: '6222000000000000',
      remark: '备注',
    })
    expect(queryOperatingEntities).toHaveBeenCalledTimes(2)
  })

  it('does not request employee references without each exact read permission', async () => {
    authorize('/aux/employee/create')
    const vm = useEmployeeManagementViewModel()
    const opening = vm.list.create()
    await flushPromises()

    expect(queryOperatingEntities).not.toHaveBeenCalled()
    expect(queryEmployeeCategories).not.toHaveBeenCalled()
    expect(queryDepartments).not.toHaveBeenCalled()
    expect(queryPositions).not.toHaveBeenCalled()
    expect(vm.canSave.value).toBe(false)

    vm.closeEditor()
    await opening
  })

  it('creates an employee from stable reference IDs and never sends frozen display snapshots', async () => {
    authorize(
      '/aux/employee/create',
      '/aux/employee/query',
      '/aux/operating-entity/query',
      '/aux/employee-category/query',
      '/aux/department/query',
      '/aux/position/query',
    )
    createEmployee.mockResolvedValue({ id: 'emp-created' } as never)
    const vm = useEmployeeManagementViewModel()
    await vm.list.initialize()
    const creating = vm.list.create()
    await flushPromises()
    Object.assign(vm.editor, {
      identityKind: 'PERSON',
      legalName: ' 张三 ',
      displayName: ' 张三 ',
      legalIdentifier: '11010519491231002X',
      contactName: ' 张三 ',
      phone: '13800000000',
      address: '北京',
      employmentDate: '2026-09-07',
      workPhone: '010-12345678',
      workEmail: 'zhangsan@example.com',
      remark: '正式员工',
      operatingEntityId: 'ope-1',
      employeeCategoryId: 'category-1',
      departmentId: 'department-1',
      positionId: 'position-1',
    })
    await vm.saveEditor()
    await creating

    expect(createEmployee).toHaveBeenCalledWith('csrf-token', {
      identityKind: 'PERSON',
      legalName: '张三',
      displayName: '张三',
      legalIdentifier: '11010519491231002X',
      contactName: '张三',
      phone: '13800000000',
      address: '北京',
      employmentDate: '2026-09-07',
      workPhone: '010-12345678',
      workEmail: 'zhangsan@example.com',
      remark: '正式员工',
      operatingEntityId: 'ope-1',
      employeeCategoryId: 'category-1',
      departmentId: 'department-1',
      positionId: 'position-1',
    })
    expect(queryEmployees).toHaveBeenCalledTimes(2)
  })

  it('keeps a duplicate employee legal identifier failure in the temporary form for correction', async () => {
    authorize(
      '/aux/employee/create',
      '/aux/operating-entity/query',
      '/aux/employee-category/query',
      '/aux/department/query',
      '/aux/position/query',
    )
    createEmployee.mockRejectedValue(
      new targetApi.TargetApiError(
        'employee_duplicate_legal_identifier',
        'duplicate legal identifier',
        'request-1',
      ),
    )
    const vm = useEmployeeManagementViewModel()
    const creating = vm.openCreate()
    await flushPromises()
    Object.assign(vm.editor, {
      legalName: '张三',
      displayName: '张三',
      legalIdentifier: '11010519491231002X',
      employmentDate: '2026-09-07',
      operatingEntityId: 'ope-1',
      employeeCategoryId: 'category-1',
      departmentId: 'department-1',
      positionId: 'position-1',
    })

    await vm.saveEditor()

    expect(vm.editorOpen.value).toBe(true)
    expect(vm.editor.legalName).toBe('张三')
    expect(vm.editorError.value).toBe('法定证件号码已被其他员工使用。')
    vm.closeEditor()
    await creating
  })

  it('destroys temporary employee input when its page instance is disposed', async () => {
    authorize(
      '/aux/employee/create',
      '/aux/operating-entity/query',
      '/aux/employee-category/query',
      '/aux/department/query',
      '/aux/position/query',
    )
    const vm = useEmployeeManagementViewModel()
    const creating = vm.openCreate()
    await flushPromises()
    vm.editor.displayName = '仅当前页面保留'

    vm.dispose()
    await creating

    expect(vm.editorOpen.value).toBe(false)
    expect(vm.editor.displayName).toBe('')
  })
})
