import { describe, expect, it } from 'vitest'
import {
  executeParameters,
  formatResultValue,
  visibleColumns,
  initialParameters,
  reportActions,
  reportDefinitionActions,
  reportPageCount,
  vouDrilldown,
} from '@/pages/rpt/shared/vm'

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
})
