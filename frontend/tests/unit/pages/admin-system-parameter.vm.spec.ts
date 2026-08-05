import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSystemParameter,
  querySystemParameters,
  resetSystemParameter,
  saveSystemParameter,
} from '@/pages/admin/shared/api'
import { createSystemParameterViewModel } from '@/pages/admin/system-parameter/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/pages/admin/shared/api', () => ({
  querySystemParameters: vi.fn(),
  getSystemParameter: vi.fn(),
  saveSystemParameter: vi.fn(),
  resetSystemParameter: vi.fn(),
}))

const integerParameter = {
  key: 'invoice.rounding.scale',
  name: '金额小数位',
  description: '金额显示小数位',
  valueType: 'INTEGER' as const,
  value: '2',
  defaultValue: '2',
  editable: true,
  revision: 4,
  updatedAt: '2026-08-05T00:00:00Z',
  updatedBy: 'USER-1',
}
const menuMode = {
  key: 'app.menu.mode',
  name: '当前菜单方式',
  description: '菜单服务专用',
  valueType: 'STRING' as const,
  value: 'DEFAULT',
  defaultValue: 'DEFAULT',
  editable: false,
  revision: 1,
  updatedAt: '2026-08-05T00:00:00Z',
  updatedBy: 'USER-1',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('system parameter view model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    const session = useSessionStore()
    session.permissions = [
      '/app/system-parameter/query',
      '/app/system-parameter/get',
      '/app/system-parameter/save',
      '/app/system-parameter/reset',
    ]
    vi.mocked(querySystemParameters).mockResolvedValue({
      data: {
        items: [integerParameter, menuMode],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    })
    vi.mocked(getSystemParameter).mockResolvedValue({ data: integerParameter })
    vi.mocked(saveSystemParameter).mockResolvedValue({
      data: { ...integerParameter, value: '3', revision: 5 },
    })
    vi.mocked(resetSystemParameter).mockResolvedValue({
      data: { ...integerParameter, value: '2', revision: 5 },
    })
  })

  it('按类型和可编辑状态筛选已注册参数', async () => {
    const vm = createSystemParameterViewModel()
    vm.keyword.value = 'invoice'
    vm.valueType.value = 'INTEGER'
    vm.editable.value = true
    await vm.query()

    expect(querySystemParameters).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      filters: {
        search: 'invoice',
        valueType: 'INTEGER',
        editable: 'true',
      },
      sort: [{ field: 'key', order: 'asc' }],
    })
  })

  it('忽略乱序的旧参数查询响应和错误', async () => {
    const first = deferred<{
      data: {
        items: (typeof integerParameter)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    const second = deferred<{
      data: {
        items: (typeof integerParameter)[]
        total: number
        page: number
        pageSize: number
      }
    }>()
    vi.mocked(querySystemParameters)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const vm = createSystemParameterViewModel()

    vm.keyword.value = '旧查询'
    const olderQuery = vm.query()
    vm.keyword.value = '新查询'
    const newerQuery = vm.query()
    expect(vm.loading.value).toBe(true)

    second.resolve({
      data: {
        items: [{ ...integerParameter, key: 'new.parameter' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await newerQuery
    expect(vm.rows.value).toEqual([
      { ...integerParameter, key: 'new.parameter' },
    ])
    expect(vm.loading.value).toBe(false)

    first.reject(new Error('旧查询失败'))
    await olderQuery
    expect(vm.rows.value).toEqual([
      { ...integerParameter, key: 'new.parameter' },
    ])
    expect(vm.total.value).toBe(1)
    expect(vm.errorMessage.value).toBeNull()
    expect(vm.loading.value).toBe(false)
  })

  it('保存时在前端校验类型并携带当前 revision', async () => {
    const vm = createSystemParameterViewModel()
    await vm.openEdit(integerParameter)
    vm.inputValue.value = '1.5'
    expect(vm.validationError.value).toBe('请输入整数。')
    await vm.save()
    expect(saveSystemParameter).not.toHaveBeenCalled()

    vm.inputValue.value = '3'
    await vm.save()
    expect(saveSystemParameter).toHaveBeenCalledWith({
      key: 'invoice.rounding.scale',
      value: '3',
      revision: 4,
    })
  })

  it('编辑操作同时要求 get 和 save 权限', () => {
    const session = useSessionStore()
    session.permissions = [
      '/app/system-parameter/query',
      '/app/system-parameter/save',
    ]
    const vm = createSystemParameterViewModel()

    expect(vm.canSave.value).toBe(true)
    expect(vm.canEdit.value).toBe(false)
    session.permissions.push('/app/system-parameter/get')
    expect(vm.canEdit.value).toBe(true)
  })

  it('恢复默认值需要显式确认且菜单模式保持只读', async () => {
    const vm = createSystemParameterViewModel()
    vm.requestReset(integerParameter)
    await vm.confirmReset()
    expect(resetSystemParameter).toHaveBeenCalledWith({
      key: 'invoice.rounding.scale',
      revision: 4,
    })

    vi.mocked(resetSystemParameter).mockClear()
    vm.requestReset(menuMode)
    await vm.confirmReset()
    expect(resetSystemParameter).not.toHaveBeenCalled()
  })
})
