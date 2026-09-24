import { normalizeCustomerData } from '@zerp/model'
import type { TargetCustomerSubmitInput } from '../../api.ts'
export type CustomerSnapshot = TargetCustomerSubmitInput['snapshot']
export const customerAttributionLabels = {
  INTERNAL_EMPLOYEE: '内部员工',
  EXTERNAL_PART_TIME: '外部兼职销售',
  CHANNEL_PARTNER: '渠道商',
} as const
export const customerCostBasisLabels = {
  UNIT_PRICE: '按单价',
  ORDER_AMOUNT: '按订单金额',
} as const
export const attributionOptions = Object.entries(customerAttributionLabels).map(
  ([value, title]) => ({ value, title }),
)
export const costBasisOptions = Object.entries(customerCostBasisLabels).map(
  ([value, title]) => ({ value, title }),
)
export const customerTextFields = [
  { key: 'displayName', label: '客户名称' },
  { key: 'phone', label: '联系电话' },
  { key: 'email', label: '邮箱' },
] as const
export function emptyCustomer(): CustomerSnapshot {
  return {
    displayName: '',
    phone: '',
    email: '',
    contactName: '',
    address: '',
    defaultOperatingEntity: null,
    remittanceProfiles: [],
    taxInformation: [],
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
    primarySalesAttribution: null,
    internalReminder: '',
    defaultSalesOrderRemark: '',
    attachments: [],
  }
}
export function cloneCustomer(snapshot: CustomerSnapshot): CustomerSnapshot {
  return { ...structuredClone(snapshot), attachments: [] }
}
export function validateCustomer(snapshot: CustomerSnapshot): string | null {
  if (normalizeCustomerData(snapshot)) return null
  if (!snapshot.displayName.trim()) return '请填写客户名称。'
  const invalidPayer = snapshot.remittanceProfiles.findIndex(
    (item) => !item.payerName.trim(),
  )
  if (invalidPayer >= 0)
    return `汇款识别第 ${invalidPayer + 1} 行：请填写付款户名。`
  if (!snapshot.customerType.id) return '请选择客户类型。'
  if (
    snapshot.primarySalesAttribution !== null &&
    !snapshot.primarySalesAttribution.objectId
  )
    return '请选择主要业务归属。'
  return '客户资料不完整，请检查业务归属、金额、汇款识别与附件。'
}
