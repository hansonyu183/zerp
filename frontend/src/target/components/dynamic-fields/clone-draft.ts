import { toRaw } from 'vue'
// Form snapshots contain data only. Unwrap each level because immutable field
// updates can place nested Vue proxies inside an otherwise plain object.
export function cloneDraft<T>(value: T): T {
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(cloneDraft) as T
  if (
    raw &&
    typeof raw === 'object' &&
    Object.getPrototypeOf(raw) === Object.prototype
  )
    return Object.fromEntries(
      Object.entries(raw).map(([key, item]) => [key, cloneDraft(item)]),
    ) as T
  return structuredClone(raw)
}
