import { sortedCostItems } from './form'
import type { components } from '@/api/generated/schema'
import type { CustomerAccountDraft, CustomerForm } from './types'

type CustomerAccountPayload = components['schemas']['CustomerAccountInput']

export function customerAccountPayload(account: CustomerAccountDraft): CustomerAccountPayload {
  const subject = account.primarySalesAttribution.subject
  if (!account.operatingEntity || !subject) throw new Error('客户账户的经营主体和业务归属主体不能为空。')
  return {
    name: account.name.trim(), customerTypeCode: account.customerTypeCode,
    shortName: account.shortName.trim() || null, contactName: account.contactName.trim() || null,
    contactPhone: account.contactPhone.trim() || null, email: account.email.trim() || null,
    address: account.address.trim() || null, operatingEntityId: account.operatingEntity.objectId,
    settlementMethodId: account.settlementMethod?.objectId ?? null,
    paymentMethodId: account.paymentMethod?.objectId ?? null,
    defaultTransportMethodCode: account.defaultTransportMethodCode.trim() || null,
    defaultTransportMethodName: account.defaultTransportMethodName.trim() || null,
    transportSurcharge: account.transportSurcharge.trim() || null,
    primarySalesAttribution: { type: account.primarySalesAttribution.type, subjectObjectId: subject.objectId },
    pricingPolicy: {
      ...account.pricingPolicy,
      costItems: sortedCostItems(account.pricingPolicy.costItems).map((item) => item.basis === 'UNIT_PRICE'
        ? { name: item.name, basis: item.basis, unitPrice: item.unitPrice?.trim() ?? '' }
        : { name: item.name, basis: item.basis, orderAmount: item.orderAmount?.trim() ?? '' }),
    },
    creditLimits: account.creditLimits.map((limit) => ({ currency: 'CNY' as const, amount: limit.amount.trim() })),
    internalReminder: account.internalReminder.trim() || null,
    defaultSalesOrderRemark: account.defaultSalesOrderRemark.trim() || null,
  }
}

export function customerCreatePayload(form: CustomerForm): components['schemas']['CustomerCreateRequest'] {
  const data = customerAccountPayload(form.account)
  if (form.party.mode === 'EXISTING') return { partyId: form.party.partyId, data }
  return {
    newParty: {
      kind: form.party.kind, legalName: form.party.legalName.trim(),
      displayName: form.party.displayName.trim() || undefined,
      taxNumber: form.party.taxNumber.trim() || undefined,
      strongIdentifiers: form.party.identifierValue.trim()
        ? [{ type: form.party.identifierType, value: form.party.identifierValue.trim() }]
        : [],
    },
    data,
  }
}
