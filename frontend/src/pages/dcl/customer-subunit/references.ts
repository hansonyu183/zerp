import { apiClient } from '@/api/client'
import type { CustomerSalesAttributionType } from './types'

export interface CustomerReferenceOption {
  value: string
  title: string
}

export type CustomerSubunitReferenceKey =
  | 'customerTypeId'
  | 'settlementMethodId'
  | 'paymentMethodId'
  | 'primarySalesAttributionSubjectObjectId'

export async function queryOperatingEntityReferences(
  keyword: string,
): Promise<CustomerReferenceOption[]> {
  const { data } = await apiClient.postContract('bob/operating-entity/query', {
    page: 1,
    pageSize: 20,
    filters: {
      enabled: true,
      ...(keyword ? { keyword } : {}),
    },
    sort: [{ field: 'code', order: 'asc' }],
  })
  return data.items.map((item) => ({
    value: item.objectId,
    title: `${item.code} · ${item.data.name}`,
  }))
}

export async function queryCustomerSubunitReference(
  key: CustomerSubunitReferenceKey,
  keyword: string,
  salesAttributionType: CustomerSalesAttributionType,
): Promise<CustomerReferenceOption[]> {
  if (key === 'customerTypeId') {
    const { data } = await apiClient.postContract('aux/reference/query', {
      entity: 'dictionary-item',
      dictionaryTypeCode: 'DCT-0001',
      ...(keyword ? { keyword } : {}),
    })
    return data.map((item) => ({
      value: item.objectId,
      title: `${item.code} · ${item.name}`,
    }))
  }
  if (key === 'settlementMethodId' || key === 'paymentMethodId') {
    const { data } = await apiClient.postContract('aux/reference/query', {
      entity:
        key === 'settlementMethodId' ? 'settlement-method' : 'payment-method',
      ...(keyword ? { keyword } : {}),
    })
    return data.map((item) => ({
      value: item.objectId,
      title: `${item.code} · ${item.name}`,
    }))
  }
  const { data } = await apiClient.postContract('bob/reference/query', {
    entity:
      salesAttributionType === 'INTERNAL_EMPLOYEE'
        ? 'employee'
        : 'sales-partner',
    ...(keyword ? { keyword } : {}),
  })
  return data.map((item) => ({
    value: item.objectId,
    title: `${item.code} · ${item.name}`,
  }))
}
