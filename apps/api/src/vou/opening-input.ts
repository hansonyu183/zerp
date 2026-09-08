import { createHash } from 'node:crypto'
import type { AccOpeningInput } from '../acc/service.ts'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** Also used by the one-time conversion to retain the historical submission intent. */
export function openingRequestHash(
  input: AccOpeningInput,
  actorId: string,
): string {
  return createHash('sha256')
    .update(canonical({ input, actorId }))
    .digest('hex')
}
