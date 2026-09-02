import { describe, expect, it } from 'vitest'
import { hasRegisteredPage, pageRegistry } from '@/router/registry'

describe('archive route registry', () => {
  it('registers DCL archives without duplicate BOB or customer-subunit pages', () => {
    expect(pageRegistry['dcl/customer']?.entityTitle).toBe('客户变更')
    expect(hasRegisteredPage('dcl', 'customer')).toBe(true)
    expect(hasRegisteredPage('bob', 'customer')).toBe(false)
    expect(hasRegisteredPage('bob', 'supplier')).toBe(false)
    expect(hasRegisteredPage('bob', 'product')).toBe(false)
    expect(hasRegisteredPage('dcl', 'customer-subunit')).toBe(false)
    expect(hasRegisteredPage('bob', 'customer-subunit')).toBe(false)
  })
})
