import { defineComponent, h, type ComponentPublicInstance } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import {
  executeParameters,
  formatResultValue,
  visibleColumns,
  initialParameters,
  reportActions,
  reportDefinitionActions,
  reportPageCount,
  reportParameterMinimum,
  validateReportParameterValues,
  vouDrilldown,
} from '@/pages/rpt/shared/vm'
import {
  parseDefinitionPage,
  parseQueryResult,
  parseReferenceItems,
  parseReportMetadata,
  useReportViewModel,
} from '@/pages/rpt/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: {
    exportReportCsv: vi.fn(),
    postContract: vi.fn(),
    setCsrfToken: vi.fn(),
  },
}))

const mockedPostContract = vi.mocked(apiClient.postContract)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const resultColumns = [
  {
    alias: 'amount',
    name: '金额',
    order: 1,
    type: 'DECIMAL' as const,
    width: 120,
    visible: true,
  },
]

async function mountReportViewModel(): Promise<{
  vm: ReturnType<typeof useReportViewModel>
  wrapper: VueWrapper<ComponentPublicInstance>
}> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/rpt/customer-aging',
        component: { template: '<div />' },
        meta: { reportCode: 'customer-aging' },
      },
    ],
  })
  await router.push('/rpt/customer-aging')
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  useSessionStore().permissions = ['/rpt/customer-aging/query']
  let vm: ReturnType<typeof useReportViewModel> | undefined
  const Harness = defineComponent({
    setup() {
      vm = useReportViewModel('report')
      return () => h('div')
    },
  })
  const wrapper = mount(Harness, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { vm: vm!, wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RPT report center view model', () => {
  it('initializes every supported parameter from its contract default', () => {
    expect(
      initialParameters([
        {
          key: 'bookId',
          name: '账簿',
          type: 'REFERENCE',
          required: true,
          defaultValue: 'book-1',
        },
        { key: 'asOf', name: '截止日', type: 'DATE_RANGE', required: false },
        {
          key: 'includeZero',
          name: '含零',
          type: 'BOOLEAN',
          required: false,
          defaultValue: true,
        },
      ]),
    ).toEqual({ bookId: 'book-1', asOf: ['', ''], includeZero: true })
  })

  it('submits DATE_RANGE as a two-item array and INTEGER as a JSON number', () => {
    expect(
      executeParameters(
        [
          { key: 'period', name: '期间', type: 'DATE_RANGE', required: true },
          { key: 'limit', name: '数量', type: 'INTEGER', required: false },
          { key: 'amount', name: '金额', type: 'DECIMAL', required: false },
        ],
        { period: ['2026-01-01', '2026-01-31'], limit: '12', amount: '10.25' },
      ),
    ).toEqual({
      period: ['2026-01-01', '2026-01-31'],
      limit: 12,
      amount: '10.25',
    })
  })

  it('enforces non-negative age filters for both aging reports', () => {
    const parameter = {
      key: 'minAgeDays',
      name: '最小账龄天数',
      type: 'INTEGER' as const,
      required: false,
    }
    for (const code of ['customer-aging', 'supplier-aging']) {
      expect(reportParameterMinimum(code, parameter)).toBe(0)
      expect(
        validateReportParameterValues(code, [parameter], { minAgeDays: -1 }),
      ).toBe('最小账龄天数不能小于 0。')
      expect(
        validateReportParameterValues(code, [parameter], { minAgeDays: 0 }),
      ).toBeNull()
    }
  })

  it('clears stale reference options and exposes a parameter error when reload fails', async () => {
    const referenceParameter = {
      key: 'bookId',
      name: '账簿',
      type: 'REFERENCE' as const,
      required: true,
      referenceType: 'ACCOUNTING_BOOK' as const,
    }
    mockedPostContract.mockImplementation(async (path) => {
      if (path === 'rpt/directory/query') {
        return {
          data: {
            items: [
              {
                code: 'customer-aging',
                name: '客户账龄',
                description: '测试',
                parameters: [referenceParameter],
                columns: resultColumns,
              },
            ],
          },
        } as never
      }
      if (path === 'rpt/customer-aging/reference-query') {
        return {
          data: {
            items: [{ id: 'book-1', code: 'ACC0001', name: '默认账簿' }],
          },
        } as never
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountReportViewModel()
    expect(vm.referenceOptions.value.bookId).toEqual([
      { value: 'book-1', title: 'ACC0001 · 默认账簿' },
    ])

    vm.parameters.value.bookId = 'book-1'
    mockedPostContract.mockRejectedValueOnce(
      new ApiError('network', 'request failed'),
    )
    await vm.loadReference(referenceParameter, 'retry')

    expect(vm.referenceOptions.value.bookId).toEqual([
      { value: 'book-1', title: 'ACC0001 · 默认账簿' },
    ])
    expect(vm.referenceErrors.value.bookId).toBe(
      '引用数据加载失败：网络连接失败，请检查网络后重试。',
    )
    expect(vm.errorMessage.value).toBe('')
    wrapper.unmount()
  })

  it('ignores stale reference responses and errors', async () => {
    const referenceParameter = {
      key: 'bookId',
      name: '账簿',
      type: 'REFERENCE' as const,
      required: true,
      referenceType: 'ACCOUNTING_BOOK' as const,
    }
    const staleError = deferred<never>()
    const currentResult = deferred<{
      data: { items: Array<{ id: string; code: string; name: string }> }
    }>()
    const staleResult = deferred<{
      data: { items: Array<{ id: string; code: string; name: string }> }
    }>()
    const currentError = deferred<never>()
    let referenceRequest = 0
    mockedPostContract.mockImplementation(async (path) => {
      if (path === 'rpt/directory/query') {
        return {
          data: {
            items: [
              {
                code: 'customer-aging',
                name: '客户账龄',
                description: '测试',
                parameters: [referenceParameter],
                columns: resultColumns,
              },
            ],
          },
        } as never
      }
      if (path === 'rpt/customer-aging/reference-query') {
        referenceRequest += 1
        if (referenceRequest === 1) {
          return {
            data: {
              items: [{ id: 'book-1', code: 'ACC0001', name: '默认账簿' }],
            },
          } as never
        }
        if (referenceRequest === 2) return staleError.promise as never
        if (referenceRequest === 3) return currentResult.promise as never
        if (referenceRequest === 4) return staleResult.promise as never
        return currentError.promise as never
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountReportViewModel()
    vm.parameters.value.bookId = 'book-1'

    const staleFailure = vm.loadReference(referenceParameter, 'old')
    const currentSuccess = vm.loadReference(referenceParameter, 'new')
    currentResult.resolve({
      data: {
        items: [{ id: 'book-2', code: 'ACC0002', name: '新账簿' }],
      },
    })
    await currentSuccess
    staleError.reject(new ApiError('network', 'stale request failed'))
    await staleFailure

    expect(vm.referenceOptions.value.bookId).toEqual([
      { value: 'book-1', title: 'ACC0001 · 默认账簿' },
      { value: 'book-2', title: 'ACC0002 · 新账簿' },
    ])
    expect(vm.referenceErrors.value.bookId).toBe('')

    const staleSuccess = vm.loadReference(referenceParameter, 'older')
    const currentFailure = vm.loadReference(referenceParameter, 'latest')
    currentError.reject(new ApiError('network', 'current request failed'))
    await currentFailure
    staleResult.resolve({
      data: {
        items: [{ id: 'book-3', code: 'ACC0003', name: '旧账簿' }],
      },
    })
    await staleSuccess

    expect(vm.referenceOptions.value.bookId).toEqual([
      { value: 'book-1', title: 'ACC0001 · 默认账簿' },
    ])
    expect(vm.referenceErrors.value.bookId).toBe(
      '引用数据加载失败：网络连接失败，请检查网络后重试。',
    )
    wrapper.unmount()
  })

  it('uses result contract visibility and keeps query/export permissions independent', () => {
    expect(
      visibleColumns([
        {
          alias: 'hidden',
          name: '隐藏',
          order: 2,
          type: 'TEXT',
          width: 80,
          visible: false,
        },
        {
          alias: 'shown',
          name: '显示',
          order: 1,
          type: 'DECIMAL',
          width: 120,
          visible: true,
        },
      ]).map((column) => column.alias),
    ).toEqual(['shown'])
    expect(reportActions({ query: false, export: true })).toEqual({
      canQuery: false,
      canExport: true,
      showResults: false,
    })
  })

  it('exposes every definition action independently and calculates result pages', () => {
    expect(reportDefinitionActions).toEqual([
      'create',
      'create-version',
      'save',
      'approve',
      'unapprove',
      'enable',
      'disable',
      'delete',
    ])
    expect(reportPageCount(101, 50)).toBe(3)
    expect(reportPageCount(0, 50)).toBe(1)
  })

  it('formats values from the approved result contract', () => {
    expect(
      formatResultValue('2026-08-12T00:00:00Z', {
        alias: 'day',
        name: '日期',
        order: 1,
        type: 'DATE',
        width: 100,
        visible: true,
      }),
    ).toBe('2026-08-12')
    expect(
      formatResultValue('1234.5', {
        alias: 'amount',
        name: '金额',
        order: 1,
        type: 'DECIMAL',
        width: 100,
        visible: true,
        format: 'money',
      }),
    ).toBe('1,234.50')
    expect(
      formatResultValue(false, {
        alias: 'enabled',
        name: '启用',
        order: 1,
        type: 'BOOLEAN',
        width: 100,
        visible: true,
      }),
    ).toBe('否')
  })

  it('only builds controlled VOU drilldowns when get permission exists', () => {
    const column = {
      alias: 'source_document_id',
      name: '来源',
      order: 1,
      type: 'ID' as const,
      width: 100,
      visible: true,
      drilldownEntity: 'VOU' as const,
    }
    const row = {
      source_entity: 'sale-delivery',
      source_document_id: '01J00000000000000000000001',
    }
    expect(
      vouDrilldown(row, column, (path) => path === '/vou/sale-delivery/get'),
    ).toEqual({
      path: '/vou/sale-delivery',
      query: { documentId: row.source_document_id },
    })
    expect(vouDrilldown(row, column, () => false)).toBeNull()
    expect(
      vouDrilldown({ ...row, source_entity: '../admin' }, column, () => true),
    ).toBeNull()
  })

  it('accepts the single definition and metadata contract shapes', () => {
    expect(
      parseDefinitionPage({
        items: [
          {
            code: 'account-journal',
            name: '科目流水',
            description: '说明',
            enabled: true,
            revision: 1,
            versionId: '01K00000000000000000000000',
            versionRevision: 1,
            data: { sql: 'SELECT 1', parameters: [], columns: resultColumns },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 200,
      })[0]?.data?.sql,
    ).toBe('SELECT 1')
    expect(
      parseReportMetadata({
        code: 'account-journal',
        name: '科目流水',
        description: '说明',
        parameters: [],
        columns: resultColumns,
      }).data,
    ).toBeUndefined()
  })

  it('rejects guessed legacy response shapes', () => {
    expect(() => parseDefinitionPage({ records: [] })).toThrow(
      '报表接口返回格式错误',
    )
    expect(() => parseQueryResult({ rows: [] })).toThrow('报表接口返回格式错误')
    expect(() => parseReferenceItems({ items: [{ value: 'id' }] })).toThrow(
      '报表接口返回格式错误',
    )
  })
})
