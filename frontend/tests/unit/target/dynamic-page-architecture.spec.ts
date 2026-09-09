import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { vouEntities } from '@zerp/model'
import { targetResourceRegistry } from '@/target/navigation/registry.ts'
const root = resolve(import.meta.dirname, '../../../src/target')
it('routes the remaining resources to closed page definitions with no VM or arbitrary adapter surface', () => {
  for (const [domain, entity, kind] of [
    ['acc', 'mapping', 'configuration'],
    ['wfl', 'process-instance', 'process'],
    ['rpt', 'rpt-000001', 'report'],
    ['rpt', 'rpt-000002', 'report'],
  ]) {
    const registration = targetResourceRegistry.resolve(domain!, entity!)!
    expect(registration.definition).toEqual(
      kind === 'report'
        ? { kind, code: entity }
        : { kind, resource: `${domain}/${entity}` },
    )
    expect((registration.component as { props?: object }).props).toHaveProperty(
      'definition',
    )
  }
  expect(targetResourceRegistry.resolve('rpt', 'rpt-invalid')).toBeNull()
  for (const name of ['mapping', 'report', 'process-instance']) {
    const source = readFileSync(resolve(root, `definitions/${name}.ts`), 'utf8')
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    )
    expect(imports).toHaveLength(1)
    expect(imports[0]).toMatch(
      /^\.\.\/components\/(configuration|report|process)-page\/definition.ts$/,
    )
    expect(source).not.toMatch(
      /\b(?:ref|reactive|watch|fetch|render|onMounted)\s*\(|<template|<v-|\bimport\s*\(/,
    )
  }
})
it('has exactly six runtime families for the entire registered business set', () => {
  const resources = [
    ['app', 'user'],
    ['app', 'role'],
    ...[
      'employee-category',
      'position',
      'measurement-unit',
      'payment-method',
      'asset-category',
      'operating-entity',
      'employee',
      'warehouse',
      'fund-account',
      'vehicle',
    ].map((e) => ['aux', e]),
    ...['customer', 'product', 'supplier', 'other-unit', 'sales-partner'].map(
      (e) => ['bob', e],
    ),
    ['wfl', 'process-definition'],
    ['wfl', 'process-instance'],
    ['acc', 'mapping'],
    ['rpt', 'rpt-000001'],
    ...vouEntities.map((e) => ['vou', e]),
    ['vou', 'opening'],
  ]
  const kinds = new Map<string, unknown>()
  for (const [domain, entity] of resources) {
    const r = targetResourceRegistry.resolve(domain!, entity!)!
    expect(r, `${domain}/${entity}`).not.toBeNull()
    const definition = r.definition!
    expect(definition).toBeDefined()
    const kind = definition.kind
    if (kinds.has(kind)) expect(r.component).toBe(kinds.get(kind))
    else kinds.set(kind, r.component)
  }
  expect([...kinds.keys()].sort()).toEqual([
    'configuration',
    'direct',
    'document',
    'process',
    'report',
    'version',
  ])
  // Real business registration imports have no remaining page path; only system/auth pages are excluded.
  expect(
    readFileSync(resolve(root, 'navigation/registry.ts'), 'utf8'),
  ).not.toMatch(/from ['"].*\/pages\//)
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)],
    )
  }
  for (const path of files(resolve(root, 'pages')))
    expect(path).toMatch(/\/pages\/(auth|system)\//)
})
