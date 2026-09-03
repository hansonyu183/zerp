import type { MiddlewareHandler } from 'hono'
import { ulid } from 'ulid'

const requestIdHeader = 'X-Request-ID'

function isValidRequestId(value: string): boolean {
  if (value.length === 0 || value.length > 128) return false
  return /^[\x21-\x7e]+$/.test(value)
}

export const requestId: MiddlewareHandler = async (context, next) => {
  const supplied = context.req.header(requestIdHeader)?.trim() ?? ''
  const value = isValidRequestId(supplied) ? supplied : ulid()

  context.set('requestId', value)
  context.header(requestIdHeader, value)
  await next()
}

export function currentRequestId(context: {
  get(key: 'requestId'): string
}): string {
  return context.get('requestId')
}
