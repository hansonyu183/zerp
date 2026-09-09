import type { SupplierData, SalesPartnerData } from '@zerp/model'
export const identityKindLabels = {
  PERSON: '个人',
  ORGANIZATION: '组织',
} satisfies Record<SupplierData['identityKind'], string>
export const identityKindOptions = Object.entries(identityKindLabels).map(
  ([value, caption]) => ({ value, caption }),
)
export const salesPartnerCapabilityLabels = {
  EXTERNAL_PART_TIME: '外部兼职销售',
  CHANNEL_PARTNER: '渠道商',
} satisfies Record<SalesPartnerData['capabilities'][number], string>
export const salesPartnerCapabilityOptions = Object.entries(
  salesPartnerCapabilityLabels,
).map(([value, caption]) => ({ value, caption }))
