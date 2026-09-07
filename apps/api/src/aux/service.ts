import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import type {
  AuxCurrentEntity,
  AuxCurrentSnapshot,
  EmployeeCurrentData,
  EmployeeCurrentInput,
  FundAccountCurrentData,
  FundAccountCurrentInput,
  OperatingEntityCurrentData,
  OperatingEntityCurrentInput,
  VehicleCarrierCurrentData,
  VehicleCurrentData,
  VehicleCurrentInput,
  WarehouseCurrentData,
  WarehouseCurrentInput,
} from '@zerp/model'
import { auxCurrentEntities } from '@zerp/model'

import type { DB } from '../db/generated.ts'
import { changeEnablement } from '../enablement/service.ts'
import { searchPinyin } from '../platform/pinyin.ts'

const auxiliaryWriteLockKey = '25408967740052824'

export const auxEntities = [
  'product-category',
  'product-type',
  'employee-category',
  'department',
  'position',
  'settlement-method',
  'payment-method',
  'dictionary-type',
  'dictionary-item',
  'measurement-unit',
  'income-expense-type',
  'asset-category',
  'operating-entity',
  'employee',
  'warehouse',
  'fund-account',
  'vehicle',
] as const

export type AuxEntity = (typeof auxEntities)[number]
export type AuxActor = { id: string; permissions: readonly string[] }
type AuxData = Record<string, unknown>

export interface AuxDataByEntity {
  'product-category': {
    name: string
    parentId: string
    description: string
  }
  'product-type': {
    name: string
    behaviorProfile:
      'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING'
    description: string
  }
  'employee-category': { name: string; description: string }
  department: { name: string; parentId: string; description: string }
  position: { name: string; description: string }
  'settlement-method': {
    name: string
    termCode:
      | 'PREPAID'
      | 'CASH_ON_DELIVERY'
      | 'ARRIVAL_3'
      | 'ARRIVAL_5'
      | 'ARRIVAL_7'
      | 'ARRIVAL_15'
      | 'ARRIVAL_30'
      | 'MONTHLY_CURRENT'
      | 'MONTHLY_30'
      | 'MONTHLY_60'
      | 'MONTHLY_90'
    ruleType: 'RELATIVE_DAYS' | 'MONTH_END'
    monthOffset: number
    dayOfMonth: number
    dayOffset: number
    defaultSalesSurcharge: string
    description: string
  }
  'payment-method': {
    name: string
    defaultSalesSurcharge: string
    description: string
  }
  'dictionary-type': { name: string; description: string }
  'dictionary-item': {
    name: string
    dictionaryTypeId: string
    sortOrder: number
    dictionaryTypeCode: string
    dictionaryTypeName: string
  }
  'measurement-unit': {
    name: string
    symbol: string
    quantityScale: number
  }
  'income-expense-type': {
    name: string
    direction: 'INCOME' | 'EXPENSE'
    parentId: string
    description: string
  }
  'asset-category': {
    name: string
    defaultUsefulLifeMonths: number
    defaultResidualRate: string
    description: string
  }
  'operating-entity': OperatingEntityCurrentData
  employee: EmployeeCurrentData
  warehouse: WarehouseCurrentData
  'fund-account': FundAccountCurrentData
  vehicle: VehicleCurrentData
}

export interface AuxWriteDataByEntity {
  'product-category': {
    name: string
    parentId?: string
    description?: string
  }
  'product-type': {
    name: string
    behaviorProfile: AuxDataByEntity['product-type']['behaviorProfile']
    description?: string
  }
  'employee-category': { name: string; description?: string }
  department: { name: string; parentId?: string; description?: string }
  position: { name: string; description?: string }
  'settlement-method': Omit<
    AuxDataByEntity['settlement-method'],
    'description'
  > & { description?: string }
  'payment-method': {
    name: string
    defaultSalesSurcharge?: string
    description?: string
  }
  'dictionary-type': { name: string; description?: string }
  'dictionary-item': Omit<
    AuxDataByEntity['dictionary-item'],
    'dictionaryTypeCode' | 'dictionaryTypeName'
  >
  'measurement-unit': AuxDataByEntity['measurement-unit']
  'income-expense-type': Omit<
    AuxDataByEntity['income-expense-type'],
    'parentId' | 'description'
  > & { parentId?: string; description?: string }
  'asset-category': Omit<AuxDataByEntity['asset-category'], 'description'> & {
    description?: string
  }
  'operating-entity': OperatingEntityCurrentInput
  employee: EmployeeCurrentInput
  warehouse: WarehouseCurrentInput
  'fund-account': FundAccountCurrentInput
  vehicle: VehicleCurrentInput
}

export type AuxWriteData<Entity extends AuxEntity> =
  AuxWriteDataByEntity[Entity]

export type AuxAvailableAction = 'edit' | 'enable' | 'disable' | 'delete'

export interface AuxListItem {
  id: string
  code: string
  py: string
  name: string
  enabled: boolean
  revision: string
  availableActions: AuxAvailableAction[]
}

export type AuxObjectView<Entity extends AuxEntity = AuxEntity> = AuxListItem &
  AuxDataByEntity[Entity] & {
    updatedAt: string
    updatedBy: string
  }

export interface AuxMutationResult {
  id: string
  revision: string
  enabled: boolean
}

/** One legacy current fact imported by the migration inside its transaction. */
export interface AuxCurrentImportRow {
  entity: AuxCurrentEntity
  id: string
  code: string
  data:
    | OperatingEntityCurrentInput
    | EmployeeCurrentData
    | WarehouseCurrentData
    | FundAccountCurrentData
    | VehicleCurrentData
  enabled: boolean
  createdAt: Date | string
  createdBy: string
  updatedAt: Date | string
  updatedBy: string
}

export interface AuxIdentifierInput {
  id: string
}

export interface AuxRevisionInput extends AuxIdentifierInput {
  revision: string
}

export type AuxSaveInput<Entity extends AuxEntity> = AuxRevisionInput &
  AuxWriteData<Entity>

export interface AuxQueryInput {
  keyword?: string
  quantityScale?: number
  page: number
  pageSize: 20
}

interface ParsedAuxRow<Entity extends AuxEntity = AuxEntity> {
  id: string
  entity: Entity
  code: string
  enabled: boolean
  revision: string
  data: AuxDataByEntity[Entity]
  updatedAt: string
  updatedBy: string
}

export interface AuxCurrentReference<Entity extends AuxCurrentEntity> {
  objectId: string
  code: string
  name: string
  data: AuxDataByEntity[Entity]
}

export interface AuxReferenceQueryInput {
  entity:
    | 'settlement-method'
    | 'payment-method'
    | 'dictionary-item'
    | 'product-type'
    | 'product-category'
    | 'employee-category'
    | 'department'
    | 'position'
    | 'measurement-unit'
  keyword?: string
  dictionaryTypeCode?: string
}

export interface AuxReferenceCandidate {
  objectId: string
  code: string
  name: string
  behaviorProfile?:
    'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING'
  quantityScale?: number
  symbol?: string
  termCode?:
    | 'PREPAID'
    | 'CASH_ON_DELIVERY'
    | 'ARRIVAL_3'
    | 'ARRIVAL_5'
    | 'ARRIVAL_7'
    | 'ARRIVAL_15'
    | 'ARRIVAL_30'
    | 'MONTHLY_CURRENT'
    | 'MONTHLY_30'
    | 'MONTHLY_60'
    | 'MONTHLY_90'
  ruleType?: 'RELATIVE_DAYS' | 'MONTH_END'
  monthOffset?: number
  dayOfMonth?: number
  dayOffset?: number
  defaultSalesSurcharge?: string
}

export class AuxApplicationError extends Error {
  readonly errorKey:
    | 'validation_failed'
    | 'conflict'
    | 'forbidden'
    | 'internal_error'
    | 'operating_entity_duplicate_legal_identifier'
    | 'employee_duplicate_legal_identifier'
    | 'fund_account_duplicate_account_number'
    | 'vehicle_duplicate_plate_number'
    | 'vehicle_duplicate_vin'
    | 'warehouse_disable_blocked'
  readonly data: unknown

  constructor(errorKey: AuxApplicationError['errorKey'], data: unknown = null) {
    super(errorKey)
    this.name = 'AuxApplicationError'
    this.errorKey = errorKey
    this.data = data
  }
}

interface StoredAuxObject {
  id: string
  entity: string
  code: string
  enabled: boolean
  revision: string | number | bigint
  data: unknown
  updated_at: Date | string
  updated_by: string
}

const codePrefixes: Record<AuxEntity, string> = {
  'product-category': 'PCT',
  'product-type': 'PTP',
  'employee-category': 'ECT',
  department: 'DEP',
  position: 'POS',
  'settlement-method': 'STM',
  'payment-method': 'PMT',
  'dictionary-type': 'DCT',
  'dictionary-item': 'DIT',
  'measurement-unit': 'UNT',
  'income-expense-type': 'IET',
  'asset-category': 'ACT',
  'operating-entity': 'OPE',
  employee: 'EMP',
  warehouse: 'WHS',
  'fund-account': 'FAC',
  vehicle: 'VEH',
}

function applicationError(
  errorKey: AuxApplicationError['errorKey'],
  data: unknown = null,
): never {
  throw new AuxApplicationError(errorKey, data)
}

function isEntity(value: string): value is AuxEntity {
  return (auxEntities as readonly string[]).includes(value)
}

function assertEntity(value: string): asserts value is AuxEntity {
  if (!isEntity(value)) applicationError('validation_failed')
}

function assertPermission(actor: AuxActor, permission: string): void {
  if (!actor.permissions.includes(permission)) applicationError('forbidden')
}

function revision(value: string | number | bigint): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1)
      applicationError('validation_failed')
    return BigInt(value)
  }
  if (!/^\d+$/.test(String(value)) || BigInt(value) < 1n)
    applicationError('validation_failed')
  return BigInt(value)
}

function revisionString(value: string | number | bigint): string {
  return String(revision(value))
}

function dateTime(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function asRecord(value: unknown): AuxData {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      applicationError('internal_error')
    }
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object')
    applicationError('internal_error')
  return { ...value } as AuxData
}

function inputRecord(value: unknown): AuxData {
  if (value === null || Array.isArray(value) || typeof value !== 'object')
    applicationError('validation_failed')
  return { ...value } as AuxData
}

function strictInput(value: unknown, keys: readonly string[]): AuxData {
  const input = inputRecord(value)
  only(input, keys)
  return input
}

function inputId(value: unknown): string {
  return optionalId(value) ?? applicationError('validation_failed')
}

function inputRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))
    applicationError('validation_failed')
  return value
}

function writeData(entity: AuxEntity, value: unknown): AuxData {
  const data = inputRecord(value)
  if (entity === 'payment-method' && data.defaultSalesSurcharge === undefined)
    return { ...data, defaultSalesSurcharge: '0.00' }
  return data
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') applicationError('validation_failed')
  const normalized = value.trim()
  if (normalized.length === 0 || [...normalized].length > 200)
    applicationError('validation_failed')
  return normalized
}

function requiredText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') applicationError('validation_failed')
  const normalized = value.trim()
  if (normalized.length === 0 || [...normalized].length > maxLength)
    applicationError('validation_failed')
  return normalized
}

function optionalString(value: unknown, maxLength = 1000): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || [...value].length > maxLength)
    applicationError('validation_failed')
  return value.trim()
}

function optionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value))
    applicationError('validation_failed')
  return value
}

function requiredId(value: unknown): string {
  return optionalId(value) ?? applicationError('validation_failed')
}

function normalizedLegalIdentifier(value: unknown): string {
  if (typeof value !== 'string') applicationError('validation_failed')
  const normalized = value.replace(/[\s-]/g, '').toUpperCase()
  if (!normalized || [...normalized].length > 128)
    applicationError('validation_failed')
  return normalized
}

function employmentDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    applicationError('validation_failed')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    applicationError('validation_failed')
  return value
}

function currentEntity(value: AuxEntity): value is AuxCurrentEntity {
  return (auxCurrentEntities as readonly string[]).includes(value)
}

function snapshot(value: unknown): AuxCurrentSnapshot {
  const source = asRecord(value)
  only(source, ['id', 'code', 'name'])
  return {
    id: requiredId(source.id),
    code: requiredText(source.code, 64),
    name: requiredText(source.name, 200),
  }
}

function currentReferenceSource(entity: AuxCurrentEntity, id: string): string {
  return `aux_current:${entity}:${id}`
}

function upperCompact(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') applicationError('validation_failed')
  const normalized = value.replace(/[\s-]/g, '').toUpperCase()
  if (!normalized || [...normalized].length > maxLength)
    applicationError('validation_failed')
  return normalized
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  )
    applicationError('validation_failed')
  return value
}

function money(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value.trim())
  )
    applicationError('validation_failed')
  return value.trim()
}

function fixedMoney(value: unknown): string {
  const normalized = money(value)
  const [whole, fraction = ''] = normalized.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}

function fixedPercentage(value: unknown): string {
  const normalized = percentage(value)
  const [whole, fraction = ''] = normalized.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}

const settlementTermCodes = [
  'PREPAID',
  'CASH_ON_DELIVERY',
  'ARRIVAL_3',
  'ARRIVAL_5',
  'ARRIVAL_7',
  'ARRIVAL_15',
  'ARRIVAL_30',
  'MONTHLY_CURRENT',
  'MONTHLY_30',
  'MONTHLY_60',
  'MONTHLY_90',
] as const

function settlementTermCode(
  value: unknown,
): (typeof settlementTermCodes)[number] {
  return (
    settlementTermCodes.find((candidate) => candidate === value) ??
    applicationError('validation_failed')
  )
}

function settlementRuleType(value: unknown): 'RELATIVE_DAYS' | 'MONTH_END' {
  if (value !== 'RELATIVE_DAYS' && value !== 'MONTH_END')
    applicationError('validation_failed')
  return value
}

function percentage(value: unknown): string {
  const normalized = money(value)
  if (Number(normalized) > 99.99) applicationError('validation_failed')
  return normalized
}

function only(data: AuxData, keys: readonly string[]): void {
  if (Object.keys(data).some((key) => !keys.includes(key)))
    applicationError('validation_failed')
}

function parentData(
  name: string,
  parentId: string | null,
  description: string,
): AuxData {
  return { name, parentId: parentId ?? '', description }
}

function normaliseData(entity: AuxEntity, source: unknown): AuxData {
  const data = asRecord(source)
  if (entity === 'operating-entity') {
    only(data, [
      'legalName',
      'shortName',
      'legalIdentifier',
      'registeredAddress',
      'contactName',
      'contactPhone',
      'invoiceTitle',
      'invoiceAddress',
      'invoicePhone',
      'invoiceBank',
      'invoiceAccount',
      'remark',
    ])
    const legalIdentifier = normalizedLegalIdentifier(data.legalIdentifier)
    if (!/^[0-9A-Z]{18}$/.test(legalIdentifier))
      applicationError('validation_failed')
    return {
      legalName: requiredText(data.legalName, 200),
      shortName: optionalString(data.shortName, 100),
      legalIdentifier,
      registeredAddress: optionalString(data.registeredAddress, 500),
      contactName: optionalString(data.contactName, 100),
      contactPhone: optionalString(data.contactPhone, 32),
      invoiceTitle: optionalString(data.invoiceTitle, 200),
      invoiceAddress: optionalString(data.invoiceAddress, 500),
      invoicePhone: optionalString(data.invoicePhone, 32),
      invoiceBank: optionalString(data.invoiceBank, 200),
      invoiceAccount: optionalString(data.invoiceAccount, 128),
      remark: optionalString(data.remark),
    }
  }
  if (entity === 'employee') {
    only(data, [
      'identityKind',
      'legalName',
      'displayName',
      'legalIdentifier',
      'contactName',
      'phone',
      'address',
      'employeeCategoryId',
      'departmentId',
      'positionId',
      'employmentDate',
      'workPhone',
      'workEmail',
      'operatingEntityId',
      'remark',
    ])
    if (data.identityKind !== 'PERSON' && data.identityKind !== 'ORGANIZATION')
      applicationError('validation_failed')
    return {
      identityKind: data.identityKind,
      legalName: requiredText(data.legalName, 200),
      displayName: requiredText(data.displayName, 200),
      legalIdentifier: normalizedLegalIdentifier(data.legalIdentifier),
      contactName: optionalString(data.contactName, 100),
      phone: optionalString(data.phone, 32),
      address: optionalString(data.address, 500),
      employeeCategoryId: requiredId(data.employeeCategoryId),
      departmentId: requiredId(data.departmentId),
      positionId: requiredId(data.positionId),
      employmentDate: employmentDate(data.employmentDate),
      workPhone: optionalString(data.workPhone, 32),
      workEmail: optionalString(data.workEmail, 320),
      operatingEntityId: requiredId(data.operatingEntityId),
      remark: optionalString(data.remark),
    }
  }
  if (entity === 'warehouse') {
    only(data, [
      'name',
      'address',
      'contactName',
      'contactPhone',
      'managerEmployeeId',
      'remark',
    ])
    return {
      name: requiredText(data.name, 200),
      address: optionalString(data.address, 500),
      contactName: optionalString(data.contactName, 100),
      contactPhone: optionalString(data.contactPhone, 32),
      managerEmployeeId: optionalId(data.managerEmployeeId),
      remark: optionalString(data.remark),
    }
  }
  if (entity === 'fund-account') {
    only(data, [
      'name',
      'currency',
      'accountName',
      'bank',
      'branch',
      'accountNumber',
      'operatingEntityId',
      'remark',
    ])
    const currency = requiredText(data.currency, 16).toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) applicationError('validation_failed')
    return {
      name: requiredText(data.name, 200),
      currency,
      accountName: requiredText(data.accountName, 200),
      bank: requiredText(data.bank, 200),
      branch: optionalString(data.branch, 200),
      accountNumber: upperCompact(data.accountNumber, 128),
      operatingEntityId: requiredId(data.operatingEntityId),
      remark: optionalString(data.remark),
    }
  }
  if (entity === 'vehicle') {
    only(data, [
      'name',
      'plateNumber',
      'vehicleTypeId',
      'carrier',
      'vin',
      'engineNumber',
      'ratedLoadKg',
      'bulkWaterCarrier',
      'remark',
    ])
    const carrier = asRecord(data.carrier)
    if (carrier.kind === 'INTERNAL') {
      only(carrier, ['kind', 'operatingEntityId'])
    } else if (carrier.kind === 'EXTERNAL') {
      only(carrier, ['kind', 'otherUnitId', 'approvalEntryId'])
    } else applicationError('validation_failed')
    if (
      typeof data.ratedLoadKg !== 'number' ||
      !Number.isFinite(data.ratedLoadKg) ||
      data.ratedLoadKg < 0 ||
      typeof data.bulkWaterCarrier !== 'boolean'
    )
      applicationError('validation_failed')
    return {
      name: requiredText(data.name, 200),
      plateNumber: requiredText(data.plateNumber, 64)
        .replace(/\s/g, '')
        .toUpperCase(),
      vehicleTypeId: requiredId(data.vehicleTypeId),
      carrier:
        carrier.kind === 'INTERNAL'
          ? {
              kind: 'INTERNAL',
              operatingEntityId: requiredId(carrier.operatingEntityId),
            }
          : {
              kind: 'EXTERNAL',
              otherUnitId: requiredId(carrier.otherUnitId),
              approvalEntryId: requiredId(carrier.approvalEntryId),
            },
      vin:
        typeof data.vin === 'string' && data.vin.trim()
          ? requiredText(data.vin, 64).toUpperCase()
          : '',
      engineNumber: optionalString(data.engineNumber, 64),
      ratedLoadKg: data.ratedLoadKg,
      bulkWaterCarrier: data.bulkWaterCarrier,
      remark: optionalString(data.remark),
    }
  }
  const name = requiredString(data.name)
  switch (entity) {
    case 'product-category':
    case 'department':
      only(data, ['name', 'parentId', 'description'])
      return parentData(
        name,
        optionalId(data.parentId),
        optionalString(data.description),
      )
    case 'product-type': {
      only(data, ['name', 'behaviorProfile', 'description'])
      const behaviorProfile = data.behaviorProfile
      if (
        ![
          'RAW_MATERIAL',
          'STANDARD_FINISHED',
          'CUSTOM_FINISHED',
          'PACKAGING',
        ].includes(String(behaviorProfile))
      )
        applicationError('validation_failed')
      return {
        name,
        behaviorProfile: String(behaviorProfile),
        description: optionalString(data.description),
      }
    }
    case 'employee-category':
    case 'position':
    case 'dictionary-type':
      only(data, ['name', 'description'])
      return { name, description: optionalString(data.description) }
    case 'asset-category':
      only(data, [
        'name',
        'defaultUsefulLifeMonths',
        'defaultResidualRate',
        'description',
      ])
      return {
        name,
        defaultUsefulLifeMonths: integer(data.defaultUsefulLifeMonths, 1, 1200),
        defaultResidualRate: fixedPercentage(data.defaultResidualRate),
        description: optionalString(data.description),
      }
    case 'dictionary-item':
      only(data, ['name', 'dictionaryTypeId', 'sortOrder'])
      return {
        name,
        dictionaryTypeId:
          optionalId(data.dictionaryTypeId) ??
          applicationError('validation_failed'),
        sortOrder: integer(data.sortOrder, -2_147_483_648, 2_147_483_647),
      }
    case 'measurement-unit':
      only(data, ['name', 'symbol', 'quantityScale'])
      return {
        name,
        symbol:
          optionalString(data.symbol, 64) ||
          applicationError('validation_failed'),
        quantityScale: integer(data.quantityScale, 0, 6),
      }
    case 'settlement-method': {
      only(data, [
        'name',
        'termCode',
        'ruleType',
        'monthOffset',
        'dayOfMonth',
        'dayOffset',
        'defaultSalesSurcharge',
        'description',
      ])
      const termCode = String(data.termCode)
      if (
        ![
          'PREPAID',
          'CASH_ON_DELIVERY',
          'ARRIVAL_3',
          'ARRIVAL_5',
          'ARRIVAL_7',
          'ARRIVAL_15',
          'ARRIVAL_30',
          'MONTHLY_CURRENT',
          'MONTHLY_30',
          'MONTHLY_60',
          'MONTHLY_90',
        ].includes(termCode)
      )
        applicationError('validation_failed')
      const ruleType = String(data.ruleType)
      if (!['RELATIVE_DAYS', 'MONTH_END'].includes(ruleType))
        applicationError('validation_failed')
      return {
        name,
        termCode,
        ruleType,
        monthOffset: integer(data.monthOffset, 0, 3),
        dayOfMonth: integer(data.dayOfMonth, 0, 31),
        dayOffset: integer(data.dayOffset, 0, 30),
        defaultSalesSurcharge: fixedMoney(data.defaultSalesSurcharge),
        description: optionalString(data.description),
      }
    }
    case 'payment-method':
      only(data, ['name', 'defaultSalesSurcharge', 'description'])
      return {
        name,
        defaultSalesSurcharge: fixedMoney(data.defaultSalesSurcharge),
        description: optionalString(data.description),
      }
    case 'income-expense-type': {
      only(data, ['name', 'direction', 'parentId', 'description'])
      const direction = String(data.direction).toUpperCase()
      if (direction !== 'INCOME' && direction !== 'EXPENSE')
        applicationError('validation_failed')
      return {
        ...parentData(
          name,
          optionalId(data.parentId),
          optionalString(data.description),
        ),
        direction,
      }
    }
  }
}

/**
 * Dictionary items persist their resolved dictionary identity beside the
 * client-supplied fields.  Reference reads still validate the invariant
 * fields, without treating those server-derived fields as client input.
 */
function normaliseReferenceData(entity: AuxEntity, source: unknown): AuxData {
  if (entity !== 'dictionary-item') return normaliseData(entity, source)
  const data = asRecord(source)
  return normaliseData(entity, {
    name: data.name,
    dictionaryTypeId: data.dictionaryTypeId,
    sortOrder: data.sortOrder,
  })
}

function parseData(
  entity: AuxEntity,
  source: unknown,
): AuxDataByEntity[AuxEntity] {
  const stored = asRecord(source)
  if (entity === 'employee') {
    const data = stored
    only(data, [
      'identityKind',
      'legalName',
      'displayName',
      'legalIdentifier',
      'contactName',
      'phone',
      'address',
      'employeeCategory',
      'department',
      'position',
      'employmentDate',
      'workPhone',
      'workEmail',
      'operatingEntity',
      'remark',
    ])
    const normalized = normaliseData('employee', {
      identityKind: data.identityKind,
      legalName: data.legalName,
      displayName: data.displayName,
      legalIdentifier: data.legalIdentifier,
      contactName: data.contactName,
      phone: data.phone,
      address: data.address,
      employeeCategoryId: snapshot(data.employeeCategory).id,
      departmentId: snapshot(data.department).id,
      positionId: snapshot(data.position).id,
      employmentDate: data.employmentDate,
      workPhone: data.workPhone,
      workEmail: data.workEmail,
      operatingEntityId: snapshot(data.operatingEntity).id,
      remark: data.remark,
    })
    const {
      employeeCategoryId: _employeeCategoryId,
      departmentId: _departmentId,
      positionId: _positionId,
      operatingEntityId: _operatingEntityId,
      ...employee
    } = normalized
    return {
      ...employee,
      employeeCategory: snapshot(data.employeeCategory),
      department: snapshot(data.department),
      position: snapshot(data.position),
      operatingEntity: snapshot(data.operatingEntity),
    } as EmployeeCurrentData
  }
  if (entity === 'warehouse') {
    only(stored, [
      'name',
      'address',
      'contactName',
      'contactPhone',
      'manager',
      'remark',
    ])
    const manager = stored.manager === null ? null : snapshot(stored.manager)
    const normalized = normaliseData('warehouse', {
      name: stored.name,
      address: stored.address,
      contactName: stored.contactName,
      contactPhone: stored.contactPhone,
      managerEmployeeId: manager?.id ?? null,
      remark: stored.remark,
    })
    const { managerEmployeeId: _managerEmployeeId, ...fields } = normalized
    return { ...fields, manager } as WarehouseCurrentData
  }
  if (entity === 'fund-account') {
    only(stored, [
      'name',
      'currency',
      'accountName',
      'bank',
      'branch',
      'accountNumber',
      'operatingEntity',
      'remark',
    ])
    const operatingEntity = snapshot(stored.operatingEntity)
    const normalized = normaliseData('fund-account', {
      name: stored.name,
      currency: stored.currency,
      accountName: stored.accountName,
      bank: stored.bank,
      branch: stored.branch,
      accountNumber: stored.accountNumber,
      operatingEntityId: operatingEntity.id,
      remark: stored.remark,
    })
    const { operatingEntityId: _operatingEntityId, ...fields } = normalized
    return { ...fields, operatingEntity } as FundAccountCurrentData
  }
  if (entity === 'vehicle') {
    only(stored, [
      'name',
      'plateNumber',
      'vehicleType',
      'carrier',
      'vin',
      'engineNumber',
      'ratedLoadKg',
      'bulkWaterCarrier',
      'remark',
    ])
    const vehicleType = snapshot(stored.vehicleType)
    const carrier = asRecord(stored.carrier)
    let parsedCarrier: VehicleCarrierCurrentData
    let inputCarrier: VehicleCurrentInput['carrier']
    if (carrier.kind === 'INTERNAL') {
      only(carrier, ['kind', 'operatingEntityId', 'code', 'name'])
      parsedCarrier = {
        kind: 'INTERNAL',
        operatingEntityId: requiredId(carrier.operatingEntityId),
        code: requiredText(carrier.code, 64),
        name: requiredText(carrier.name, 200),
      }
      inputCarrier = {
        kind: 'INTERNAL',
        operatingEntityId: parsedCarrier.operatingEntityId,
      }
    } else if (carrier.kind === 'EXTERNAL') {
      only(carrier, ['kind', 'otherUnitId', 'approvalEntryId', 'code', 'name'])
      parsedCarrier = {
        kind: 'EXTERNAL',
        otherUnitId: requiredId(carrier.otherUnitId),
        approvalEntryId: requiredId(carrier.approvalEntryId),
        code: requiredText(carrier.code, 64),
        name: requiredText(carrier.name, 200),
      }
      inputCarrier = {
        kind: 'EXTERNAL',
        otherUnitId: parsedCarrier.otherUnitId,
        approvalEntryId: parsedCarrier.approvalEntryId,
      }
    } else applicationError('internal_error')
    const normalized = normaliseData('vehicle', {
      name: stored.name,
      plateNumber: stored.plateNumber,
      vehicleTypeId: vehicleType.id,
      carrier: inputCarrier,
      vin: stored.vin,
      engineNumber: stored.engineNumber,
      ratedLoadKg: stored.ratedLoadKg,
      bulkWaterCarrier: stored.bulkWaterCarrier,
      remark: stored.remark,
    })
    const {
      vehicleTypeId: _vehicleTypeId,
      carrier: _carrier,
      ...fields
    } = normalized
    return {
      ...fields,
      vehicleType,
      carrier: parsedCarrier,
    } as VehicleCurrentData
  }
  const normalized = normaliseReferenceData(entity, stored)
  if (entity !== 'dictionary-item')
    return normalized as AuxDataByEntity[AuxEntity]
  return {
    ...normalized,
    dictionaryTypeCode: requiredString(stored.dictionaryTypeCode),
    dictionaryTypeName: requiredString(stored.dictionaryTypeName),
  } as AuxDataByEntity['dictionary-item']
}

function parseRow(row: StoredAuxObject): ParsedAuxRow {
  assertEntity(row.entity)
  return {
    id: row.id,
    entity: row.entity,
    code: row.code,
    enabled: row.enabled,
    revision: revisionString(row.revision),
    data: parseData(row.entity, row.data),
    updatedAt: dateTime(row.updated_at),
    updatedBy: row.updated_by,
  }
}

function availableActions(
  entity: AuxEntity,
  enabled: boolean,
  actor: AuxActor,
): AuxAvailableAction[] {
  const actions: AuxAvailableAction[] = []
  if (actor.permissions.includes(`/aux/${entity}/save`)) actions.push('edit')
  if (
    actor.permissions.includes(
      `/aux/${entity}/${enabled ? 'disable' : 'enable'}`,
    )
  )
    actions.push(enabled ? 'disable' : 'enable')
  if (
    (entity === 'warehouse' ||
      entity === 'fund-account' ||
      entity === 'vehicle') &&
    actor.permissions.includes(`/aux/${entity}/delete`)
  )
    actions.push('delete')
  return actions
}

function currentName(row: ParsedAuxRow): string {
  if (row.entity === 'operating-entity')
    return (row.data as OperatingEntityCurrentData).legalName
  if (row.entity === 'employee')
    return (row.data as EmployeeCurrentData).displayName
  return (row.data as { name: string }).name
}

function listItem(row: ParsedAuxRow, actor: AuxActor): AuxListItem {
  return {
    id: row.id,
    code: row.code,
    py: searchPinyin(currentName(row)),
    name: currentName(row),
    enabled: row.enabled,
    revision: row.revision,
    availableActions: availableActions(row.entity, row.enabled, actor),
  }
}

function detail<Entity extends AuxEntity>(
  row: ParsedAuxRow<Entity>,
  actor: AuxActor,
): AuxObjectView<Entity> {
  return {
    ...listItem(row, actor),
    ...row.data,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

/**
 * Resolves an enabled AUX current reference inside the caller's
 * transaction. Consumers persist the returned typed snapshot with their own
 * business fact; later current edits never reinterpret that adoption.
 */
export async function resolveAuxCurrentReference<
  Entity extends AuxCurrentEntity,
>(
  transaction: Transaction<DB>,
  entity: Entity,
  id: string,
): Promise<AuxCurrentReference<Entity>> {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))
    applicationError('validation_failed')
  const result =
    await sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by
    FROM aux_objects WHERE id = ${id} AND entity = ${entity} AND enabled = true FOR SHARE`.execute(
      transaction,
    )
  const row = result.rows[0]
  if (!row)
    applicationError('conflict', {
      blockers: [{ field: 'reference', objectId: id, entity }],
    })
  const parsed = parseRow(row) as ParsedAuxRow<Entity>
  if (entity === 'vehicle') {
    const vehicle = parsed.data as VehicleCurrentData
    if (vehicle.carrier.kind === 'INTERNAL')
      await resolveAuxCurrentReference(
        transaction,
        'operating-entity',
        vehicle.carrier.operatingEntityId,
      )
    else
      await resolveExternalCarrier(
        transaction,
        vehicle.carrier.otherUnitId,
        vehicle.carrier.approvalEntryId,
      )
  }
  return {
    objectId: parsed.id,
    code: parsed.code,
    name: currentName(parsed),
    data: parsed.data as AuxDataByEntity[Entity],
  }
}

async function resolveExternalCarrier(
  transaction: Transaction<DB>,
  otherUnitId: string,
  approvalEntryId: string,
): Promise<Extract<VehicleCarrierCurrentData, { kind: 'EXTERNAL' }>> {
  const result = await sql<{ code: string; name: string }>`
      SELECT subject.code,
        COALESCE(NULLIF(version.display_name, ''), version.legal_name) AS name
      FROM approval_entries entry
      JOIN bob_subjects subject ON subject.id = entry.subject_id
        AND subject.entity = 'other-unit'
      JOIN bob_other_unit_versions version ON version.approval_entry_id = entry.id
      WHERE entry.id = ${approvalEntryId}
        AND entry.subject_id = ${otherUnitId}
        AND entry.domain = 'bob'
        AND entry.entity = 'other-unit'
        AND entry.status = 'APPROVED'
        AND subject.enabled = true
        AND NOT EXISTS (
          SELECT 1 FROM approval_entries newer
          WHERE newer.domain = 'bob' AND newer.entity = 'other-unit'
            AND newer.subject_id = entry.subject_id
            AND newer.status = 'APPROVED'
            AND newer.version_no > entry.version_no
        )
      FOR SHARE OF entry, subject, version
    `.execute(transaction)
  const row = result.rows[0]
  if (!row)
    applicationError('conflict', {
      blockers: [
        {
          field: 'carrier',
          objectId: otherUnitId,
          approvalEntryId,
          entity: 'other-unit',
        },
      ],
    })
  return {
    kind: 'EXTERNAL',
    otherUnitId,
    approvalEntryId,
    code: requiredText(row.code, 64),
    name: requiredText(row.name, 200),
  }
}

export class AuxService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  /**
   * Imports one selected DCL current fact into the caller's migration
   * transaction. Employee snapshots are historical adopted facts: validate
   * their stable identities and codes, but never replace their frozen names
   * with a later AUX current value.
   */
  async importCurrent(
    transaction: Transaction<DB>,
    row: AuxCurrentImportRow,
  ): Promise<void> {
    if (!currentEntity(row.entity) || !requiredId(row.id))
      applicationError('validation_failed')
    const code = requiredText(row.code, 64)
    if (!new RegExp(`^${codePrefixes[row.entity]}-\\d{4}$`).test(code))
      applicationError('validation_failed')
    if (
      typeof row.enabled !== 'boolean' ||
      !row.createdBy ||
      !row.updatedBy ||
      !row.createdAt ||
      !row.updatedAt
    )
      applicationError('validation_failed')
    await this.lock(transaction)
    let data: AuxCurrentImportRow['data']
    if (row.entity === 'operating-entity')
      data = normaliseData(
        'operating-entity',
        row.data,
      ) as unknown as OperatingEntityCurrentData
    else if (row.entity === 'employee')
      data = parseData('employee', row.data) as EmployeeCurrentData
    else if (row.entity === 'warehouse')
      data = parseData('warehouse', row.data) as WarehouseCurrentData
    else if (row.entity === 'fund-account')
      data = parseData('fund-account', row.data) as FundAccountCurrentData
    else data = parseData('vehicle', row.data) as VehicleCurrentData
    if (row.entity === 'operating-entity' || row.entity === 'employee')
      await this.assertUniqueLegalIdentifier(
        transaction,
        row.entity,
        row.id,
        String(
          (data as OperatingEntityCurrentData | EmployeeCurrentData)
            .legalIdentifier,
        ),
      )
    if (row.entity === 'fund-account')
      await this.assertUniqueCurrentField(
        transaction,
        'fund-account',
        row.id,
        'accountNumber',
        (data as FundAccountCurrentData).accountNumber,
        'fund_account_duplicate_account_number',
      )
    if (row.entity === 'vehicle') {
      await this.assertUniqueCurrentField(
        transaction,
        'vehicle',
        row.id,
        'plateNumber',
        (data as VehicleCurrentData).plateNumber,
        'vehicle_duplicate_plate_number',
      )
      if ((data as VehicleCurrentData).vin)
        await this.assertUniqueCurrentField(
          transaction,
          'vehicle',
          row.id,
          'vin',
          (data as VehicleCurrentData).vin,
          'vehicle_duplicate_vin',
        )
    }
    await this.validateImportedCurrentReferences(transaction, row.entity, data)
    await sql`INSERT INTO aux_objects(id, entity, code, enabled, revision, data, created_at, updated_at, created_by, updated_by)
      VALUES (${row.id}, ${row.entity}, ${code}, ${row.enabled}, 1, ${JSON.stringify(data)}::jsonb, ${row.createdAt}, ${row.updatedAt}, ${row.createdBy}, ${row.updatedBy})`.execute(
      transaction,
    )
    const importedNumber = Number(code.slice(-4))
    await sql`INSERT INTO object_number_counters(domain, entity, last_value)
      VALUES ('aux', ${row.entity}, ${importedNumber})
      ON CONFLICT (domain, entity) DO UPDATE
        SET last_value = GREATEST(object_number_counters.last_value, EXCLUDED.last_value)`.execute(
      transaction,
    )
    await this.replaceCurrentReferenceFacts(
      transaction,
      row.entity,
      row.id,
      data,
    )
  }

  async query<Entity extends AuxEntity>(
    entity: Entity,
    input: AuxQueryInput,
    actor: AuxActor,
  ): Promise<{
    items: AuxListItem[]
    total: number
    page: number
    pageSize: 20
  }> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/query`)
    const query = strictInput(
      input,
      entity === 'measurement-unit'
        ? ['keyword', 'quantityScale', 'page', 'pageSize']
        : ['keyword', 'page', 'pageSize'],
    )
    if (
      query.pageSize !== 20 ||
      (query.keyword !== undefined && typeof query.keyword !== 'string')
    )
      applicationError('validation_failed')
    const page = integer(query.page, 1, Number.MAX_SAFE_INTEGER)
    const quantityScale =
      entity === 'measurement-unit' && query.quantityScale !== undefined
        ? integer(query.quantityScale, 0, 6)
        : undefined
    const rows =
      await sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by FROM aux_objects WHERE entity = ${entity} ORDER BY code, id`.execute(
        this.db,
      )
    const keyword = String(query.keyword ?? '')
      .trim()
      .toLocaleLowerCase()
    const matches = rows.rows.map(parseRow).filter((row) => {
      const item = listItem(row, actor)
      return (
        (!keyword ||
          item.code.toLocaleLowerCase().includes(keyword) ||
          item.py.includes(keyword) ||
          item.name.toLocaleLowerCase().includes(keyword)) &&
        (quantityScale === undefined ||
          (row.data as AuxDataByEntity['measurement-unit']).quantityScale ===
            quantityScale)
      )
    })
    const offset = (page - 1) * 20
    return {
      items: matches.slice(offset, offset + 20).map((row) => {
        const item = listItem(row, actor)
        if (entity !== 'measurement-unit') return item
        const data = row.data as AuxDataByEntity['measurement-unit']
        return {
          ...item,
          symbol: data.symbol,
          quantityScale: data.quantityScale,
        }
      }),
      total: matches.length,
      page,
      pageSize: 20,
    }
  }

  async get<Entity extends AuxEntity>(
    entity: Entity,
    input: AuxIdentifierInput,
    actor: AuxActor,
  ): Promise<AuxObjectView<Entity>> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/get`)
    const identifier = strictInput(input, ['id'])
    const id = inputId(identifier.id)
    const result =
      await sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by FROM aux_objects WHERE id = ${id} AND entity = ${entity}`.execute(
        this.db,
      )
    const row = result.rows[0]
    if (!row) applicationError('validation_failed')
    return detail(parseRow(row) as ParsedAuxRow<Entity>, actor)
  }

  async create<Entity extends AuxEntity>(
    entity: Entity,
    data: AuxWriteData<Entity>,
    actor: AuxActor,
    requestId?: string,
  ): Promise<AuxMutationResult> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/create`)
    if (entity === 'settlement-method') applicationError('validation_failed')
    return this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const normalised = await this.validateData(
        transaction,
        entity,
        null,
        writeData(entity, data),
      )
      const counter = await sql<{
        last_value: number
      }>`INSERT INTO object_number_counters(domain, entity, last_value) VALUES ('aux', ${entity}, 1) ON CONFLICT (domain, entity) DO UPDATE SET last_value = object_number_counters.last_value + 1 WHERE object_number_counters.last_value < 9999 RETURNING last_value`.execute(
        transaction,
      )
      const number = counter.rows[0]?.last_value
      if (!number) applicationError('conflict')
      const id = ulid()
      await sql`INSERT INTO aux_objects(id, entity, code, enabled, revision, data, created_by, updated_by) VALUES (${id}, ${entity}, ${`${codePrefixes[entity]}-${String(number).padStart(4, '0')}`}, true, 1, ${JSON.stringify(normalised)}::jsonb, ${actor.id}, ${actor.id})`.execute(
        transaction,
      )
      if (currentEntity(entity))
        await this.replaceCurrentReferenceFacts(
          transaction,
          entity,
          id,
          normalised as unknown as AuxDataByEntity[typeof entity],
        )
      if (currentEntity(entity))
        await this.recordCurrentAudit(
          transaction,
          entity,
          'CREATED',
          id,
          '1',
          actor,
          requestId,
        )
      return { id, revision: '1', enabled: true }
    })
  }

  async ensureE2ESettlementMethod(
    data: unknown,
    actor: AuxActor & { trusted?: boolean },
  ): Promise<AuxMutationResult> {
    if (actor.trusted !== true) applicationError('forbidden')
    return this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const normalised = await this.validateData(
        transaction,
        'settlement-method',
        null,
        inputRecord(data),
      )
      const existing = await sql<{
        id: string
        revision: string | number | bigint
        enabled: boolean
      }>`
        SELECT id, revision, enabled FROM aux_objects
        WHERE entity = 'settlement-method'
          AND data->>'termCode' = ${String(normalised.termCode)}
          AND data->>'name' = ${String(normalised.name)}
        FOR UPDATE
      `.execute(transaction)
      if (existing.rows[0]) {
        const row = existing.rows[0]
        return {
          id: row.id,
          revision: revisionString(row.revision),
          enabled: row.enabled,
        }
      }
      const counter = await sql<{ last_value: number }>`
        INSERT INTO object_number_counters(domain, entity, last_value)
        VALUES ('aux', 'settlement-method', 1)
        ON CONFLICT (domain, entity) DO UPDATE
          SET last_value = object_number_counters.last_value + 1
          WHERE object_number_counters.last_value < 9999
        RETURNING last_value
      `.execute(transaction)
      const number = counter.rows[0]?.last_value
      if (!number) applicationError('conflict')
      const id = ulid()
      await sql`INSERT INTO aux_objects(id, entity, code, enabled, revision, data, created_by, updated_by)
        VALUES (${id}, 'settlement-method', ${`${codePrefixes['settlement-method']}-${String(number).padStart(4, '0')}`}, true, 1, ${JSON.stringify(normalised)}::jsonb, ${actor.id}, ${actor.id})`.execute(
        transaction,
      )
      return { id, revision: '1', enabled: true }
    })
  }

  async save<Entity extends AuxEntity>(
    entity: Entity,
    input: AuxSaveInput<Entity>,
    actor: AuxActor,
    requestId?: string,
  ): Promise<AuxMutationResult> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/save`)
    const source = inputRecord(input)
    const id = inputId(source.id)
    const expectedRevision = inputRevision(source.revision)
    const { id: _id, revision: _revision, ...data } = source
    return this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const current = await this.lockObject(transaction, entity, id)
      if (revision(current.revision) !== revision(expectedRevision))
        applicationError('conflict', {
          revision: revisionString(current.revision),
        })
      const normalised = await this.validateData(
        transaction,
        entity,
        id,
        writeData(entity, data),
        asRecord(current.data),
      )
      const updated = await transaction
        .updateTable('aux_objects')
        .set({
          data: JSON.stringify(normalised),
          revision: sql`revision + 1`,
          updated_at: new Date(),
          updated_by: actor.id,
        })
        .where('id', '=', id)
        .where('entity', '=', entity)
        .where('revision', '=', revisionString(current.revision))
        .executeTakeFirst()
      if (updated.numUpdatedRows !== 1n)
        applicationError('conflict', {
          revision: revisionString(current.revision),
        })
      const nextRevision = revisionString(revision(current.revision) + 1n)
      if (currentEntity(entity))
        await this.replaceCurrentReferenceFacts(
          transaction,
          entity,
          id,
          normalised as unknown as AuxDataByEntity[typeof entity],
        )
      if (currentEntity(entity))
        await this.recordCurrentAudit(
          transaction,
          entity,
          'SAVED',
          id,
          nextRevision,
          actor,
          requestId,
        )
      return {
        id,
        revision: nextRevision,
        enabled: current.enabled,
      }
    })
  }

  async enable(
    entity: AuxEntity,
    input: AuxRevisionInput,
    actor: AuxActor,
    requestId: string,
  ): Promise<AuxMutationResult> {
    return this.setEnabled(entity, input, true, actor, requestId)
  }

  async disable(
    entity: AuxEntity,
    input: AuxRevisionInput,
    actor: AuxActor,
    requestId: string,
  ): Promise<AuxMutationResult> {
    return this.setEnabled(entity, input, false, actor, requestId)
  }

  async delete(
    entity: AuxEntity,
    input: AuxRevisionInput,
    actor: AuxActor,
    requestId?: string,
  ): Promise<void> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/delete`)
    if (entity === 'settlement-method') applicationError('validation_failed')
    const target = strictInput(input, ['id', 'revision'])
    const id = inputId(target.id)
    const expectedRevision = inputRevision(target.revision)
    await this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const current = await this.lockObject(transaction, entity, id)
      if (revision(current.revision) !== revision(expectedRevision))
        applicationError('conflict', {
          revision: revisionString(current.revision),
        })
      const references = [
        sql`SELECT source FROM aux_reference_facts WHERE aux_object_id = ${id}`,
      ]
      if (entity === 'measurement-unit') {
        references.push(sql`
          SELECT 'dcl_product_versions' AS source
          FROM dcl_product_versions
          WHERE default_input_unit_id = ${id} OR pricing_unit_id = ${id}
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(unit_conversions) conversion
              WHERE conversion->'unit'->>'id' = ${id}
            )
            OR fixed_formula->'output'->'enteredUnit'->>'id' = ${id}
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(fixed_formula->'components', '[]'::jsonb)) component
              WHERE component->'quantity'->'enteredUnit'->>'id' = ${id}
            )
          UNION ALL
          SELECT 'vou_product_line_snapshots' AS source
          FROM vou_product_line_snapshots
          WHERE entered_unit_id = ${id} OR formula_output_entered_unit_id = ${id}
          UNION ALL
          SELECT 'vou_formula_component_snapshots' AS source
          FROM vou_formula_component_snapshots WHERE entered_unit_id = ${id}
          UNION ALL
          SELECT 'vou_inventory_count_line_snapshots' AS source
          FROM vou_inventory_count_line_snapshots WHERE entered_unit_id = ${id}
          UNION ALL
          SELECT 'vou_production_line_snapshots' AS source
          FROM vou_production_line_snapshots WHERE entered_unit_id = ${id}
          UNION ALL
          SELECT 'vou_production_material_snapshots' AS source
          FROM vou_production_material_snapshots WHERE entered_unit_id = ${id}
        `)
      }
      if (entity === 'payment-method')
        references.push(sql`
          SELECT 'dcl_customer_version_subunits' AS source
          FROM dcl_customer_version_subunits
          WHERE payment_snapshot->>'id' = ${id}
          UNION ALL
          SELECT 'vou_sale_order_details' AS source
          FROM vou_sale_order_details WHERE payment_method_id = ${id}
        `)
      const blockers = await sql<{
        source: string
        count: string | number
      }>`SELECT source, count(*)::bigint AS count
         FROM (${sql.join(references, sql` UNION ALL `)}) reference
         GROUP BY source ORDER BY source`.execute(transaction)
      if (blockers.rows.length > 0)
        applicationError('conflict', {
          blockers: blockers.rows.map((row) => ({
            source: row.source,
            count: Number(row.count),
          })),
        })
      if (currentEntity(entity))
        await transaction
          .deleteFrom('aux_reference_facts')
          .where('source', '=', currentReferenceSource(entity, id))
          .execute()
      await sql`DELETE FROM aux_objects WHERE id = ${id} AND entity = ${entity}`.execute(
        transaction,
      )
      if (currentEntity(entity))
        await this.recordCurrentAudit(
          transaction,
          entity,
          'DELETED',
          id,
          revisionString(current.revision),
          actor,
          requestId,
        )
    })
  }

  async queryReferenceCandidates(
    input: AuxReferenceQueryInput,
    actor: AuxActor,
  ): Promise<AuxReferenceCandidate[]> {
    const { entity } = input
    if (
      !(
        [
          'settlement-method',
          'payment-method',
          'dictionary-item',
          'product-type',
          'product-category',
          'employee-category',
          'department',
          'position',
          'measurement-unit',
        ] as const
      ).includes(entity)
    )
      applicationError('validation_failed')
    assertPermission(actor, `/aux/${entity}/query`)
    const where = [sql`entity = ${entity}`, sql`enabled = true`]
    if (input.keyword?.trim()) {
      const keyword = `%${input.keyword.trim()}%`
      where.push(
        sql`(code ILIKE ${keyword} OR COALESCE(data->>'name', '') ILIKE ${keyword})`,
      )
    }
    if (input.dictionaryTypeCode?.trim())
      where.push(
        sql`data->>'dictionaryTypeCode' = ${input.dictionaryTypeCode.trim()}`,
      )
    const result = await sql<{
      id: string
      code: string
      name: string
      behavior_profile: AuxReferenceCandidate['behaviorProfile'] | null
      quantity_scale: number | null
      symbol: string | null
      data: unknown
    }>`SELECT id, code, data, COALESCE(data->>'name', '') AS name,
      CASE WHEN entity = 'product-type' THEN data->>'behaviorProfile' END AS behavior_profile,
      CASE WHEN entity = 'measurement-unit' THEN NULLIF(data->>'quantityScale', '')::integer END AS quantity_scale,
      CASE WHEN entity = 'measurement-unit' THEN data->>'symbol' END AS symbol
      FROM aux_objects WHERE ${sql.join(where, sql` AND `)} ORDER BY COALESCE((data->>'sortOrder')::integer, 2147483647), code, id LIMIT 20`.execute(
      this.db,
    )
    return result.rows.map((row) => {
      const data = normaliseReferenceData(entity, row.data)
      const common = {
        objectId: row.id,
        code: row.code,
        name: row.name,
      }
      if (entity === 'product-type') {
        const behaviorProfile = data.behaviorProfile
        if (
          behaviorProfile !== 'RAW_MATERIAL' &&
          behaviorProfile !== 'STANDARD_FINISHED' &&
          behaviorProfile !== 'CUSTOM_FINISHED' &&
          behaviorProfile !== 'PACKAGING'
        )
          applicationError('validation_failed')
        return { ...common, behaviorProfile }
      }
      if (entity === 'measurement-unit') {
        if (row.quantity_scale === null || row.symbol === null)
          applicationError('validation_failed')
        const symbol = optionalString(row.symbol, 64)
        if (!symbol) applicationError('validation_failed')
        return {
          ...common,
          quantityScale: row.quantity_scale,
          symbol,
        }
      }
      if (entity === 'settlement-method')
        return {
          ...common,
          termCode: settlementTermCode(data.termCode),
          ruleType: settlementRuleType(data.ruleType),
          monthOffset: integer(data.monthOffset, 0, 3),
          dayOfMonth: integer(data.dayOfMonth, 0, 31),
          dayOffset: integer(data.dayOffset, 0, 30),
          defaultSalesSurcharge: fixedMoney(data.defaultSalesSurcharge),
        }
      if (entity === 'payment-method')
        return {
          ...common,
          defaultSalesSurcharge: fixedMoney(data.defaultSalesSurcharge),
        }
      return common
    })
  }

  private async setEnabled(
    entity: AuxEntity,
    input: AuxRevisionInput,
    enabled: boolean,
    actor: AuxActor,
    requestId: string,
  ): Promise<AuxMutationResult> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/${enabled ? 'enable' : 'disable'}`)
    const target = strictInput(input, ['id', 'revision'])
    const id = inputId(target.id)
    const expectedRevision = inputRevision(target.revision)
    return this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      await changeEnablement(
        transaction,
        { id, revision: expectedRevision, enabled },
        {
          domain: 'aux',
          entity,
          actorId: actor.id,
          requestId,
          eventType: `AUX_${entity.replaceAll('-', '_').toUpperCase()}_${enabled ? 'ENABLED' : 'DISABLED'}`,
          changedError: 'conflict',
        },
        {
          read: async (tx, targetId) => {
            const row =
              await sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by FROM aux_objects WHERE id = ${targetId} AND entity = ${entity} FOR UPDATE`.execute(
                tx,
              )
            const current = row.rows[0]
            return current
              ? {
                  id: current.id,
                  enabled: current.enabled,
                  revision: revisionString(current.revision),
                  data: current.data,
                }
              : undefined
          },
          write: async (tx, current, nextEnabled, nextRevision) => {
            const updated = await tx
              .updateTable('aux_objects')
              .set({
                enabled: nextEnabled,
                revision: nextRevision,
                updated_at: new Date(),
                updated_by: actor.id,
              })
              .where('id', '=', current.id)
              .where('entity', '=', entity)
              .where('revision', '=', current.revision)
              .executeTakeFirst()
            return updated.numUpdatedRows === 1n
          },
        },
        {
          beforeWrite: async (current) => {
            if (enabled) {
              let currentData: AuxData
              if (entity === 'employee') {
                const {
                  employeeCategory,
                  department,
                  position,
                  operatingEntity,
                  ...fields
                } = parseData('employee', current.data) as EmployeeCurrentData
                currentData = {
                  ...fields,
                  employeeCategoryId: employeeCategory.id,
                  departmentId: department.id,
                  positionId: position.id,
                  operatingEntityId: operatingEntity.id,
                }
              } else if (entity === 'warehouse') {
                const { manager, ...fields } = parseData(
                  'warehouse',
                  current.data,
                ) as WarehouseCurrentData
                currentData = {
                  ...fields,
                  managerEmployeeId: manager?.id ?? null,
                }
              } else if (entity === 'fund-account') {
                const { operatingEntity, ...fields } = parseData(
                  'fund-account',
                  current.data,
                ) as FundAccountCurrentData
                currentData = {
                  ...fields,
                  operatingEntityId: operatingEntity.id,
                }
              } else if (entity === 'vehicle') {
                const { vehicleType, carrier, ...fields } = parseData(
                  'vehicle',
                  current.data,
                ) as VehicleCurrentData
                currentData = {
                  ...fields,
                  vehicleTypeId: vehicleType.id,
                  carrier:
                    carrier.kind === 'INTERNAL'
                      ? {
                          kind: 'INTERNAL',
                          operatingEntityId: carrier.operatingEntityId,
                        }
                      : {
                          kind: 'EXTERNAL',
                          otherUnitId: carrier.otherUnitId,
                          approvalEntryId: carrier.approvalEntryId,
                        },
                }
              } else currentData = normaliseReferenceData(entity, current.data)
              await this.validateData(
                transaction,
                entity,
                current.id,
                currentData,
                currentData,
              )
            } else if (entity === 'warehouse')
              await this.assertWarehouseCanDisable(transaction, current.id)
            else if (entity === 'operating-entity') {
              const carriers = await transaction
                .selectFrom('aux_reference_facts')
                .select('source')
                .where('aux_object_id', '=', current.id)
                .where('source', 'like', 'aux_current:vehicle:%')
                .execute()
              if (carriers.length)
                applicationError('conflict', {
                  blockers: carriers.map((row) => ({
                    source: row.source,
                    field: 'carrier',
                    objectId: current.id,
                  })),
                })
            }
          },
          afterWrite: async () => undefined,
        },
      )
      return {
        id,
        revision: revisionString(revision(expectedRevision) + 1n),
        enabled,
      }
    })
  }

  private async assertWarehouseCanDisable(
    transaction: Transaction<DB>,
    warehouseId: string,
  ): Promise<void> {
    const [inventory, documents] = await Promise.all([
      sql<{
        book_id: string
        product_id: string
        quantity: string
      }>`
        SELECT book_id, product_id, SUM(quantity)::text AS quantity
        FROM acc_inventory_entries
        WHERE warehouse_id = ${warehouseId} AND reversed_at IS NULL
        GROUP BY book_id, product_id
        HAVING SUM(quantity) <> 0
        ORDER BY product_id
      `.execute(transaction),
      sql<{
        entity: string
        document_id: string
        document_no: string
      }>`
        SELECT DISTINCT document.entity, document.id AS document_id,
          document.document_no
        FROM vou_reference_snapshots reference
        JOIN approval_entries entry ON entry.id = reference.approval_entry_id
        JOIN vou_documents document ON document.id = entry.subject_id
        WHERE reference.object_id = ${warehouseId}
          AND reference.reference_entity = 'warehouse'
          AND entry.domain = 'vou'
          AND entry.status IN ('PENDING', 'REJECTED')
        ORDER BY document.entity, document.document_no, document.id
      `.execute(transaction),
    ])
    const legacy = await transaction
      .selectFrom('dcl_warehouse_usage_facts')
      .selectAll()
      .where('warehouse_id', '=', warehouseId)
      .execute()
    const retained = {
      inventory: [],
      documents: [],
      sources: [],
      references: [],
    } as Record<
      'inventory' | 'documents' | 'sources' | 'references',
      Array<Record<string, unknown>>
    >
    for (const row of legacy) {
      if (row.kind === 'INVENTORY' && BigInt(row.quantity_micros ?? 0) === 0n)
        continue
      const key =
        row.kind === 'INVENTORY'
          ? 'inventory'
          : row.kind === 'DOCUMENT'
            ? 'documents'
            : row.kind === 'SOURCE'
              ? 'sources'
              : 'references'
      retained[key].push({
        entity: row.entity,
        businessId: row.business_id,
        businessCode: row.business_code,
        ...(row.quantity_micros === null
          ? {}
          : { quantityMicros: String(row.quantity_micros) }),
      })
    }
    const currentReferences = await sql<{ source: string }>`
      SELECT fact.source FROM aux_reference_facts fact
      WHERE fact.aux_object_id = ${warehouseId}
        AND (fact.source LIKE 'aux_current:%'
          OR EXISTS (SELECT 1 FROM approval_entries entry
            WHERE entry.id = split_part(fact.source, ':', 2)
              AND entry.domain = 'vou' AND entry.status = 'APPROVED'
              AND entry.entity IN ('sale-order', 'purchase-order')
              AND EXISTS (SELECT 1 FROM vou_product_line_snapshots line
                WHERE line.approval_entry_id = entry.id
                  AND line.base_quantity_micros > COALESCE((
                    SELECT SUM(usage.base_quantity_micros)
                    FROM vou_source_line_snapshots usage
                    JOIN approval_entries consumed ON consumed.id = usage.approval_entry_id
                    WHERE usage.source_line_id = line.line_id AND consumed.status = 'APPROVED'
                      AND consumed.entity = CASE entry.entity WHEN 'sale-order' THEN 'sale-outbound' ELSE 'purchase-inbound' END
                  ), 0)))
          OR EXISTS (SELECT 1 FROM approval_entries entry
            WHERE entry.id = split_part(fact.source, ':', 3)
              AND entry.domain = 'acc' AND entry.status IN ('PENDING', 'REJECTED')))
    `.execute(transaction)
    retained.references.push(
      ...currentReferences.rows.map((row) => ({ source: row.source })),
    )
    if (
      inventory.rows.length === 0 &&
      documents.rows.length === 0 &&
      Object.values(retained).every((rows) => rows.length === 0)
    )
      return
    applicationError('warehouse_disable_blocked', {
      inventory: [
        ...retained.inventory,
        ...inventory.rows.map((row) => ({
          entity: 'product',
          bookId: row.book_id,
          businessId: row.product_id,
          quantity: row.quantity,
        })),
      ],
      documents: [
        ...retained.documents,
        ...documents.rows.map((row) => ({
          entity: row.entity,
          businessId: row.document_id,
          businessCode: row.document_no,
        })),
      ],
      sources: retained.sources,
      references: retained.references,
    })
  }

  private async lock(transaction: Transaction<DB>): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(${auxiliaryWriteLockKey})`.execute(
      transaction,
    )
  }

  private async lockObject(
    transaction: Transaction<DB>,
    entity: AuxEntity,
    objectId: string,
  ): Promise<StoredAuxObject> {
    const result =
      await sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by FROM aux_objects WHERE id = ${objectId} AND entity = ${entity} FOR UPDATE`.execute(
        transaction,
      )
    const row = result.rows[0]
    if (!row) applicationError('validation_failed')
    return row
  }

  private async validateData(
    transaction: Transaction<DB>,
    entity: AuxEntity,
    objectId: string | null,
    source: unknown,
    current?: AuxData,
  ): Promise<AuxData> {
    const data = normaliseData(entity, source)
    if (entity === 'operating-entity') {
      await this.assertUniqueLegalIdentifier(
        transaction,
        entity,
        objectId,
        String(data.legalIdentifier),
      )
      return data
    }
    if (entity === 'employee') {
      await this.assertUniqueLegalIdentifier(
        transaction,
        entity,
        objectId,
        String(data.legalIdentifier),
      )
      return (await this.resolveEmployeeReferences(
        transaction,
        data,
      )) as unknown as AuxData
    }
    if (entity === 'warehouse') {
      const input = data as unknown as WarehouseCurrentInput
      return {
        name: input.name,
        address: input.address,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        manager: input.managerEmployeeId
          ? await this.currentSnapshot(
              transaction,
              'employee',
              input.managerEmployeeId,
            )
          : null,
        remark: input.remark,
      } satisfies WarehouseCurrentData
    }
    if (entity === 'fund-account') {
      const input = data as unknown as FundAccountCurrentInput
      await this.assertUniqueCurrentField(
        transaction,
        entity,
        objectId,
        'accountNumber',
        input.accountNumber,
        'fund_account_duplicate_account_number',
      )
      return {
        name: input.name,
        currency: input.currency,
        accountName: input.accountName,
        bank: input.bank,
        branch: input.branch,
        accountNumber: input.accountNumber,
        operatingEntity: await this.currentSnapshot(
          transaction,
          'operating-entity',
          input.operatingEntityId,
        ),
        remark: input.remark,
      } satisfies FundAccountCurrentData
    }
    if (entity === 'vehicle') {
      const input = data as unknown as VehicleCurrentInput
      await this.assertUniqueCurrentField(
        transaction,
        entity,
        objectId,
        'plateNumber',
        input.plateNumber,
        'vehicle_duplicate_plate_number',
      )
      if (input.vin)
        await this.assertUniqueCurrentField(
          transaction,
          entity,
          objectId,
          'vin',
          input.vin,
          'vehicle_duplicate_vin',
        )
      const vehicleType = await this.currentSnapshot(
        transaction,
        'dictionary-item',
        input.vehicleTypeId,
      )
      const carrier: VehicleCarrierCurrentData =
        input.carrier.kind === 'INTERNAL'
          ? await this.resolveInternalCarrier(
              transaction,
              input.carrier.operatingEntityId,
            )
          : await resolveExternalCarrier(
              transaction,
              input.carrier.otherUnitId,
              input.carrier.approvalEntryId,
            )
      return {
        name: input.name,
        plateNumber: input.plateNumber,
        vehicleType,
        carrier,
        vin: input.vin,
        engineNumber: input.engineNumber,
        ratedLoadKg: input.ratedLoadKg,
        bulkWaterCarrier: input.bulkWaterCarrier,
        remark: input.remark,
      } satisfies VehicleCurrentData
    }
    if (
      entity === 'product-category' ||
      entity === 'department' ||
      entity === 'income-expense-type'
    ) {
      const parentId = optionalId(data.parentId)
      if (parentId)
        await this.validateParent(
          transaction,
          entity,
          objectId,
          parentId,
          entity === 'income-expense-type' ? String(data.direction) : undefined,
        )
    }
    if (entity === 'dictionary-item') {
      const dictionary = await sql<{
        code: string
        name: string
      }>`SELECT code, COALESCE(data->>'name', '') AS name FROM aux_objects WHERE id = ${String(data.dictionaryTypeId)} AND entity = 'dictionary-type' AND enabled = true FOR SHARE`.execute(
        transaction,
      )
      const row = dictionary.rows[0]
      if (!row) applicationError('validation_failed')
      return {
        ...data,
        dictionaryTypeCode: row.code,
        dictionaryTypeName: row.name,
      }
    }
    if (entity === 'settlement-method' && current) {
      for (const field of [
        'name',
        'termCode',
        'ruleType',
        'monthOffset',
        'dayOfMonth',
        'dayOffset',
      ] as const) {
        if (data[field] !== current[field])
          applicationError('validation_failed')
      }
    }
    if (
      entity === 'product-type' &&
      current &&
      data.behaviorProfile !== current.behaviorProfile
    ) {
      const reference = await sql<{
        exists: boolean
      }>`SELECT EXISTS(SELECT 1 FROM aux_reference_facts WHERE aux_object_id = ${objectId} AND source = 'dcl_product_versions') AS exists`.execute(
        transaction,
      )
      if (reference.rows[0]?.exists) applicationError('validation_failed')
    }
    return data
  }

  private async assertUniqueLegalIdentifier(
    transaction: Transaction<DB>,
    entity: 'operating-entity' | 'employee',
    objectId: string | null,
    legalIdentifier: string,
  ): Promise<void> {
    const duplicate = await sql<{ id: string }>`SELECT id FROM aux_objects
      WHERE entity = ${entity}
        AND data->>'legalIdentifier' = ${legalIdentifier}
        AND (${objectId}::varchar IS NULL OR id <> ${objectId})
      FOR SHARE`.execute(transaction)
    if (duplicate.rows[0])
      applicationError(
        entity === 'operating-entity'
          ? 'operating_entity_duplicate_legal_identifier'
          : 'employee_duplicate_legal_identifier',
      )
  }

  private async assertUniqueCurrentField(
    transaction: Transaction<DB>,
    entity: 'fund-account' | 'vehicle',
    objectId: string | null,
    field: 'accountNumber' | 'plateNumber' | 'vin',
    value: string,
    errorKey:
      | 'fund_account_duplicate_account_number'
      | 'vehicle_duplicate_plate_number'
      | 'vehicle_duplicate_vin',
  ): Promise<void> {
    const duplicate = await sql<{ id: string }>`SELECT id FROM aux_objects
      WHERE entity = ${entity}
        AND data->>${field} = ${value}
        AND (${objectId}::varchar IS NULL OR id <> ${objectId})
      FOR SHARE`.execute(transaction)
    if (duplicate.rows[0]) applicationError(errorKey)
  }

  private async resolveEmployeeReferences(
    transaction: Transaction<DB>,
    source: AuxData,
  ): Promise<EmployeeCurrentData> {
    const input = source as unknown as EmployeeCurrentInput
    const [employeeCategory, department, position, operatingEntity] =
      await Promise.all([
        this.currentSnapshot(
          transaction,
          'employee-category',
          input.employeeCategoryId,
        ),
        this.currentSnapshot(transaction, 'department', input.departmentId),
        this.currentSnapshot(transaction, 'position', input.positionId),
        this.currentSnapshot(
          transaction,
          'operating-entity',
          input.operatingEntityId,
        ),
      ])
    return {
      identityKind: input.identityKind,
      legalName: input.legalName,
      displayName: input.displayName,
      legalIdentifier: input.legalIdentifier,
      contactName: input.contactName,
      phone: input.phone,
      address: input.address,
      employeeCategory,
      department,
      position,
      employmentDate: input.employmentDate,
      workPhone: input.workPhone,
      workEmail: input.workEmail,
      operatingEntity,
      remark: input.remark,
    }
  }

  private async resolveInternalCarrier(
    transaction: Transaction<DB>,
    operatingEntityId: string,
  ): Promise<Extract<VehicleCarrierCurrentData, { kind: 'INTERNAL' }>> {
    const owner = await this.currentSnapshot(
      transaction,
      'operating-entity',
      operatingEntityId,
    )
    return {
      kind: 'INTERNAL',
      operatingEntityId: owner.id,
      code: owner.code,
      name: owner.name,
    }
  }

  private async validateImportedCurrentReferences(
    transaction: Transaction<DB>,
    entity: AuxCurrentEntity,
    data: AuxDataByEntity[AuxCurrentEntity],
  ): Promise<void> {
    if (entity === 'employee') {
      const employee = data as EmployeeCurrentData
      await Promise.all([
        this.assertImportedSnapshot(
          transaction,
          'employee-category',
          employee.employeeCategory,
        ),
        this.assertImportedSnapshot(
          transaction,
          'department',
          employee.department,
        ),
        this.assertImportedSnapshot(transaction, 'position', employee.position),
        this.assertImportedSnapshot(
          transaction,
          'operating-entity',
          employee.operatingEntity,
        ),
      ])
    } else if (entity === 'warehouse') {
      const manager = (data as WarehouseCurrentData).manager
      if (manager)
        await this.assertImportedSnapshot(transaction, 'employee', manager)
    } else if (entity === 'fund-account') {
      await this.assertImportedSnapshot(
        transaction,
        'operating-entity',
        (data as FundAccountCurrentData).operatingEntity,
      )
    } else if (entity === 'vehicle') {
      const vehicle = data as VehicleCurrentData
      await this.assertImportedSnapshot(
        transaction,
        'dictionary-item',
        vehicle.vehicleType,
      )
      if (vehicle.carrier.kind === 'INTERNAL')
        await this.assertImportedSnapshot(transaction, 'operating-entity', {
          id: vehicle.carrier.operatingEntityId,
          code: vehicle.carrier.code,
          name: vehicle.carrier.name,
        })
      else
        await this.assertExternalCarrierExists(
          transaction,
          vehicle.carrier.otherUnitId,
          vehicle.carrier.approvalEntryId,
          vehicle.carrier.code,
        )
    }
  }

  private async assertExternalCarrierExists(
    transaction: Transaction<DB>,
    otherUnitId: string,
    approvalEntryId: string,
    expectedCode: string,
  ): Promise<void> {
    const result = await sql<{ code: string }>`
      SELECT subject.code
      FROM approval_entries entry
      JOIN bob_subjects subject ON subject.id = entry.subject_id
        AND subject.entity = 'other-unit'
      JOIN bob_other_unit_versions version ON version.approval_entry_id = entry.id
      WHERE entry.id = ${approvalEntryId}
        AND entry.subject_id = ${otherUnitId}
        AND entry.domain = 'bob'
        AND entry.entity = 'other-unit'
      FOR SHARE OF entry, subject, version
    `.execute(transaction)
    if (result.rows[0]?.code !== expectedCode)
      applicationError('validation_failed')
  }

  private async assertImportedSnapshot(
    transaction: Transaction<DB>,
    entity:
      | 'employee-category'
      | 'department'
      | 'position'
      | 'operating-entity'
      | 'employee'
      | 'dictionary-item',
    expected: AuxCurrentSnapshot,
  ): Promise<void> {
    const result = await sql<{
      id: string
      code: string
    }>`SELECT id, code FROM aux_objects
      WHERE id = ${expected.id} AND entity = ${entity} FOR SHARE`.execute(
      transaction,
    )
    const actual = result.rows[0]
    if (!actual || actual.code !== expected.code)
      applicationError('validation_failed')
  }

  private async currentSnapshot(
    transaction: Transaction<DB>,
    entity:
      | 'employee-category'
      | 'department'
      | 'position'
      | 'operating-entity'
      | 'employee'
      | 'dictionary-item',
    id: string,
  ): Promise<AuxCurrentSnapshot> {
    const result =
      await sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by
      FROM aux_objects WHERE id = ${id} AND entity = ${entity} AND enabled = true FOR SHARE`.execute(
        transaction,
      )
    const row = result.rows[0]
    if (!row) applicationError('validation_failed')
    const parsed = parseRow(row)
    return { id: parsed.id, code: parsed.code, name: currentName(parsed) }
  }

  private async replaceCurrentReferenceFacts(
    transaction: Transaction<DB>,
    entity: AuxCurrentEntity,
    objectId: string,
    data: AuxDataByEntity[AuxCurrentEntity],
  ): Promise<void> {
    const source = currentReferenceSource(entity, objectId)
    await transaction
      .deleteFrom('aux_reference_facts')
      .where('source', '=', source)
      .execute()
    const references: AuxCurrentSnapshot[] = []
    if (entity === 'employee') {
      const employee = data as EmployeeCurrentData
      references.push(
        employee.employeeCategory,
        employee.department,
        employee.position,
        employee.operatingEntity,
      )
    } else if (entity === 'warehouse') {
      const manager = (data as WarehouseCurrentData).manager
      if (manager) references.push(manager)
    } else if (entity === 'fund-account') {
      references.push((data as FundAccountCurrentData).operatingEntity)
    } else if (entity === 'vehicle') {
      const vehicle = data as VehicleCurrentData
      references.push(vehicle.vehicleType)
      if (vehicle.carrier.kind === 'INTERNAL')
        references.push({
          id: vehicle.carrier.operatingEntityId,
          code: vehicle.carrier.code,
          name: vehicle.carrier.name,
        })
    }
    if (references.length === 0) return
    await transaction
      .insertInto('aux_reference_facts')
      .values(
        references.map((reference) => ({
          id: ulid(),
          aux_object_id: reference.id,
          source,
        })),
      )
      .execute()
  }

  private async recordCurrentAudit(
    transaction: Transaction<DB>,
    entity: AuxCurrentEntity,
    action: 'CREATED' | 'SAVED' | 'DELETED',
    id: string,
    revision: string,
    actor: AuxActor,
    requestId: string | undefined,
  ): Promise<void> {
    await transaction
      .insertInto('app_audit_events')
      .values({
        id: ulid(),
        event_type: `AUX_${entity.replaceAll('-', '_').toUpperCase()}_${action}`,
        actor_user_id: actor.id,
        target_type: entity,
        target_id: id,
        result: 'SUCCESS',
        request_id: requestId ?? null,
        summary: JSON.stringify({
          domain: 'aux',
          entity,
          action,
          revision,
        }),
        created_by: actor.id,
      })
      .execute()
  }

  private async validateParent(
    transaction: Transaction<DB>,
    entity: AuxEntity,
    objectId: string | null,
    parentId: string,
    direction?: string,
  ): Promise<void> {
    if (parentId === objectId) applicationError('validation_failed')
    const parent = await sql<{
      data: unknown
    }>`SELECT data FROM aux_objects WHERE id = ${parentId} AND entity = ${entity} AND enabled = true FOR SHARE`.execute(
      transaction,
    )
    const parentDataValue = parent.rows[0]
    if (
      !parentDataValue ||
      (direction && asRecord(parentDataValue.data).direction !== direction)
    )
      applicationError('validation_failed')
    if (!objectId) return
    const cycle = await sql<{
      cycle: boolean
    }>`WITH RECURSIVE ancestors(id) AS ( SELECT ${parentId}::varchar UNION ALL SELECT NULLIF(parent.data->>'parentId', '') FROM aux_objects parent JOIN ancestors ON parent.id = ancestors.id WHERE parent.entity = ${entity} AND NULLIF(parent.data->>'parentId', '') IS NOT NULL ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = ${objectId}) AS cycle`.execute(
      transaction,
    )
    if (cycle.rows[0]?.cycle) applicationError('validation_failed')
  }
}
