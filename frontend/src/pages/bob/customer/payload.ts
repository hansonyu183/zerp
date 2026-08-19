import { sortedCostItems } from './form'
import type { components } from '@/api/generated/schema'
import type { CustomerCreateRequest } from './api'
import type {
  CustomerAccountDraft,
  CustomerForm,
  CustomerGroupDraft,
} from './types'

type CustomerAccountPayload = components['schemas']['CustomerAccountInput']

function trimGroup(group: CustomerGroupDraft): CustomerGroupDraft {
  return {
    ...group,
    companyName: group.companyName.trim(),
    shortName: group.shortName.trim(),
    taxNumber: group.taxNumber.trim().toUpperCase(),
    invoiceTitle: group.invoiceTitle.trim(),
    invoiceAddress: group.invoiceAddress.trim(),
    invoicePhone: group.invoicePhone.trim(),
    bankAccounts: group.bankAccounts.map((account) => ({
      bankName: account.bankName.trim(),
      bankBranch: account.bankBranch.trim(),
      accountName: account.accountName.trim(),
      accountNumber: account.accountNumber.trim(),
    })),
  }
}

export function customerAccountPayload(
  account: CustomerAccountDraft,
): CustomerAccountPayload {
  const subject = account.primarySalesAttribution.subject
  return {
    name: account.name.trim(),
    customerTypeCode: account.customerTypeCode,
    shortName: account.shortName.trim(),
    contactName: account.contactName.trim(),
    contactPhone: account.contactPhone.trim(),
    email: account.email.trim(),
    address: account.address.trim(),
    operatingEntityId: account.operatingEntity?.objectId ?? null,
    settlementMethodId: account.settlementMethod?.objectId ?? null,
    paymentMethodId: account.paymentMethod?.objectId ?? null,
    defaultTransportMethodCode:
      account.defaultTransportMethodCode.trim() || null,
    defaultTransportMethodName:
      account.defaultTransportMethodName.trim() || null,
    transportSurcharge: account.transportSurcharge.trim(),
    primarySalesAttribution: {
      type: account.primarySalesAttribution.type,
      subjectObjectId: subject?.objectId ?? '',
    },
    pricingPolicy: {
      ...account.pricingPolicy,
      costItems: sortedCostItems(account.pricingPolicy.costItems).map((item) =>
        item.basis === 'UNIT_PRICE'
          ? {
              name: item.name,
              basis: item.basis,
              unitPrice: item.unitPrice?.trim() ?? '',
            }
          : {
              name: item.name,
              basis: item.basis,
              orderAmount: item.orderAmount?.trim() ?? '',
            },
      ),
    },
    creditLimits: account.creditLimits.map((limit) => ({
      ...limit,
      currency: 'CNY' as const,
      amount: limit.amount.trim(),
    })),
    internalReminder: account.internalReminder.trim(),
    defaultSalesOrderRemark: account.defaultSalesOrderRemark.trim(),
  }
}

export function customerCreatePayload(
  form: CustomerForm,
): CustomerCreateRequest {
  return {
    group: trimGroup(form.group),
    data: customerAccountPayload(form.account),
  }
}
