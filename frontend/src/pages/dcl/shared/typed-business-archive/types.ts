import type { BusinessObjectColumn, BusinessObjectField, BusinessObjectFieldOption } from '@/components/business-object'
import type { components } from '@/api/generated/schema'
export type DclRelationshipEntity = 'other-unit' | 'sales-partner'
export type DclRelationshipListItem = components['schemas']['DclOtherUnitListItem'] | components['schemas']['DclSalesPartnerListItem']
export type DclRelationshipView = components['schemas']['DclOtherUnitView'] | components['schemas']['DclSalesPartnerView']
export type DclRelationshipVersionView = components['schemas']['DclOtherUnitVersionView'] | components['schemas']['DclSalesPartnerVersionView']
export type DclRelationshipAuditEvent = components['schemas']['ApprovalEventView']
export type DclRelationshipReferenceOption = BusinessObjectFieldOption<string>
export type SalesPartnerCapability = components['schemas']['SalesPartnerCapability']
export type DclRelationshipForm = { code: string; kind: 'PERSON' | 'ORGANIZATION'; legalName: string; displayName: string; taxNumber: string; strongIdentifiers: components['schemas']['BusinessIdentifier'][]; enabled: boolean; operatingEntityIds: string[]; defaultOperatingEntityId: string; contactName: string; contactPhone: string; email: string; address: string; settlementMethodId: string; capabilities: SalesPartnerCapability[]; remark: string }
export type DclRelationshipEditContext = { objectId: string; approvalEntryId: string; approvalRevision: number }
export type DclRelationshipConfig = { columns: readonly BusinessObjectColumn<DclRelationshipListItem>[]; fields: readonly BusinessObjectField<DclRelationshipForm>[]; filters: readonly { key: 'status' | 'enabled'; label: string; type: 'select'; options: readonly BusinessObjectFieldOption[]; multiple?: boolean }[]; emptyForm: () => DclRelationshipForm }
export function dclRelationshipActiveVersion(item: Readonly<DclRelationshipListItem>): DclRelationshipVersionView { const version = item.openVersion ?? item.latestApproved; if (!version) throw new Error('业务档案变更缺少已批准版本和开放候选版本。'); return version }
