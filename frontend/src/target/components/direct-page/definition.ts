import type {
  EnabledListItem,
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
  | 'app/user'
  | 'app/role'
  | 'aux/employee-category'
  | 'aux/position'
  | 'aux/measurement-unit'
  | 'aux/payment-method'
  | 'aux/asset-category'
  | 'aux/operating-entity'
  | 'aux/employee'
  | 'aux/warehouse'
  | 'aux/fund-account'
  | 'aux/vehicle'
export type DirectRow = EnabledListItem & {
  revision: string
  availableActions: readonly string[]
  symbol?: string
  quantityScale?: number
  type?: string
}
export type DirectQuery = {
  keyword: string
  quantityScale?: number | null
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
  empty: () => T
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
  setEnabled: (
    token: string,
    input: { id: string; revision: string },
    enabled: boolean,
  ) => Promise<unknown>
  delete?: (
    token: string,
    input: { id: string; revision: string },
  ) => Promise<unknown>
}
export type DirectDefinition = {
  kind: 'direct'
  resource: DirectResource
  fields: readonly EditField[]
  adapter: DirectAdapter<EditValues>
}
export function defineDirectPage<T extends object>(definition: {
  resource: DirectResource
  fields: EditFields<T>
  adapter: DirectAdapter<T>
}): DirectDefinition {
  // Registry erases each closed editor type only after checking its fields and adapter together.
  return { kind: 'direct', ...definition } as unknown as DirectDefinition
}
export function hasAction(row: DirectRow, action: ListAction): boolean {
  return row.availableActions.some((value) => value.toLowerCase() === action)
}
