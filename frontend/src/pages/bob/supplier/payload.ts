import type { components } from '@/api/generated/schema'
import type { SupplierForm } from './types'

type SupplierInput = components['schemas']['SupplierInput']
type SupplierSaveInput = components['schemas']['SupplierSaveRequest']['data']

function nullable(value: string): string | null {
  return value.trim() || null
}

export function supplierPayload(form: SupplierForm): SupplierInput {
  return {
    operatingEntityId: form.operatingEntity?.objectId ?? '',
    contactName: nullable(form.contactName),
    contactPhone: nullable(form.contactPhone),
    email: nullable(form.email),
    address: nullable(form.address),
    remark: nullable(form.remark),
    settlementMethodId: form.settlementMethod?.objectId ?? null,
    defaultPurchaserEmployeeId: form.defaultPurchaser?.objectId ?? null,
  }
}

export function supplierSavePayload(form: SupplierForm): SupplierSaveInput {
  const data = supplierPayload(form)
  return {
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    email: data.email,
    address: data.address,
    remark: data.remark,
    settlementMethodId: data.settlementMethodId,
    defaultPurchaserEmployeeId: data.defaultPurchaserEmployeeId,
  }
}
