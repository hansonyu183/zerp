import type {
  EnabledListItem,
  ListAction,
  ListPageResult,
} from '../list-page/vm.ts'
import type { EnumOption } from '../dynamic-fields/types.ts'

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
export type EditReferenceSource =
  | 'roles'
  | 'permissions'
  | 'operating-entities'
  | 'employee-categories'
  | 'departments'
  | 'positions'
  | 'employees'
  | 'vehicle-types'
  | 'other-units'
export type EditValue = string | number | boolean | null | string[]
export type EditValues = Record<string, EditValue>
export type EditOption = {
  id: string
  name: string
  disabled?: boolean
  unavailable?: boolean
  approvalEntryId?: string
}
export type EditField = {
  key: string
  caption: string
  required?: boolean
  createOnly?: boolean
  visibleWhen?: { key: 'carrierKind'; value: 'INTERNAL' | 'EXTERNAL' }
} & (
  | { type: 'text' | 'textarea' | 'password' | 'date' }
  | { type: 'integer'; min?: number; max?: number }
  | { type: 'decimal'; scale: number; min?: string; max?: string }
  | { type: 'boolean' }
  | { type: 'enum'; options: readonly EnumOption[] }
  | {
      type: 'reference'
      source: Exclude<EditReferenceSource, 'roles' | 'permissions'>
    }
  | { type: 'multi-reference'; source: 'roles' | 'permissions' }
)
type WithKey<F, K extends string> = F extends EditField
  ? Omit<F, 'key'> & { key: K }
  : never
type FieldFor<Value> =
  NonNullable<Value> extends string[]
    ? Extract<EditField, { type: 'multi-reference' }>
    : NonNullable<Value> extends boolean
      ? Extract<EditField, { type: 'boolean' }>
      : NonNullable<Value> extends number
        ? Extract<EditField, { type: 'integer' }>
        : NonNullable<Value> extends string
          ? Exclude<
              EditField,
              { type: 'boolean' | 'integer' | 'multi-reference' }
            >
          : never
export type EditFields<T extends object> = readonly {
  [K in Extract<keyof T, string>]: WithKey<FieldFor<T[K]>, K> & { key: K }
}[Extract<keyof T, string>][]
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
