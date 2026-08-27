import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type DclFundAccountListItem =
  components['schemas']['DclFundAccountListItem']
export type DclFundAccountView = components['schemas']['DclFundAccountView']
export type DclFundAccountVersionView =
  components['schemas']['DclFundAccountVersionView']
export type DclFundAccountAuditEvent =
  components['schemas']['ApprovalEventView']

export type DclFundAccountOperatingEntityOption =
  BusinessObjectFieldOption<string>

export type DclFundAccountForm = {
  code: string
  name: string
  currency: string
  operatingEntityId: string
  accountName: string
  bankName: string
  bankBranch: string
  accountNumber: string
  remark: string
}

export type DclFundAccountEditContext = {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
}

export type DclFundAccountFilter = {
  key: 'status' | 'enabled'
  label: string
  type: 'select'
  options: readonly BusinessObjectFieldOption[]
  multiple?: boolean
}

export type DclFundAccountConfig = {
  title: string
  columns: readonly BusinessObjectColumn<DclFundAccountListItem>[]
  filters: readonly DclFundAccountFilter[]
  fields: readonly BusinessObjectField<DclFundAccountForm>[]
  emptyForm: () => DclFundAccountForm
}

export function dclFundAccountActiveVersion(
  item: Readonly<DclFundAccountListItem>,
): DclFundAccountVersionView {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('资金账户申报缺少已批准版本和开放候选版本。')
  return version
}
