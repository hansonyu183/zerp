import {
  productFormFields,
  productPayload,
} from './product-data'
import type { BobEntityConfig, BobForm, BobObjectView } from './types'

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

export function bobCreateData(
  config: BobEntityConfig,
  form: BobForm,
): Record<string, unknown> {
  const normalized = normalizeBobForm(config, form)
  const data: Record<string, unknown> = {}
  for (const key of config.detailKeys) {
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
  }
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) delete data[key]
  }
  return data
}

export function bobSaveData(
  config: BobEntityConfig,
  form: BobForm,
): Record<string, unknown> {
  const normalized = normalizeBobForm(config, form)
  const data = Object.fromEntries(
    config.detailKeys.map((key) => [key, normalized[key]]),
  )
  if (config.entity === 'product') {
    Object.assign(data, productPayload(normalized))
  }
  return data
}

export function bobFormFromView(
  config: BobEntityConfig,
  view: BobObjectView,
): BobForm {
  const form = config.emptyForm()
  form.code = view.code
  for (const key of config.detailKeys) {
    form[key] = view.data[key] ?? form[key] ?? ''
  }
  if (config.entity === 'product') {
    Object.assign(form, productFormFields(view.data))
  }
  return form
}
