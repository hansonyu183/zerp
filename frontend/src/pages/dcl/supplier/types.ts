import type { BusinessObjectColumn, BusinessObjectField, BusinessObjectFieldOption } from '@/components/business-object'
import type { components } from '@/api/generated/schema'
export type DclSupplierListItem = components['schemas']['DclSupplierListItem']
export type DclSupplierView = components['schemas']['DclSupplierView']
export type DclSupplierVersionView = components['schemas']['DclSupplierVersionView']
export type DclSupplierAuditEvent = components['schemas']['ApprovalEventView']
export type DclSupplierReferenceOption = BusinessObjectFieldOption<string>
export type DclSupplierForm = { code: string; kind: 'PERSON' | 'ORGANIZATION'; legalName: string; displayName: string; taxNumber: string; strongIdentifiers: components['schemas']['BusinessIdentifier'][]; enabled: boolean; operatingEntityIds: string[]; defaultOperatingEntityId: string; shortName: string; contactName: string; contactPhone: string; email: string; address: string; remark: string; settlementMethodId: string; defaultPurchaserEmployeeId: string }
export type DclSupplierEditContext = { objectId: string; approvalEntryId: string; approvalRevision: number }
export type DclSupplierConfig = { columns: readonly BusinessObjectColumn<DclSupplierListItem>[]; fields: readonly BusinessObjectField<DclSupplierForm>[]; filters: readonly { key: 'status' | 'enabled'; label: string; type: 'select'; options: readonly BusinessObjectFieldOption[]; multiple?: boolean }[]; emptyForm: () => DclSupplierForm }
export function dclSupplierActiveVersion(item: Readonly<DclSupplierListItem>): DclSupplierVersionView { const version = item.openVersion ?? item.latestApproved; if (!version) throw new Error('供应商变更缺少已批准版本和开放候选版本。'); return version }
