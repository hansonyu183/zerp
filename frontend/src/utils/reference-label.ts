export interface ReferenceLabel {
  code?: unknown
  name?: unknown
}

export function formatReferenceLabel(reference: ReferenceLabel): string {
  const code = String(reference.code ?? '').trim()
  const name = String(reference.name ?? '').trim()

  if (code && name) return `${code} · ${name}`
  return code || name
}
