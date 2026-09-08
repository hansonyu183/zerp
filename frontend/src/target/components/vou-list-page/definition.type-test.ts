import type { VouColumns, VouFilterFields, VouIdentity } from './definition.ts'
// @ts-expect-error catalog rows cannot replace the independent voucher identity
export type InvalidCatalog = VouColumns<{
  id: string
  code: string
  py: string
  name: string
  enabled: boolean
}>
// @ts-expect-error a keyword filter cannot replace the business date range and document number
export type InvalidFilter = VouFilterFields<{ keyword: string }>
// @ts-expect-error no fake enabled property exists on voucher rows
export const orderColumns: VouColumns<VouIdentity> = [
  { key: 'documentNo', type: 'text', caption: '单号' },
  { key: 'handlerName', type: 'text', caption: '经办人' },
  { key: 'enabled', type: 'boolean', caption: '启用' },
  { key: '$actions', type: 'actions', caption: '操作' },
]
