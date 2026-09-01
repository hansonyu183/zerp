import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type { DclDeclarationWireAction } from '../shared/declaration'
import { sortedCostItems } from '../customer-account/form'
import type { CustomerAccountForm } from '../customer-account/types'

export type DclCustomerListItem = components['schemas']['DclCustomerListItem']
export type DclCustomerView = components['schemas']['DclCustomerView']
export type DclCustomerData = components['schemas']['DclCustomerData']
type DclCustomerInput = components['schemas']['DclCustomerInput']

export interface DclCustomerCreateForm {
  kind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  taxNumber: string
  strongIdentifiers: Array<{
    type: 'PERSON_ID' | 'UNIFIED_SOCIAL_CREDIT_CODE' | 'TAX_NUMBER'
    value: string
  }>
  phone: string
  email: string
  address: string
  invoiceTitle: string
  invoiceAddress: string
  invoicePhone: string
  invoiceBankName: string
  invoiceBankAccount: string
  remittanceProfiles: Array<{
    accountName: string
    bankName: string
    accountNumber: string
  }>
  defaultOperatingEntityId: string
  enabled: boolean
  accounts: CustomerAccountForm[]
}

const optional = (value: string): string | null => value.trim() || null

export function dclCustomerAccountPayload(
  form: CustomerAccountForm,
): components['schemas']['DclCustomerAccountInput'] {
  return {
    ...(form.accountId ? { accountId: form.accountId } : {}),
    enabled: form.enabled,
    isDefault: form.isDefault,
    name: form.name.trim(),
    shortName: optional(form.shortName),
    customerTypeId: form.customerTypeId.trim(),
    contactName: optional(form.contactName),
    contactPhone: optional(form.contactPhone),
    email: optional(form.email),
    address: optional(form.address),
    settlementMethodId: optional(form.settlementMethodId),
    paymentMethodId: optional(form.paymentMethodId),
    defaultTransportMethodCode: optional(form.defaultTransportMethodCode),
    defaultTransportMethodName: optional(form.defaultTransportMethodName),
    transportSurcharge: optional(form.transportSurcharge),
    pricingPolicy: {
      defaultPremiumUnitPrice:
        form.pricingPolicy.defaultPremiumUnitPrice.trim(),
      defaultDiscountUnitPrice:
        form.pricingPolicy.defaultDiscountUnitPrice.trim(),
      thirdPartyIntermediaryFixedUnitCost:
        form.pricingPolicy.thirdPartyIntermediaryFixedUnitCost.trim(),
      thirdPartyIntermediaryVariableUnitCost:
        form.pricingPolicy.thirdPartyIntermediaryVariableUnitCost.trim(),
      costItems: sortedCostItems(form.pricingPolicy.costItems).map((item) =>
        item.basis === 'UNIT_PRICE'
          ? {
              name: item.name,
              basis: item.basis,
              unitPrice: item.unitPrice?.trim(),
            }
          : {
              name: item.name,
              basis: item.basis,
              orderAmount: item.orderAmount?.trim(),
            },
      ),
    },
    creditLimits: form.creditLimits
      .filter((limit) => limit.currency.trim() || limit.amount.trim())
      .map((limit) => ({
        currency: limit.currency.trim().toUpperCase(),
        amount: limit.amount.trim(),
      })),
    primarySalesAttribution: {
      type: form.primarySalesAttribution.type,
      subjectObjectId: form.primarySalesAttribution.subjectObjectId.trim(),
    },
    internalReminder: optional(form.internalReminder),
    defaultSalesOrderRemark: optional(form.defaultSalesOrderRemark),
  }
}

export function dclCustomerPayload(
  form: DclCustomerCreateForm,
): DclCustomerInput {
  return {
    kind: form.kind,
    legalName: form.legalName.trim(),
    displayName: optional(form.displayName),
    taxNumber: optional(form.taxNumber),
    strongIdentifiers: form.strongIdentifiers
      .filter((identifier) => identifier.type && identifier.value.trim())
      .map((identifier) => ({
        type: identifier.type,
        value: identifier.value.trim(),
      })),
    phone: optional(form.phone),
    email: optional(form.email),
    address: optional(form.address),
    invoiceTitle: optional(form.invoiceTitle),
    invoiceAddress: optional(form.invoiceAddress),
    invoicePhone: optional(form.invoicePhone),
    invoiceBankName: optional(form.invoiceBankName),
    invoiceBankAccount: optional(form.invoiceBankAccount),
    remittanceProfiles: form.remittanceProfiles
      .filter((profile) => profile.accountName.trim())
      .map((profile) => ({
        accountName: profile.accountName.trim(),
        bankName: optional(profile.bankName),
        accountNumber: optional(profile.accountNumber),
      })),
    defaultOperatingEntityId: form.defaultOperatingEntityId.trim(),
    enabled: form.enabled,
    accounts: form.accounts.map(dclCustomerAccountPayload),
  }
}

export function createDclCustomer(form: DclCustomerCreateForm) {
  return apiClient.postContract('dcl/customer/create', {
    data: dclCustomerPayload(form),
  })
}

export async function queryDclCustomers(request: {
  page: number
  keyword: string
  enabled: boolean | null
}) {
  const { data } = await apiClient.postContract('dcl/customer/query', {
    page: request.page,
    pageSize: 20,
    filters: {
      ...(request.keyword.trim() ? { keyword: request.keyword.trim() } : {}),
      ...(request.enabled === null ? {} : { enabled: request.enabled }),
    },
    sort: [{ field: 'code', order: 'asc' }],
  })
  return data
}

export async function getDclCustomer(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclCustomerView> {
  const { data } = await apiClient.postContract('dcl/customer/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  if (!data) throw new Error('客户变更不存在。')
  return data
}

export function saveDclCustomer(request: {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
  data: DclCustomerInput
}) {
  return apiClient.postContract('dcl/customer/save', request)
}

export async function runDclCustomerAction(
  action: DclDeclarationWireAction,
  request: { objectId: string; approvalEntryId: string; approvalRevision: number },
  reason: string,
): Promise<void> {
  if (action === 'reject' || action === 'unapprove')
    await apiClient.postContract(`dcl/customer/${action}`, { ...request, reason })
  else await apiClient.postContract(`dcl/customer/${action}`, request)
}

export function deleteDclCustomer(row: DclCustomerListItem) {
  const version = row.openVersion ?? row.latestApproved
  if (!version) throw new Error('客户关系没有可删除的版本。')
  return apiClient.postContract('dcl/customer/delete', {
    objectId: row.objectId,
    approvalEntryId: version.approval.approvalEntryId,
    approvalRevision: version.approval.revision,
  })
}

export async function loadDclCustomerVersions(objectId: string) {
  const { data } = await apiClient.postContract('dcl/customer/versions', {
    objectId,
    page: 1,
    pageSize: 20,
  })
  return data
}

export async function loadDclCustomerAudit(objectId: string) {
  const { data } = await apiClient.postContract('dcl/customer/audit-history', {
    objectId,
    page: 1,
    pageSize: 20,
  })
  return data
}

export function customerAccountFormFromData(
  data: DclCustomerData['accounts'][number],
): CustomerAccountForm {
  return {
    accountId: data.accountId,
    enabled: data.enabled,
    isDefault: data.isDefault,
    name: data.name,
    shortName: data.shortName ?? '',
    customerTypeId: data.customerTypeId,
    contactName: data.contactName ?? '',
    contactPhone: data.contactPhone ?? '',
    email: data.email ?? '',
    address: data.address ?? '',
    settlementMethodId: data.settlementMethodId ?? '',
    paymentMethodId: data.paymentMethodId ?? '',
    defaultTransportMethodCode: data.defaultTransportMethodCode ?? '',
    defaultTransportMethodName: data.defaultTransportMethodName ?? '',
    transportSurcharge: data.transportSurcharge ?? '0.00',
    pricingPolicy: {
      ...data.pricingPolicy,
      costItems: data.pricingPolicy.costItems.map((item) => ({ ...item })),
    },
    creditLimits: data.creditLimits.map((limit) => ({ ...limit })),
    primarySalesAttribution: {
      type: data.primarySalesAttribution.type,
      subjectObjectId: data.primarySalesAttribution.subjectObjectId,
    },
    internalReminder: data.internalReminder ?? '',
    defaultSalesOrderRemark: data.defaultSalesOrderRemark ?? '',
  }
}

export function customerFormFromView(
  view: DclCustomerView,
): DclCustomerCreateForm {
  const data = view.data
  return {
    kind: data.kind,
    legalName: data.legalName,
    displayName: data.displayName,
    taxNumber: data.taxNumber ?? '',
    strongIdentifiers: data.strongIdentifiers.map((identifier) => ({
      ...identifier,
    })),
    phone: data.phone ?? '',
    email: data.email ?? '',
    address: data.address ?? '',
    invoiceTitle: data.invoiceTitle ?? '',
    invoiceAddress: data.invoiceAddress ?? '',
    invoicePhone: data.invoicePhone ?? '',
    invoiceBankName: data.invoiceBankName ?? '',
    invoiceBankAccount: data.invoiceBankAccount ?? '',
    remittanceProfiles: data.remittanceProfiles.map((profile) => ({
      accountName: profile.accountName,
      bankName: profile.bankName ?? '',
      accountNumber: profile.accountNumber ?? '',
    })),
    defaultOperatingEntityId: data.defaultOperatingEntityId,
    enabled: data.enabled,
    accounts: data.accounts.map(customerAccountFormFromData),
  }
}
