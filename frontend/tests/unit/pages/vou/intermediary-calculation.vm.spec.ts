import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type {
  IntermediaryCalculationSource,
  IntermediaryScriptSnapshot,
} from '@/components/voucher'
import { runIntermediaryScript } from '@/pages/vou/intermediary-calculation/sandbox'
import {
  isMonthEnd,
  previousMonthEnd,
  useIntermediaryCalculationViewModel,
} from '@/pages/vou/intermediary-calculation/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    postContract: vi.fn(),
    uploadAttachment: vi.fn(),
    fetchAttachment: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

vi.mock('@/pages/vou/intermediary-calculation/sandbox', () => ({
  runIntermediaryScript: vi.fn(),
}))

const mockedPostContract = vi.mocked(apiClient.postContract)
const mockedRunScript = vi.mocked(runIntermediaryScript)

const source: IntermediaryCalculationSource = {
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  currency: 'CNY',
  lines: [],
  bills: [],
}

const script: IntermediaryScriptSnapshot = {
  scriptId: 'SCRIPT-1',
  revision: 3,
  name: '现行规则',
  source: 'globalThis.calculate = () => ({ lines: [], summaries: [] });',
  hash: 'SCRIPT-HASH',
}

function grantPermissions(): void {
  useSessionStore().permissions = [
    '/vou/intermediary-calculation/create',
    '/vou/intermediary-calculation/source',
    '/vou/intermediary-calculation/script-get',
    '/vou/intermediary-calculation/script-save',
  ]
}

describe('intermediary calculation view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('validates calendar month ends without local timezone drift', () => {
    expect(previousMonthEnd('2026-08-07')).toBe('2026-07-31')
    expect(previousMonthEnd('2026-01-10')).toBe('2025-12-31')
    expect(isMonthEnd('2026-02-28')).toBe(true)
    expect(isMonthEnd('2026-02-27')).toBe(false)
  })

  it('loads source and script, executes the sandbox, and stores the draft', async () => {
    grantPermissions()
    mockedPostContract
      .mockResolvedValueOnce({ data: { source, sourceHash: 'SOURCE-HASH' } })
      .mockResolvedValueOnce({ data: script })
    mockedRunScript.mockResolvedValueOnce({ lines: [], summaries: [] })
    const vm = useIntermediaryCalculationViewModel()
    vm.openCreate()
    vm.form.value.businessDate = '2026-07-31'

    await vm.calculate()

    expect(mockedPostContract).toHaveBeenNthCalledWith(
      1,
      'vou/intermediary-calculation/source',
      { businessDate: '2026-07-31' },
    )
    expect(mockedPostContract).toHaveBeenNthCalledWith(
      2,
      'vou/intermediary-calculation/script-get',
      {},
    )
    expect(mockedRunScript).toHaveBeenCalledWith(script.source, source)
    expect(vm.form.value.intermediaryCalculation).toEqual({
      source,
      sourceHash: 'SOURCE-HASH',
      script,
      result: { lines: [], summaries: [] },
    })
    expect(vm.successMessage.value).toContain('生成 0 行计算稿')
  })

  it('discards an obsolete calculation after the business month changes', async () => {
    grantPermissions()
    let resolveSource!: (value: { data: unknown }) => void
    let resolveScript!: (value: { data: unknown }) => void
    mockedPostContract
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSource = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveScript = resolve
          }),
      )
    mockedRunScript.mockResolvedValueOnce({ lines: [], summaries: [] })
    const vm = useIntermediaryCalculationViewModel()
    vm.openCreate()
    vm.form.value.businessDate = '2026-07-31'

    const pending = vm.calculate()
    vm.changeBusinessDate('2026-08-31')
    resolveSource({ data: { source, sourceHash: 'SOURCE-HASH' } })
    resolveScript({ data: script })
    await pending

    expect(mockedRunScript).toHaveBeenCalledWith(script.source, source)
    expect(vm.form.value.businessDate).toBe('2026-08-31')
    expect(vm.form.value.intermediaryCalculation).toBeNull()
    expect(vm.successMessage.value).toBeNull()
    expect(vm.calculating.value).toBe(false)
  })

  it('requires a successful test of the current text before saving a script', async () => {
    grantPermissions()
    mockedPostContract.mockResolvedValueOnce({ data: script })
    const vm = useIntermediaryCalculationViewModel()

    await vm.openScript()
    vm.scriptName.value = '新规则'
    vm.scriptSource.value = `${script.source}\n// revised`
    await vm.saveScript()
    expect(vm.scriptError.value).toContain('必须先试运行成功')

    mockedPostContract.mockResolvedValueOnce({ data: { source } })
    mockedRunScript.mockResolvedValueOnce({ lines: [], summaries: [] })
    vm.scriptTestDate.value = '2026-07-31'
    await vm.testScript()

    expect(vm.scriptMessage.value).toContain('试运行成功')
    mockedPostContract.mockResolvedValueOnce({
      data: { ...script, revision: 4, name: '新规则' },
    })
    await vm.saveScript()

    expect(mockedPostContract).toHaveBeenLastCalledWith(
      'vou/intermediary-calculation/script-save',
      {
        revision: 3,
        name: '新规则',
        source: `${script.source}\n// revised`,
      },
    )
    expect(vm.scriptSnapshot.value?.revision).toBe(4)
  })

  it('does not certify script text edited while a test run is pending', async () => {
    grantPermissions()
    mockedPostContract
      .mockResolvedValueOnce({ data: script })
      .mockResolvedValueOnce({ data: { source } })
    let resolveRun!: (value: { lines: []; summaries: [] }) => void
    mockedRunScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve
        }),
    )
    const vm = useIntermediaryCalculationViewModel()
    await vm.openScript()
    vm.scriptTestDate.value = '2026-07-31'
    const testedSource = `${script.source}\n// tested`
    vm.scriptSource.value = testedSource

    const pending = vm.testScript()
    await vi.waitFor(() => expect(mockedRunScript).toHaveBeenCalled())
    vm.scriptSource.value = `${testedSource}\n// edited while pending`
    resolveRun({ lines: [], summaries: [] })
    await pending

    expect(mockedRunScript).toHaveBeenCalledWith(testedSource, source)
    expect(vm.scriptError.value).toContain('已变化')
    await vm.saveScript()
    expect(vm.scriptError.value).toContain('必须先试运行成功')
    expect(mockedPostContract).toHaveBeenCalledTimes(2)
  })
})
