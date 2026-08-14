import { describe, expect, it } from 'vitest'
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
} from '@/pages/rpt/vm'

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
