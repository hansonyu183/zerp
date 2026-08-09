import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type {
  IntermediaryCalculationSource,
  IntermediaryScriptSnapshot,
  VoucherDocumentView,
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
const mockedPost = vi.mocked(apiClient.post)
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
    '/vou/intermediary-calculation/get',
    '/vou/intermediary-calculation/save',
    '/vou/intermediary-calculation/source',
    '/vou/intermediary-calculation/script-get',
    '/vou/intermediary-calculation/script-save',
  ]
}

function calculationDocument(
  documentId: string,
  documentNo: string,
  businessDate: string,
): VoucherDocumentView {
  return {
    documentId,
    entity: 'intermediary-calculation',
    documentNo,
    status: 'DRAFT',
    revision: 1,
    amount: '0.00',
    data: { businessDate, currency: 'CNY' },
    attachments: [],
    createdAt: '2026-08-01T00:00:00Z',
    createdBy: 'USER-1',
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: 'USER-1',
  }
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

  it('requires source and script access before enabling creation', () => {
    const session = useSessionStore()
    session.permissions = ['/vou/intermediary-calculation/create']
    const vm = useIntermediaryCalculationViewModel()

    expect(vm.canCreate.value).toBe(false)
    vm.openCreate()
    expect(vm.editing.value).toBe(false)

    session.permissions = [
      '/vou/intermediary-calculation/create',
      '/vou/intermediary-calculation/source',
    ]
    expect(vm.canCreate.value).toBe(false)

    session.permissions.push('/vou/intermediary-calculation/script-get')
    expect(vm.canCreate.value).toBe(true)
    vm.openCreate()
    expect(vm.editing.value).toBe(true)
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

  it('discards a calculation from a closed workspace after reopening the same document', async () => {
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
    const storedCalculation = {
      source,
      sourceHash: 'STORED-SOURCE-HASH',
      script,
      result: { lines: [], summaries: [] },
    }
    const document: VoucherDocumentView = {
      documentId: 'CALCULATION-1',
      entity: 'intermediary-calculation',
      documentNo: 'ICL-20260731-0001',
      status: 'DRAFT',
      revision: 1,
      amount: '0.00',
      data: {
        businessDate: '2026-07-31',
        currency: 'CNY',
        intermediaryCalculation: storedCalculation,
      },
      attachments: [],
      createdAt: '2026-08-01T00:00:00Z',
      createdBy: 'USER-1',
      updatedAt: '2026-08-01T00:00:00Z',
      updatedBy: 'USER-1',
    }
    mockedPost.mockResolvedValueOnce({ data: document })
    const vm = useIntermediaryCalculationViewModel()
    vm.openCreate()
    vm.form.value.businessDate = '2026-07-31'

    const pending = vm.calculate()
    await vi.waitFor(() => expect(mockedPostContract).toHaveBeenCalledTimes(2))
    vm.closeWorkspace()
    await vm.openDocument({ documentId: document.documentId })
    resolveSource({ data: { source, sourceHash: 'OBSOLETE-SOURCE-HASH' } })
    resolveScript({ data: script })
    await pending

    expect(vm.form.value.intermediaryCalculation).toEqual(storedCalculation)
    expect(vm.editing.value).toBe(false)
    expect(vm.calculating.value).toBe(false)
    expect(vm.successMessage.value).toBeNull()
  })

  it('keeps obsolete document loads out of newer, created, and closed workspaces', async () => {
    grantPermissions()
    const first = calculationDocument('CALCULATION-1', 'ICL-1', '2026-07-31')
    const second = calculationDocument('CALCULATION-2', 'ICL-2', '2026-08-31')
    let resolveFirst!: (value: { data: VoucherDocumentView }) => void
    let resolveSecond!: (value: { data: VoucherDocumentView }) => void
    mockedPost
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve)),
      )
    const vm = useIntermediaryCalculationViewModel()

    const firstLoad = vm.openDocument({ documentId: first.documentId })
    const secondLoad = vm.openDocument({ documentId: second.documentId })
    resolveSecond({ data: second })
    await secondLoad
    resolveFirst({ data: first })
    await firstLoad

    expect(vm.documentView.value?.documentId).toBe(second.documentId)
    expect(vm.form.value.businessDate).toBe('2026-08-31')

    let resolveCreated!: (value: { data: VoucherDocumentView }) => void
    mockedPost.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCreated = resolve)),
    )
    const createdLoad = vm.openDocument({ documentId: first.documentId })
    vm.openCreate()
    resolveCreated({ data: first })
    await createdLoad
    expect(vm.documentView.value).toBeNull()
    expect(vm.editing.value).toBe(true)

    let resolveClosed!: (value: { data: VoucherDocumentView }) => void
    mockedPost.mockImplementationOnce(
      () => new Promise((resolve) => (resolveClosed = resolve)),
    )
    const closedLoad = vm.openDocument({ documentId: first.documentId })
    vm.closeWorkspace()
    resolveClosed({ data: first })
    await closedLoad
    expect(vm.workspaceOpen.value).toBe(false)
    expect(vm.documentView.value).toBeNull()
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

  it('ignores an obsolete script response after the dialog is reopened', async () => {
    grantPermissions()
    let resolveFirst!: (value: { data: IntermediaryScriptSnapshot }) => void
    let resolveSecond!: (value: { data: IntermediaryScriptSnapshot }) => void
    mockedPostContract
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )
    const vm = useIntermediaryCalculationViewModel()

    const first = vm.openScript()
    vm.scriptOpen.value = false
    const second = vm.openScript()
    const latestScript = { ...script, revision: 4, name: '最新规则' }
    resolveSecond({ data: latestScript })
    await second
    resolveFirst({ data: script })
    await first

    expect(vm.scriptSnapshot.value).toEqual(latestScript)
    expect(vm.scriptName.value).toBe('最新规则')
    expect(vm.scriptSource.value).toBe(latestScript.source)
    expect(vm.scriptLoading.value).toBe(false)
  })

  it('preserves the next edit made while the tested script is being saved', async () => {
    grantPermissions()
    mockedPostContract.mockResolvedValueOnce({ data: script })
    const vm = useIntermediaryCalculationViewModel()
    await vm.openScript()
    const submittedSource = `${script.source}\n// submitted`
    vm.scriptName.value = '已提交版本'
    vm.scriptSource.value = submittedSource
    vm.scriptTestDate.value = '2026-07-31'
    mockedPostContract.mockResolvedValueOnce({ data: { source } })
    mockedRunScript.mockResolvedValueOnce({ lines: [], summaries: [] })
    await vm.testScript()

    let resolveSave!: (value: { data: IntermediaryScriptSnapshot }) => void
    mockedPostContract.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    const pending = vm.saveScript()
    await vi.waitFor(() =>
      expect(mockedPostContract).toHaveBeenLastCalledWith(
        'vou/intermediary-calculation/script-save',
        { revision: 3, name: '已提交版本', source: submittedSource },
      ),
    )
    const nextSource = `${submittedSource}\n// next edit`
    vm.scriptName.value = '下一版本'
    vm.scriptSource.value = nextSource
    resolveSave({
      data: {
        ...script,
        revision: 4,
        name: '已提交版本',
        source: submittedSource,
      },
    })
    await pending

    expect(vm.scriptSnapshot.value?.revision).toBe(4)
    expect(vm.scriptName.value).toBe('下一版本')
    expect(vm.scriptSource.value).toBe(nextSource)
    const callsBeforeRetry = mockedPostContract.mock.calls.length
    await vm.saveScript()
    expect(vm.scriptError.value).toContain('必须先试运行成功')
    expect(mockedPostContract).toHaveBeenCalledTimes(callsBeforeRetry)
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
