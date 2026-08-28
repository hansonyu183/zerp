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

export function bobFormFromView(
  config: BobEntityConfig,
  view: BobObjectView,
): BobForm {
  const form = config.emptyForm()
  form.code = view.code
  form.objectId = view.objectId
  form.sourceApprovalEntryId = view.sourceApprovalEntryId
  form.sourceVersionNo = view.sourceVersionNo
  const detail = Object.fromEntries(Object.entries(view.data))
  for (const key of config.detailKeys) {
    form[key] = detail[key] ?? form[key] ?? ''
  }
  return form
}
