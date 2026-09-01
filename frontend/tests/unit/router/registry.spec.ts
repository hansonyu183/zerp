import { describe, expect, it } from 'vitest'
import { hasRegisteredPage, pageRegistry } from '@/router/registry'

describe('customer route registry', () => {
  it('registers only the customer pages, not standalone customer-account pages', () => {
    expect(pageRegistry['dcl/customer']?.entityTitle).toBe('客户变更')
    expect(pageRegistry['bob/customer']?.entityTitle).toBe('客户')
    expect(hasRegisteredPage('dcl', 'customer')).toBe(true)
    expect(hasRegisteredPage('bob', 'customer')).toBe(true)
    expect(hasRegisteredPage('dcl', 'customer-account')).toBe(false)
    expect(hasRegisteredPage('bob', 'customer-account')).toBe(false)
  })
})
