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

export const auxCurrentEntities = ['operating-entity', 'employee'] as const
export type AuxCurrentEntity = (typeof auxCurrentEntities)[number]
