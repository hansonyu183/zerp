/** A stable AUX identity frozen by a current-data consumer at adoption time. */
export interface AuxCurrentSnapshot {
  id: string
  code: string
  name: string
}

/** Current direct-maintenance fields for an operating entity. */
export interface OperatingEntityCurrentInput {
  legalName: string
  shortName: string
  legalIdentifier: string
  registeredAddress: string
  contactName: string
  contactPhone: string
  invoiceTitle: string
  invoiceAddress: string
  invoicePhone: string
  invoiceBank: string
  invoiceAccount: string
  remark: string
}

/** Current operating-entity fields persisted beside its AUX stable identity. */
export type OperatingEntityCurrentData = OperatingEntityCurrentInput

/** Direct-maintenance fields for a warehouse. */
export interface WarehouseCurrentInput {
  name: string
  address: string
  contactName: string
  contactPhone: string
  managerEmployeeId: string | null
  remark: string
}

/** A warehouse keeps the manager label that was current when it was saved. */
export interface WarehouseCurrentData {
  name: string
  address: string
  contactName: string
  contactPhone: string
  manager: AuxCurrentSnapshot | null
  remark: string
}

/** Direct-maintenance fields for a fund account. */
export interface FundAccountCurrentInput {
  name: string
  currency: string
  accountName: string
  bank: string
  branch: string
  accountNumber: string
  operatingEntityId: string
  remark: string
}

/** A fund account freezes its owning operating entity when it is saved. */
export interface FundAccountCurrentData {
  name: string
  currency: string
  accountName: string
  bank: string
  branch: string
  accountNumber: string
  operatingEntity: AuxCurrentSnapshot
  remark: string
}

export type VehicleCarrierCurrentInput =
  | { kind: 'INTERNAL'; operatingEntityId: string }
  | { kind: 'EXTERNAL'; otherUnitId: string; approvalEntryId: string }

/** The current carrier identity and label adopted when the vehicle is saved. */
export type VehicleCarrierCurrentData =
  | {
      kind: 'INTERNAL'
      operatingEntityId: string
      code: string
      name: string
    }
  | {
      kind: 'EXTERNAL'
      otherUnitId: string
      approvalEntryId: string
      code: string
      name: string
    }

/** Direct-maintenance fields for a vehicle. */
export interface VehicleCurrentInput {
  name: string
  plateNumber: string
  vehicleTypeId: string
  carrier: VehicleCarrierCurrentInput
  vin: string
  engineNumber: string
  ratedLoadKg: number
  bulkWaterCarrier: boolean
  remark: string
}

/** Current vehicle fields with all adopted labels frozen by the server. */
export interface VehicleCurrentData {
  name: string
  plateNumber: string
  vehicleType: AuxCurrentSnapshot
  carrier: VehicleCarrierCurrentData
  vin: string
  engineNumber: string
  ratedLoadKg: number
  bulkWaterCarrier: boolean
  remark: string
}

/** Current direct-maintenance input for an employee. References carry IDs only. */
export interface EmployeeCurrentInput {
  identityKind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  legalIdentifier: string
  contactName: string
  phone: string
  address: string
  employeeCategoryId: string
  departmentId: string
  positionId: string
  employmentDate: string
  workPhone: string
  workEmail: string
  operatingEntityId: string
  remark: string
}

/** Current employee fields persist the adopted AUX identities as typed snapshots. */
export interface EmployeeCurrentData {
  identityKind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  legalIdentifier: string
  contactName: string
  phone: string
  address: string
  employeeCategory: AuxCurrentSnapshot
  department: AuxCurrentSnapshot
  position: AuxCurrentSnapshot
  employmentDate: string
  workPhone: string
  workEmail: string
  operatingEntity: AuxCurrentSnapshot
  remark: string
}

export const auxCurrentEntities = [
  'operating-entity',
  'employee',
  'warehouse',
  'fund-account',
  'vehicle',
] as const
export type AuxCurrentEntity = (typeof auxCurrentEntities)[number]
