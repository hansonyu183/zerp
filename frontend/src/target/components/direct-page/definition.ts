import type {
  ListIdentity,
  ListAction,
  ListPageResult,
} from '../list-page/vm.ts'
import type {
  EditField,
  EditFields,
  EditValues,
  EditOption,
} from '../dynamic-fields/edit-fields.ts'

export type DirectResource =
  | 'acc/book'
  | 'acc/subject'
  | 'aux/department'
  | 'aux/product-category'
  | 'aux/dictionary-type'
  | 'aux/dictionary-item'
  | 'aux/income-expense-type'
  | 'app/user'
  | 'app/role'
  | 'aux/employee-category'
  | 'aux/position'
  | 'aux/measurement-unit'
  | 'aux/payment-method'
  | 'aux/asset-category'
  | 'aux/tax-information'
  | 'aux/operating-entity'
  | 'aux/employee'
  | 'aux/warehouse'
  | 'aux/fund-account'
  | 'aux/vehicle'
export type DirectRow = ListIdentity & {
  enabled?: boolean
  py?: string
  bookId?: string
  controlBook?: boolean
  startMonth?: string
  baseCurrency?: string
  revision: string
  availableActions: readonly string[]
  fixedFactor?: string | null
  parentId?: string | null
  parentName?: string | null
  dictionaryTypeId?: string
  dictionaryTypeName?: string
  sortOrder?: number
  direction?: string
  type?: string
}
export type DirectFilters = {
  keyword: string
  dictionaryTypeId?: string | null
  bookId?: string | null
}
export type DirectQuery = DirectFilters & {
  keyword: string
  page: number
  pageSize: 20
}
export type EditDetail<T> = {
  identity: DirectRow
  values: T
  options?: Record<string, readonly EditOption[]>
  readonlyFields?: readonly string[]
}
export type DirectAdapter<T> = {
  empty: (scope?: { bookId?: string | null }) => T
  query: (
    token: string,
    input: DirectQuery,
  ) => Promise<ListPageResult<DirectRow>>
  get: (token: string, id: string) => Promise<EditDetail<T>>
  create: (
    token: string,
    input: T,
    options: Record<string, readonly EditOption[]>,
  ) => Promise<unknown>
  save: (
    token: string,
    input: T,
    identity: DirectRow,
    options: Record<string, readonly EditOption[]>,
  ) => Promise<unknown>
  setEnabled?: (
    token: string,
    input: { id: string; revision: string },
    enabled: boolean,
  ) => Promise<unknown>
  delete?: (
    token: string,
    input: { id: string; revision: string },
  ) => Promise<unknown>
}
type DirectCapabilities =
  | {
      resource: Exclude<DirectResource, 'acc/book' | 'acc/subject'>
      enablement?: 'actions'
    }
  | { resource: 'acc/book'; enablement: 'none' }
  | { resource: 'acc/subject'; enablement: 'save' }
export type DirectDefinition = DirectCapabilities & {
  kind: 'direct'
  fields: readonly EditField[]
  adapter: DirectAdapter<EditValues>
}
export function defineDirectPage<T extends object>(
  definition: DirectCapabilities & {
    fields: EditFields<T>
    adapter: DirectAdapter<T>
  },
): DirectDefinition {
  // Registry erases each closed editor type only after checking its fields and adapter together.
  return { kind: 'direct', ...definition } as unknown as DirectDefinition
}
export function hasAction(row: DirectRow, action: ListAction): boolean {
  return row.availableActions.some((value) => value.toLowerCase() === action)
}
