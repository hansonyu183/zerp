import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type DclEmployeeListItem = components['schemas']['DclEmployeeListItem']
export type DclEmployeeView = components['schemas']['DclEmployeeView']
export type DclEmployeeVersionView =
  components['schemas']['DclEmployeeVersionView']
export type DclEmployeeAuditEvent = components['schemas']['ApprovalEventView']
export type DclEmployeeReferenceOption = BusinessObjectFieldOption<string>

export type DclEmployeeForm = {
  code: string
  partyDisplayName: string
  partyMode: 'EXISTING' | 'NEW'
  partyId: string
  partyKind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  taxNumber: string
  identifierType: 'PERSON_ID' | 'UNIFIED_SOCIAL_CREDIT_CODE'
  identifierValue: string
  operatingEntityId: string
  employeeCategoryId: string
  departmentId: string
  positionId: string
  phone: string
  email: string
  hireDate: string
  remark: string
}

export type DclEmployeeEditContext = {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
}

export type DclEmployeeConfig = {
  title: string
  columns: readonly BusinessObjectColumn<DclEmployeeListItem>[]
  fields: readonly BusinessObjectField<DclEmployeeForm>[]
  filters: readonly {
    key: 'status' | 'enabled'
    label: string
    type: 'select'
    options: readonly BusinessObjectFieldOption[]
    multiple?: boolean
  }[]
  emptyForm: () => DclEmployeeForm
}

export function dclEmployeeActiveVersion(
  item: Readonly<DclEmployeeListItem>,
): DclEmployeeVersionView {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('人员变更缺少已批准版本和开放候选版本。')
  return version
}
