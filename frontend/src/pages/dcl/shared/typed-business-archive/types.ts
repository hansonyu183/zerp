import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'
export type DclTypedArchiveEntity = 'other-unit' | 'sales-partner'
export type DclTypedArchiveListItem =
  | components['schemas']['DclOtherUnitListItem']
  | components['schemas']['DclSalesPartnerListItem']
export type DclTypedArchiveView =
  | components['schemas']['DclOtherUnitView']
  | components['schemas']['DclSalesPartnerView']
export type DclTypedArchiveVersionView =
  | components['schemas']['DclOtherUnitVersionView']
  | components['schemas']['DclSalesPartnerVersionView']
export type DclTypedArchiveAuditEvent =
  components['schemas']['ApprovalEventView']
export type DclTypedArchiveReferenceOption = BusinessObjectFieldOption<string>
export type SalesPartnerCapability =
  components['schemas']['SalesPartnerCapability']
export type DclTypedArchiveForm = {
  code: string
  kind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  taxNumber: string
  strongIdentifiers: components['schemas']['BusinessIdentifier'][]
  enabled: boolean
  operatingEntityIds: string[]
  defaultOperatingEntityId: string
  contactName: string
  contactPhone: string
  email: string
  address: string
  settlementMethodId: string
  capabilities: SalesPartnerCapability[]
  remark: string
}
export type DclTypedArchiveEditContext = {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
}
export type DclTypedArchiveConfig = {
  columns: readonly BusinessObjectColumn<DclTypedArchiveListItem>[]
  fields: readonly BusinessObjectField<DclTypedArchiveForm>[]
  filters: readonly {
    key: 'status' | 'enabled'
    label: string
    type: 'select'
    options: readonly BusinessObjectFieldOption[]
    multiple?: boolean
  }[]
  emptyForm: () => DclTypedArchiveForm
}
export function dclTypedArchiveActiveVersion(
  item: Readonly<DclTypedArchiveListItem>,
): DclTypedArchiveVersionView {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('业务档案变更缺少已批准版本和开放候选版本。')
  return version
}
