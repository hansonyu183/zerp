import { statusText } from '../shared/config-helpers'
import type { BobStatus } from '../shared/types'

export function employeeStatusLabel(value: unknown): string {
  return typeof value === 'string' && Object.hasOwn(statusText, value)
    ? statusText[value as BobStatus]
    : '未知状态'
}
