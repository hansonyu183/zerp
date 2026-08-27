import { productFormFields, productPayload } from './product-data'
import type { BobEntityConfig, BobForm, BobObjectView } from './types'

export function hasValue(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === '' ||
    value === false ||
    (Array.isArray(value) && value.length === 0)
  )
}

export function normalizeBobForm(
  config: BobEntityConfig,
  form: BobForm,
): BobForm {
  const uppercase = new Set(config.uppercaseKeys ?? [])
  const normalized: BobForm = { ...form }
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    normalized[key] = uppercase.has(key) ? trimmed.toUpperCase() : trimmed
  }
  if (config.entity === 'fund-account') {
    const accountNumber = normalized.accountNumber
    if (typeof accountNumber === 'string') {
      normalized.accountNumber = accountNumber
        .replace(/[\s-]+/g, '')
        .toUpperCase()
    }
  }
  return normalized
}

export function bobCreateData(config: BobEntityConfig, form: BobForm) {
  const normalized = normalizeBobForm(config, form)
  const data: Record<string, unknown> = {}
  for (const key of config.persistedKeys ?? config.detailKeys) {
    const value = normalized[key]
    if (
      !config.requiredKeys.includes(key) &&
      (value === '' || value === null)
    ) {
      continue
    }
    data[key] = value
  }
  if (config.entity === 'product') {
    Object.assign(data, productPayload(normalized))
    delete data.behaviorProfile
  }
  if (config.entity === 'vehicle') {
    data.carrierAffiliation = vehicleCarrierAffiliation(normalized)
  }
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) delete data[key]
  }
  return { ...data, name: normalized.name }
}

export function bobSaveData(config: BobEntityConfig, form: BobForm) {
  const normalized = normalizeBobForm(config, form)
  const data = Object.fromEntries(
    (config.persistedKeys ?? config.detailKeys).map((key) => [
      key,
      normalized[key],
    ]),
  )
  if (config.entity === 'product') {
    Object.assign(data, productPayload(normalized))
    if (normalized.formulaDirty !== true) delete data.formula
    delete data.behaviorProfile
  }
  if (config.entity === 'vehicle') {
    data.carrierAffiliation = vehicleCarrierAffiliation(normalized)
  }
  return data
}

export function bobFormFromView(
  config: BobEntityConfig,
  view: BobObjectView,
): BobForm {
  const form = config.emptyForm()
  form.code = view.code
  form.objectId = view.objectId
  form.approvalEntryId = view.approval.approvalEntryId
  const detail = Object.fromEntries(Object.entries(view.data))
  for (const key of config.detailKeys) {
    form[key] = detail[key] ?? form[key] ?? ''
  }
  if (config.entity === 'product') {
    Object.assign(form, productFormFields(view.data))
    form.formulaDirty = false
  }
  if (config.entity === 'vehicle') {
    const affiliation = view.data.carrierAffiliation as
      | {
          type?: unknown
          operatingEntityId?: unknown
          serviceRelationshipObjectId?: unknown
        }
      | undefined
    form.carrierType =
      typeof affiliation?.type === 'string' ? affiliation.type : ''
    form.carrierOperatingEntityId =
      typeof affiliation?.operatingEntityId === 'string'
        ? affiliation.operatingEntityId
        : ''
    form.carrierServiceRelationshipObjectId =
      typeof affiliation?.serviceRelationshipObjectId === 'string'
        ? affiliation.serviceRelationshipObjectId
        : ''
  }
  return form
}

function vehicleCarrierAffiliation(form: BobForm): Record<string, unknown> {
  if (form.carrierType === 'INTERNAL') {
    return {
      type: 'INTERNAL',
      operatingEntityId: form.carrierOperatingEntityId,
    }
  }
  return {
    type: 'EXTERNAL',
    serviceRelationshipObjectId: form.carrierServiceRelationshipObjectId,
  }
}
