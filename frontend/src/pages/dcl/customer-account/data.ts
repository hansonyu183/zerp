import type { components } from '@/api/generated/schema'
import { apiClient } from '@/api/client'
import type { DclDeclarationWireAction } from '../shared/declaration'
import { sortedCostItems } from './form'
import type { CustomerAccountForm } from './types'
import type {
  DclCustomerAccountListItem,
  DclCustomerAccountView,
} from './types'

type AccountInput = components['schemas']['DclCustomerAccountInput']

const optional = (value: string): string | null => value.trim() || null

export function dclCustomerAccountPayload(
  form: CustomerAccountForm,
): AccountInput {
  return {
    name: form.name.trim(),
    shortName: optional(form.shortName),
    customerTypeCode: form.customerTypeCode.trim(),
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
    creditLimits: form.creditLimitAmount.trim()
      ? [{ currency: 'CNY', amount: form.creditLimitAmount.trim() }]
      : [],
    primarySalesAttribution: {
      type: form.primarySalesAttribution.type,
      subjectObjectId: form.primarySalesAttribution.subjectObjectId.trim(),
    },
    internalReminder: optional(form.internalReminder),
    defaultSalesOrderRemark: optional(form.defaultSalesOrderRemark),
  }
}

export function createDclCustomerAccount(
  customerRelationshipId: string,
  form: CustomerAccountForm,
) {
  return apiClient.postContract('dcl/customer-account/create', {
    customerRelationshipId,
    data: dclCustomerAccountPayload(form),
  })
}

export async function queryDclCustomerAccounts(request: {
  page: number
  keyword: string
  enabled: boolean | null
  customerRelationshipId: string
}) {
  const { data } = await apiClient.postContract('dcl/customer-account/query', {
    page: request.page,
    pageSize: 20,
    filters: {
      ...(request.keyword.trim() ? { keyword: request.keyword.trim() } : {}),
      ...(request.enabled === null ? {} : { enabled: request.enabled }),
      ...(request.customerRelationshipId.trim()
        ? { customerRelationshipId: request.customerRelationshipId.trim() }
        : {}),
    },
    sort: [{ field: 'code', order: 'asc' }],
  })
  return data
}

export async function getDclCustomerAccount(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclCustomerAccountView> {
  const { data } = await apiClient.postContract('dcl/customer-account/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  if (!data) throw new Error('客户结算子账户申报不存在。')
  return data
}

export function customerAccountFormFromView(
  view: DclCustomerAccountView,
): CustomerAccountForm {
  const data = view.data
  return {
    name: data.name,
    shortName: data.shortName ?? '',
    customerTypeCode: data.customerTypeCode,
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
    creditLimitAmount: data.creditLimits[0]?.amount ?? '',
    primarySalesAttribution: {
      type: data.primarySalesAttribution.type,
      subjectObjectId: data.primarySalesAttribution.subjectObjectId,
    },
    internalReminder: data.internalReminder ?? '',
    defaultSalesOrderRemark: data.defaultSalesOrderRemark ?? '',
  }
}

export function saveDclCustomerAccount(
  request: Omit<components['schemas']['DclCustomerAccountSaveRequest'], 'data'>,
  form: CustomerAccountForm,
) {
  return apiClient.postContract('dcl/customer-account/save', {
    ...request,
    data: dclCustomerAccountPayload(form),
  })
}

export async function runDclCustomerAccountAction(
  action: DclDeclarationWireAction,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
  },
  reason: string,
): Promise<void> {
  if (action === 'reject' || action === 'unapprove')
    await apiClient.postContract(`dcl/customer-account/${action}`, {
      ...request,
      reason,
    })
  else await apiClient.postContract(`dcl/customer-account/${action}`, request)
}

export function deleteDclCustomerAccount(row: DclCustomerAccountListItem) {
  const version = row.openVersion ?? row.latestApproved
  if (!version) throw new Error('客户结算子账户没有可删除的版本。')
  return apiClient.postContract('dcl/customer-account/delete', {
    objectId: row.objectId,
    approvalEntryId: version.approval.approvalEntryId,
    approvalRevision: version.approval.revision,
  })
}

export async function loadDclCustomerAccountVersions(objectId: string) {
  const { data } = await apiClient.postContract(
    'dcl/customer-account/versions',
    { objectId, page: 1, pageSize: 20 },
  )
  return data
}

export async function loadDclCustomerAccountAudit(objectId: string) {
  const { data } = await apiClient.postContract(
    'dcl/customer-account/audit-history',
    { objectId, page: 1, pageSize: 20 },
  )
  return data
}
