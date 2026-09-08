import { ulid } from 'ulid'
import { normalizeCustomerData } from '@zerp/model'
import type { TargetCustomerSubmitInput } from '../../api.ts'
export type CustomerSnapshot = TargetCustomerSubmitInput['snapshot']
export const customerIdentityLabels = {
  MAINLAND_ENTERPRISE: '大陆企业',
  MAINLAND_INDIVIDUAL: '大陆自然人',
  OTHER: '其他',
} as const
export const customerAttributionLabels = {
  INTERNAL_EMPLOYEE: '内部员工',
  EXTERNAL_PART_TIME: '外部兼职销售',
  CHANNEL_PARTNER: '渠道商',
} as const
export const customerCostBasisLabels = {
  UNIT_PRICE: '按单价',
  ORDER_AMOUNT: '按订单金额',
} as const
export const identityOptions = Object.entries(customerIdentityLabels).map(
  ([value, title]) => ({ value, title }),
)
export const attributionOptions = Object.entries(customerAttributionLabels).map(
  ([value, title]) => ({ value, title }),
)
export const costBasisOptions = Object.entries(customerCostBasisLabels).map(
  ([value, title]) => ({ value, title }),
)
export const customerTextFields = [
  { key: 'legalName', label: '法定名称' },
  { key: 'displayName', label: '显示名称' },
  { key: 'legalIdentifier', label: '法定识别号' },
  { key: 'phone', label: '联系电话' },
  { key: 'email', label: '邮箱' },
  { key: 'address', label: '地址' },
  { key: 'invoiceTitle', label: '开票抬头' },
  { key: 'invoiceAddress', label: '开票地址' },
  { key: 'invoicePhone', label: '开票电话' },
  { key: 'invoiceBank', label: '开票开户行' },
  { key: 'invoiceAccount', label: '开票账号' },
] as const
export function newCustomerSubunit(): CustomerSnapshot['subunits'][number] {
  return {
    intent: 'NEW',
    id: ulid(),
    code: null,
    name: '',
    contactName: '',
    address: '',
    customerType: { id: '', code: '', name: '' },
    settlementMethod: null,
    paymentMethod: null,
    transportPolicy: {
      methodCode: 'DELIVERY',
      methodName: '送货',
      surcharge: '0.00',
    },
    pricingPolicy: {
      defaultPremiumUnitPrice: '0.00',
      defaultDiscountUnitPrice: '0.00',
      costItems: [],
      thirdPartyIntermediaryFixedUnitCost: '0.00',
      thirdPartyIntermediaryVariableUnitCost: '0.00',
    },
    creditLimits: [],
    primarySalesAttribution: {
      type: 'INTERNAL_EMPLOYEE',
      objectId: '',
      code: '',
      name: '',
    },
    internalReminder: '',
    defaultSalesOrderRemark: '',
    attachments: [],
    enabled: true,
  }
}
export function emptyCustomer(): CustomerSnapshot {
  return {
    identityKind: 'MAINLAND_ENTERPRISE',
    legalName: '',
    displayName: '',
    legalIdentifier: '',
    phone: '',
    email: '',
    address: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remittanceProfiles: [],
    defaultOperatingEntity: null,
    identityAttachments: [],
    subunits: [newCustomerSubunit()],
  }
}
export function cloneCustomer(snapshot: CustomerSnapshot): CustomerSnapshot {
  const copy = structuredClone(snapshot)
  copy.identityAttachments = []
  copy.subunits = copy.subunits.map((item) => ({
    ...item,
    intent: 'NEW',
    id: ulid(),
    code: null,
    attachments: [],
  }))
  return copy
}

export function validateCustomer(snapshot: CustomerSnapshot): string | null {
  if (normalizeCustomerData(snapshot)) return null
  if (!snapshot.legalName.trim() || !snapshot.displayName.trim())
    return '请填写客户法定名称和显示名称。'
  for (const [i, profile] of snapshot.remittanceProfiles.entries())
    if (!profile.payerName.trim())
      return `汇款识别第 ${i + 1} 行：请填写付款户名。`
  for (const [i, sub] of snapshot.subunits.entries()) {
    if (!sub.name.trim()) return `客户子单位第 ${i + 1} 行：请填写子单位名称。`
    if (!sub.customerType.id)
      return `客户子单位第 ${i + 1} 行：请选择客户类型。`
    if (!sub.primarySalesAttribution.objectId)
      return `客户子单位第 ${i + 1} 行：请选择主要业务归属。`
    for (const [j, limit] of sub.creditLimits.entries())
      if (
        !/^[A-Z]{3}$/.test(limit.currency) ||
        !/^\d+(?:\.\d{1,2})?$/.test(limit.amount)
      )
        return `客户子单位第 ${i + 1} 行，信用额度第 ${j + 1} 行：请检查币种与金额。`
    if (
      !normalizeCustomerData({
        ...snapshot,
        remittanceProfiles: [],
        subunits: [sub],
      })
    )
      return `客户子单位第 ${i + 1} 行：请检查身份、业务归属、金额与附件。`
  }
  return '客户资料不完整，请检查身份、识别号与子单位资料。'
}
