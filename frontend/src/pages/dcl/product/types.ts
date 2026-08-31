import type { components } from '@/api/generated/schema'
import type { BusinessObjectColumn } from '@/components/business-object'
import type { BobEntityConfig, BobForm } from '@/pages/bob/shared/types'

export type DclProductData = components['schemas']['DclProductData']
export type DclProductInput = components['schemas']['DclProductInput']
export type DclProductForm = BobForm
type DclProductListVersion = {
  approval: components['schemas']['ApprovalVersionMeta']
  summary: DclProductData
  enabled: boolean
}
export type DclProductConfig = Omit<BobEntityConfig, 'columns'> & {
  columns: readonly BusinessObjectColumn<DclProductListItem>[]
}
export type DclProductVersionView = components['schemas']['ApprovalVersionMeta'] & {
  summary: DclProductData
}
export type DclProductListItem = Omit<
  components['schemas']['DclProductListItem'],
  'latestApproved' | 'openVersion'
> & {
  latestApproved: DclProductListVersion | null
  openVersion: DclProductListVersion | null
}
export type DclProductView = components['schemas']['DclProductView']
export type DclProductAuditEvent = components['schemas']['ApprovalEventView']

export function dclProductActiveVersion(
  item: Readonly<DclProductListItem>,
): NonNullable<DclProductListItem['openVersion']> {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('产品变更缺少已批准版本和开放候选版本。')
  return version
}
