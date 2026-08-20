import type { components } from '@/api/generated/schema'
import type { SupplierForm } from './types'

type SupplierInput = components['schemas']['SupplierInput']

function nullable(value: string): string | null {
  return value.trim() || null
}

export function supplierPayload(form: SupplierForm): SupplierInput {
  return {
    name: form.name.trim(),
    supplierType: form.supplierType,
    shortName: nullable(form.shortName),
    taxNumber: form.taxNumber.trim().toUpperCase() || null,
    contactName: nullable(form.contactName),
    contactPhone: nullable(form.contactPhone),
    email: nullable(form.email),
    address: nullable(form.address),
    remark: nullable(form.remark),
    settlementMethodId: form.settlementMethod?.objectId ?? null,
    defaultPurchaserEmployeeId: form.defaultPurchaser?.objectId ?? null,
  }
}
