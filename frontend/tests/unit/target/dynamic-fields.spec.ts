import { describe, expect, it } from 'vitest'

import {
  compareDecimal,
  FieldContractError,
  formatDecimal,
  normalizeFilters,
  validateFields,
  validateRows,
  type ColumnField,
  type FilterField,
} from '@/target/components/dynamic-fields/index.ts'

interface Row {
  id: string
  name: string
  amount: string | null
  enabled: boolean
}

interface Filters {
  keyword: string
  amount: { from: string | null; to: string | null }
  enabled: boolean | null
  roleId: string | null
}

describe('finite field contract', () => {
  it('accepts only finite column and filter configurations', () => {
    const columns = [
      { key: 'name', type: 'text', caption: '名称', required: true },
      { key: 'amount', type: 'decimal', caption: '金额', scale: 2 },
      { key: 'enabled', type: 'boolean', caption: '状态' },
      { key: '$actions', type: 'actions', caption: '操作' },
    ] as const satisfies readonly ColumnField<Row>[]
    const filters = [
      { key: 'keyword', type: 'text', caption: '关键词' },
      {
        key: 'amount',
        type: 'decimal',
        caption: '金额',
        scale: 2,
        range: true,
      },
      { key: 'enabled', type: 'boolean', caption: '状态' },
      {
        key: 'roleId',
        type: 'reference',
        caption: '角色',
        source: 'app/role',
      },
    ] as const satisfies readonly FilterField<Filters>[]

    expect(validateFields(columns, { usage: 'column' })).toBe(columns)
    expect(validateFields(filters, { usage: 'filter' })).toBe(filters)

    expect(() =>
      validateFields(
        [
          { key: 'name', type: 'text', caption: '名称' },
          { key: 'name', type: 'text', caption: '重复' },
          { key: '$actions', type: 'actions', caption: '操作' },
        ],
        { usage: 'column' },
      ),
    ).toThrowError(FieldContractError)
    expect(() =>
      validateFields(
        [
          { key: '$actions', type: 'actions', caption: '操作' },
          { key: 'name', type: 'text', caption: '名称' },
        ],
        { usage: 'column' },
      ),
    ).toThrow('操作列必须位于最后')
    expect(() =>
      validateFields(
        [
          {
            key: 'roleId',
            type: 'reference',
            caption: '角色',
            source: 'https://example.com/roles',
          },
        ],
        { usage: 'filter' },
      ),
    ).toThrow('未登记的引用源')
    expect(() =>
      validateFields(
        [
          {
            key: 'keyword',
            type: 'text',
            caption: '关键词',
            render: () => 'unsafe',
          },
        ],
        { usage: 'filter' },
      ),
    ).toThrow('不允许配置 render')
    expect(() =>
      validateFields(
        [{ key: 'keyword', type: 'text', caption: '关键词', range: false }],
        { usage: 'filter' },
      ),
    ).toThrow('不支持 range')
  })

  it('formats and compares decimal strings without binary floating point', () => {
    expect(formatDecimal('9007199254740993.1', 2)).toBe('9007199254740993.10')
    expect(compareDecimal('9007199254740993.10', '9007199254740993.2')).toBe(-1)
    expect(formatDecimal('0', 2)).toBe('0.00')
    expect(formatDecimal('-0.0', 2)).toBe('0.00')
    expect(() => formatDecimal('1.234', 2)).toThrow('超过声明精度')
    expect(() => formatDecimal('01.20', 2)).toThrow(FieldContractError)
  })

  it('rejects invalid row wire values instead of hiding them', () => {
    const columns = [
      { key: 'name', type: 'text', caption: '名称', required: true },
      { key: 'amount', type: 'decimal', caption: '金额', scale: 2 },
      { key: 'enabled', type: 'boolean', caption: '状态', required: true },
      { key: '$actions', type: 'actions', caption: '操作' },
    ] as const satisfies readonly ColumnField<Row>[]

    const rows = [
      {
        id: 'row-1',
        name: '大额资料',
        amount: '9007199254740993.10',
        enabled: false,
      },
    ]
    expect(validateRows(columns, rows)).toBe(rows)
    expect(() =>
      validateRows(columns, [{ ...rows[0], amount: '1.234' }]),
    ).toThrow('超过声明精度')
    expect(() => validateRows(columns, [{ ...rows[0], name: '' }])).toThrow(
      '必需值缺失',
    )
    expect(() => validateRows(columns, [rows[0], { ...rows[0] }])).toThrow(
      '重复行身份',
    )

    const referenceColumns = [
      {
        key: 'role',
        type: 'reference',
        caption: '角色',
        source: 'app/role',
      },
      { key: '$actions', type: 'actions', caption: '操作' },
    ] as const
    expect(() =>
      validateRows(referenceColumns, [{ id: 'row-2', role: '只有名称' }]),
    ).toThrow('引用值非法')
    expect(() =>
      validateRows(referenceColumns, [
        { id: 'row-2', role: { id: 'role-1', name: '业务员' } },
      ]),
    ).not.toThrow()
  })

  it('normalizes a complete filter snapshot and compares ranges exactly', () => {
    const fields = [
      { key: 'keyword', type: 'text', caption: '关键词' },
      {
        key: 'amount',
        type: 'decimal',
        caption: '金额',
        scale: 2,
        range: true,
      },
      { key: 'enabled', type: 'boolean', caption: '状态' },
      {
        key: 'roleId',
        type: 'reference',
        caption: '角色',
        source: 'app/role',
      },
    ] as const satisfies readonly FilterField<Filters>[]
    const input: Filters = {
      keyword: '',
      amount: {
        from: '9007199254740993.10',
        to: '9007199254740993.20',
      },
      enabled: false,
      roleId: 'role-1',
    }

    const normalized = normalizeFilters(fields, input)

    expect(normalized).toEqual(input)
    expect(normalized).not.toBe(input)
    expect(normalized.amount).not.toBe(input.amount)
    expect(() =>
      normalizeFilters(fields, {
        ...input,
        amount: {
          from: '9007199254740993.20',
          to: '9007199254740993.10',
        },
      }),
    ).toThrow('范围起点不能大于终点')

    expect(
      normalizeFilters(fields, {
        keyword: null,
        amount: { from: '', to: '' },
        enabled: undefined,
        roleId: '',
      } as unknown as Filters),
    ).toEqual({
      keyword: '',
      amount: { from: null, to: null },
      enabled: null,
      roleId: null,
    })
    expect(() =>
      normalizeFilters(fields, { ...input, arbitrarySql: 'x' } as Filters),
    ).toThrow('未登记筛选键')
  })
})
