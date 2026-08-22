import type { SupplierForm } from './types'

export function createSupplierForm(): SupplierForm {
  return {
    code: '',
    name: '',
    partyMode: 'new',
    selectedParty: null,
    partyKind: 'ORGANIZATION',
    taxNumber: '',
    identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
    identifierValue: '',
    operatingEntity: null,
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
    settlementMethod: null,
    defaultPurchaser: null,
  }
}
