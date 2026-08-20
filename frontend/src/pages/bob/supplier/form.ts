import type { SupplierForm } from './types'

export function createSupplierForm(): SupplierForm {
  return {
    code: '',
    name: '',
    supplierType: 'GENERAL',
    shortName: '',
    taxNumber: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
    settlementMethod: null,
    defaultPurchaser: null,
  }
}
