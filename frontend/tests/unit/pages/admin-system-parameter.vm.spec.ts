import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSystemParameter,
  querySystemParameters,
  resetSystemParameter,
  saveSystemParameter,
} from '@/pages/app/shared/api'
import { createSystemParameterViewModel } from '@/pages/app/system-parameter/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/pages/app/shared/api', () => ({
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
  configuredValue: '2',
  defaultValue: '2',
  editable: true,
  constraints: {
    required: true,
    minLength: null,
    maxLength: null,
    minimum: '0',
    maximum: '6',
    allowedValues: [],
  },
  revision: 4,
}
const alternateParameter = {
  ...integerParameter,
  key: 'report.cache.ttl',
  name: '报表缓存时长',
  configuredValue: '120',
  defaultValue: '60',
  revision: 6,
}
const incompleteConstraintParameter = {
  ...integerParameter,
  key: 'legacy.parameter',
  constraints: null,
}
const readOnlyParameter = {
  ...integerParameter,
  key: 'runtime.read-only',
  editable: false,
}
const choiceParameter = {
  ...integerParameter,
  key: 'invoice.rounding.mode',
  valueType: 'STRING' as const,
  configuredValue: 'HALF_UP',
  defaultValue: 'HALF_UP',
  constraints: {
    required: true,
    minLength: null,
    maxLength: null,
    minimum: null,
    maximum: null,
    allowedValues: ['HALF_UP', 'HALF_EVEN'],
  },
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
        items: [integerParameter, alternateParameter, readOnlyParameter],
        total: 3,
        page: 1,
        pageSize: 20,
      },
    })
    vi.mocked(getSystemParameter).mockResolvedValue({ data: integerParameter })
    vi.mocked(saveSystemParameter).mockResolvedValue({
      data: { ...integerParameter, configuredValue: '3', revision: 5 },
    })
    vi.mocked(resetSystemParameter).mockResolvedValue({
      data: { ...integerParameter, configuredValue: '2', revision: 5 },
    })
  })

  it('按类型和可编辑状态以固定 20 条分页查询参数', async () => {
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
    second.resolve({
      data: {
        items: [{ ...integerParameter, key: 'new.parameter' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await newerQuery
    first.reject(new Error('旧查询失败'))
    await olderQuery

    expect(vm.rows.value).toEqual([
      { ...integerParameter, key: 'new.parameter' },
    ])
    expect(vm.errorMessage.value).toBeNull()
  })

  it('忽略乱序的旧参数编辑详情响应', async () => {
    const first = deferred<{ data: typeof integerParameter }>()
    const second = deferred<{ data: typeof alternateParameter }>()
    vi.mocked(getSystemParameter)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const vm = createSystemParameterViewModel()

    const firstLoad = vm.openEdit(integerParameter)
    const secondLoad = vm.openEdit(alternateParameter)
    second.resolve({ data: alternateParameter })
    await secondLoad
    first.resolve({ data: integerParameter })
    await firstLoad

    expect(vm.editing.value).toEqual(alternateParameter)
    expect(vm.inputValue.value).toBe('120')
    expect(vm.loading.value).toBe(false)
  })

  it('根据注册约束校验配置值并携带 fresh revision 保存', async () => {
    const vm = createSystemParameterViewModel()
    await vm.openEdit(integerParameter)
    vm.inputValue.value = '7'
    expect(vm.validationError.value).toBe('值不能大于 6。')
    await vm.save()
    expect(saveSystemParameter).not.toHaveBeenCalled()

    vm.inputValue.value = '3'
    await vm.save()
    expect(saveSystemParameter).toHaveBeenCalledWith({
      key: 'invoice.rounding.scale',
      configuredValue: '3',
      revision: 4,
    })
  })

  it('从注册候选约束派生编辑控件选项', async () => {
    vi.mocked(getSystemParameter).mockResolvedValue({ data: choiceParameter })
    const vm = createSystemParameterViewModel()

    await vm.openEdit(choiceParameter)

    expect(vm.inputOptions.value).toEqual([
      { title: 'HALF_UP', value: 'HALF_UP' },
      { title: 'HALF_EVEN', value: 'HALF_EVEN' },
    ])
  })

  it('不可编辑参数和约束缺失参数均保持只读', async () => {
    const vm = createSystemParameterViewModel()

    expect(vm.canEditParameter(readOnlyParameter)).toBe(false)
    expect(vm.canResetParameter(readOnlyParameter)).toBe(false)
    expect(vm.canEditParameter(incompleteConstraintParameter)).toBe(false)
    await vm.openEdit(readOnlyParameter)
    await vm.requestReset(incompleteConstraintParameter)

    expect(getSystemParameter).not.toHaveBeenCalled()
    expect(vm.editorOpen.value).toBe(false)
    expect(vm.resetTarget.value).toBeNull()
  })

  it('只有 get 权限时仍可读取完整只读详情', async () => {
    const session = useSessionStore()
    session.permissions = [
      '/app/system-parameter/query',
      '/app/system-parameter/get',
    ]
    const vm = createSystemParameterViewModel()

    await vm.openDetail(integerParameter)

    expect(getSystemParameter).toHaveBeenCalledWith(integerParameter.key)
    expect(vm.editorOpen.value).toBe(true)
    expect(vm.editing.value).toEqual(integerParameter)
    expect(vm.canEditParameter(integerParameter)).toBe(false)
  })

  it('恢复默认值先 fresh get，再以该 revision 二次确认提交', async () => {
    vi.mocked(getSystemParameter).mockResolvedValue({
      data: alternateParameter,
    })
    vi.mocked(resetSystemParameter).mockResolvedValue({
      data: { ...alternateParameter, configuredValue: '60', revision: 7 },
    })
    const vm = createSystemParameterViewModel()

    await vm.requestReset(integerParameter)
    expect(getSystemParameter).toHaveBeenCalledWith(integerParameter.key)
    expect(vm.resetTarget.value).toEqual(alternateParameter)

    await vm.confirmReset()
    expect(resetSystemParameter).toHaveBeenCalledWith({
      key: alternateParameter.key,
      revision: 6,
    })
    expect(vm.successMessage.value).toBe('系统参数已恢复默认值。')
  })

  it('关闭有修改的编辑器必须先确认放弃', async () => {
    const vm = createSystemParameterViewModel()
    await vm.openEdit(integerParameter)
    vm.inputValue.value = '3'

    vm.requestCloseEditor()
    expect(vm.discardConfirmationOpen.value).toBe(true)
    expect(vm.editorOpen.value).toBe(true)

    vm.cancelDiscard()
    expect(vm.editorOpen.value).toBe(true)
    vm.confirmDiscard()
    expect(vm.editorOpen.value).toBe(false)
    expect(vm.editing.value).toBeNull()
  })

  it('revision 冲突保留当前输入和编辑上下文', async () => {
    vi.mocked(saveSystemParameter).mockRejectedValue(new Error('数据已变化'))
    const vm = createSystemParameterViewModel()
    await vm.openEdit(integerParameter)
    vm.inputValue.value = '3'

    await vm.save()

    expect(vm.inputValue.value).toBe('3')
    expect(vm.editing.value?.revision).toBe(4)
    expect(vm.editorOpen.value).toBe(true)
  })
})
