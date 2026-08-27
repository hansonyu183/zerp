import type { components } from '@/api/generated/schema'
import type {
  BobAuditEvent,
  BobEntityConfig,
  BobForm,
  BobListItem,
  BobObjectView,
  BobVersionHistoryItem,
} from '@/pages/bob/shared/types'

export type DclProductData = components['schemas']['DclProductData']
export type DclProductInput = components['schemas']['DclProductInput']
export type DclProductForm = BobForm
export type DclProductConfig = BobEntityConfig
export type DclProductVersionView = BobVersionHistoryItem
export type DclProductListItem = BobListItem
export type DclProductView = BobObjectView
export type DclProductAuditEvent = BobAuditEvent

export function dclProductActiveVersion(
  item: Readonly<DclProductListItem>,
): NonNullable<DclProductListItem['openVersion']> {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('产品申报缺少已批准版本和开放候选版本。')
  return version
}
