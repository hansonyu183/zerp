import { describe, expect, it } from 'vitest'
import { defineListPage } from '@/target/components/list-page/definition.ts'
import type { EnabledListItem } from '@/target/components/list-page/vm.ts'

describe('registered ListPage contract', () => {
  const page = () =>
    defineListPage<EnabledListItem, { keyword: string }>({
      title: '资料',
      createLabel: '新增',
      columns: [
        { key: 'code', type: 'text', caption: '编码' },
        { key: 'name', type: 'text', caption: '名称' },
        { key: 'enabled', type: 'boolean', caption: '状态' },
        { key: '$actions', type: 'actions', caption: '操作' },
      ],
      filters: [{ key: 'keyword', type: 'text', caption: '关键词' }],
    })
  it('requires complete identity even when py is not displayed', () => {
    const definition = page()
    const row = { id: 'a', code: 'A', name: '名称', enabled: false }
    expect(() => definition.validateRows([row as EnabledListItem])).toThrow()
    expect(() => definition.validateRows([{ ...row, py: '' }])).not.toThrow()
    expect(() =>
      definition.validateRows([
        { ...row, py: '' },
        { ...row, py: '' },
      ]),
    ).toThrow()
  })
  it('rejects reordered required columns and nonterminal or duplicate actions', () => {
    const good = page()
    for (const columns of [
      [good.columns[1], good.columns[0], ...good.columns.slice(2)],
      [...good.columns, good.columns[0]],
      [...good.columns, good.columns[3]],
    ])
      expect(() => defineListPage({ ...good, columns } as never)).toThrow()
  })
  it('rejects an invalid keyword type and duplicate filters', () => {
    const good = page()
    expect(() =>
      defineListPage({
        ...good,
        filters: [{ key: 'keyword', type: 'boolean', caption: '错' }],
      } as never),
    ).toThrow()
    expect(() =>
      defineListPage({
        ...good,
        filters: [...good.filters, ...good.filters],
      } as never),
    ).toThrow()
  })
})
