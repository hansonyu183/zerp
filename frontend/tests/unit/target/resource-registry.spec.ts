import { vouEntities } from '@zerp/model'
import { userPage } from '@/target/definitions/user.ts'
import { describe, expect, it } from 'vitest'

import {
  createResourceRegistry,
  targetResourceRegistry,
} from '@/target/navigation/registry.ts'
import { targetDomainCapabilities } from '@/target/navigation/resources.ts'

describe('business resource registry', () => {
  it('resolves a registered implementation with its fixed domain capabilities', () => {
    const definition = userPage
    const registry = createResourceRegistry([
      { domain: 'app', entity: 'user', definition },
    ])

    expect(registry.resolve('app', 'user')).toEqual({
      domain: 'app',
      entity: 'user',
      definition,
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
    expect(
      targetResourceRegistry.resolve('aux', 'operating-entity'),
    ).toMatchObject({ domain: 'aux', entity: 'operating-entity' })
    expect(targetResourceRegistry.resolve('aux', 'employee')).toMatchObject({
      domain: 'aux',
      entity: 'employee',
    })
    for (const entity of ['supplier', 'other-unit', 'sales-partner'])
      expect(targetResourceRegistry.resolve('bob', entity)).toMatchObject({
        domain: 'bob',
        entity,
        capabilities: {
          approval: true,
          businessVersion: true,
          enabled: true,
        },
      })
    expect(targetResourceRegistry.resolve('bob', 'supplier')).toMatchObject({
      useCaseKey: 'bob/supplier-management',
    })
    expect(targetResourceRegistry.resolve('bob', 'other-unit')).toMatchObject({
      useCaseKey: 'bob/other-unit-management',
    })
    expect(
      targetResourceRegistry.resolve('bob', 'sales-partner'),
    ).toMatchObject({ useCaseKey: 'bob/sales-partner-management' })
    expect('dcl' in targetDomainCapabilities).toBe(false)
    for (const [domain, entity] of [
      ['app', 'user'],
      ['app', 'role'],
      ['aux', 'employee-category'],
      ['aux', 'position'],
      ['aux', 'measurement-unit'],
      ['aux', 'payment-method'],
      ['aux', 'asset-category'],
      ['aux', 'operating-entity'],
      ['aux', 'employee'],
    ]) {
      const definition = targetResourceRegistry.resolve(
        domain!,
        entity!,
      )!.definition!
      expect(definition).toMatchObject({
        kind: 'direct',
        resource: `${domain}/${entity}`,
      })
      expect(Object.keys(definition).sort()).toEqual([
        'adapter',
        'fields',
        'kind',
        'resource',
      ])
    }
  })
})

it('opens every shared voucher type through the real registry with independent document fields', () => {
  for (const entity of vouEntities) {
    const page = targetResourceRegistry.resolve('vou', entity)
    expect(page, entity).not.toBeNull()
    expect(page?.vouType).toBe(entity)
    expect(page?.definition).toEqual({ kind: 'document', vouType: entity })
    expect(page?.capabilities).toEqual({
      approval: true,
      businessVersion: false,
      enabled: false,
    })
  }
})

it('registers only definitions and leaves page selection to the Host', () => {
  for (const [domain, entity] of [
    ['app', 'user'],
    ['bob', 'supplier'],
    ['vou', 'opening'],
    ['acc', 'mapping'],
    ['wfl', 'process-instance'],
    ['rpt', 'rpt-000001'],
  ]) {
    const registration = targetResourceRegistry.resolve(domain!, entity!)!
    expect(registration.definition).toBeDefined()
    expect(registration).not.toHaveProperty('component')
  }
})
