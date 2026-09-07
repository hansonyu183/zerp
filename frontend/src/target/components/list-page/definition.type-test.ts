import type { EnabledListItem } from './vm.ts'
import type {
  ListColumns,
  ListFilters,
  ListPageDefinition,
} from './definition.ts'

// Compile-only examples checked by the repository's frontend typecheck.
export type ValidDefinition = ListPageDefinition<
  EnabledListItem,
  { keyword: string }
>
export type MissingPinyin = ListPageDefinition<
  // @ts-expect-error hidden py is still mandatory
  Omit<EnabledListItem, 'py'>,
  { keyword: string }
>
export type MissingEnabled = ListPageDefinition<
  // @ts-expect-error enabled is mandatory at registration
  Omit<EnabledListItem, 'enabled'>,
  { keyword: string }
>
export type MissingKeyword = ListPageDefinition<
  EnabledListItem,
  // @ts-expect-error keyword is mandatory at registration
  { status: string }
>
export const correctColumns: ListColumns<EnabledListItem> = [
  { key: 'code', type: 'text', caption: '编码' },
  { key: 'name', type: 'text', caption: '名称' },
  { key: 'enabled', type: 'boolean', caption: '状态' },
  { key: '$actions', type: 'actions', caption: '操作' },
]
export const wrongOrder: ListColumns<EnabledListItem> = [
  // @ts-expect-error name cannot replace first code column
  { key: 'name', type: 'text', caption: '名称' },
  { key: 'name', type: 'text', caption: '名称' },
  { key: 'enabled', type: 'boolean', caption: '状态' },
  { key: '$actions', type: 'actions', caption: '操作' },
]
export const wrongKeyword: ListFilters<{ keyword: string }> = [
  // @ts-expect-error keyword must stay text
  { key: 'keyword', type: 'integer', caption: '关键词' },
]
