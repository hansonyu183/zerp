import { apiClient } from '@/api/client'
import type { DclDeclarationWireAction } from '../shared/declaration'
import { dclCustomerAccountPayload } from '../customer-account/data'
import type { CustomerAccountForm } from '../customer-account/types'
import type { components } from '@/api/generated/schema'

export type DclCustomerListItem = components['schemas']['DclCustomerListItem']
export type DclCustomerView = components['schemas']['DclCustomerView']

export interface DclCustomerCreateForm {
  partyMode: 'EXISTING' | 'NEW'
  partyId: string
  partyKind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  taxNumber: string
  identifierType: 'PERSON_ID' | 'UNIFIED_SOCIAL_CREDIT_CODE'
  identifierValue: string
  operatingEntityId: string
  defaultAccount: CustomerAccountForm
}

export function createDclCustomer(form: DclCustomerCreateForm) {
  const party =
    form.partyMode === 'EXISTING'
      ? { partyId: form.partyId.trim() }
      : {
          newParty: {
            kind: form.partyKind,
            legalName: form.legalName.trim(),
            ...(form.displayName.trim()
              ? { displayName: form.displayName.trim() }
              : {}),
            ...(form.taxNumber.trim()
              ? { taxNumber: form.taxNumber.trim() }
              : {}),
            strongIdentifiers: form.identifierValue.trim()
              ? [
                  {
                    type: form.identifierType,
                    value: form.identifierValue.trim(),
                  },
                ]
              : [],
          },
        }
  return apiClient.postContract('dcl/customer/create', {
    ...party,
    operatingEntityId: form.operatingEntityId.trim(),
    defaultAccount: dclCustomerAccountPayload(form.defaultAccount),
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
  enabled: boolean
}) {
  return apiClient.postContract('dcl/customer/save', request)
}

export async function runDclCustomerAction(
  action: DclDeclarationWireAction,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
  },
  reason: string,
): Promise<void> {
  if (action === 'reject' || action === 'unapprove')
    await apiClient.postContract(`dcl/customer/${action}`, {
      ...request,
      reason,
    })
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
