import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'

import {
  createResourceRegistry,
  targetResourceRegistry,
} from '@/target/navigation/registry.ts'
import { targetDomainCapabilities } from '@/target/navigation/resources.ts'

describe('business resource registry', () => {
  it('resolves a registered implementation with its fixed domain capabilities', () => {
    const component = defineComponent({ template: '<div>user</div>' })
    const registry = createResourceRegistry([
      { domain: 'app', entity: 'user', component },
    ])

    expect(registry.resolve('app', 'user')).toEqual({
      domain: 'app',
      entity: 'user',
      component,
      capabilities: {
        approval: false,
        businessVersion: false,
        enabled: true,
      },
    })
    expect(registry.resolve('app', 'role')).toBeNull()
  })

  it('keeps the target domain matrix fixed and registers the completed APP and AUX slices', () => {
    expect(targetDomainCapabilities).toEqual({
      session: { approval: false, businessVersion: false, enabled: false },
      bob: { approval: true, businessVersion: true, enabled: true },
      vou: { approval: true, businessVersion: false, enabled: false },
      app: { approval: false, businessVersion: false, enabled: true },
      aux: { approval: false, businessVersion: false, enabled: true },
      acc: { approval: false, businessVersion: false, enabled: true },
      rpt: { approval: false, businessVersion: false, enabled: false },
      wfl: { approval: true, businessVersion: true, enabled: true },
    })
    expect(targetResourceRegistry.resolve('app', 'user')).toMatchObject({
      domain: 'app',
      entity: 'user',
      capabilities: {
        approval: false,
        businessVersion: false,
        enabled: true,
      },
    })
    expect(targetResourceRegistry.resolve('app', 'role')).toMatchObject({
      domain: 'app',
      entity: 'role',
      capabilities: {
        approval: false,
        businessVersion: false,
        enabled: true,
      },
    })
    expect(
      targetResourceRegistry.resolve('aux', 'employee-category'),
    ).toMatchObject({
      domain: 'aux',
      entity: 'employee-category',
      capabilities: {
        approval: false,
        businessVersion: false,
        enabled: true,
      },
    })
    expect(targetResourceRegistry.resolve('aux', 'position')).toMatchObject({
      domain: 'aux',
      entity: 'position',
      capabilities: {
        approval: false,
        businessVersion: false,
        enabled: true,
      },
    })
    expect(
      targetResourceRegistry.resolve('aux', 'measurement-unit'),
    ).toMatchObject({ domain: 'aux', entity: 'measurement-unit' })
    expect(
      targetResourceRegistry.resolve('aux', 'payment-method'),
    ).toMatchObject({ domain: 'aux', entity: 'payment-method' })
    expect(
      targetResourceRegistry.resolve('aux', 'asset-category'),
    ).toMatchObject({ domain: 'aux', entity: 'asset-category' })
    expect('dcl' in targetDomainCapabilities).toBe(false)
    for (const [domain, entity] of [
      ['app', 'user'],
      ['app', 'role'],
      ['aux', 'employee-category'],
      ['aux', 'position'],
      ['aux', 'measurement-unit'],
      ['aux', 'payment-method'],
      ['aux', 'asset-category'],
    ]) {
      const definition = targetResourceRegistry.resolve(
        domain!,
        entity!,
      )!.definition!
      expect(
        definition.columns.slice(0, 3).map((field) => [field.key, field.type]),
      ).toEqual([
        ['code', 'text'],
        ['name', 'text'],
        ['enabled', 'boolean'],
      ])
      expect(definition.columns.at(-1)).toMatchObject({
        key: '$actions',
        type: 'actions',
      })
      expect(definition.filters[0]).toMatchObject({
        key: 'keyword',
        type: 'text',
      })
    }
  })
})
