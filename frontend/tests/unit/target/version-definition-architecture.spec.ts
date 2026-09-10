import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { targetResourceRegistry } from '@/target/navigation/registry.ts'
const resources = [
  'bob/customer',
  'bob/product',
  'bob/supplier',
  'bob/other-unit',
  'bob/sales-partner',
  'wfl/process-definition',
] as const
const root = resolve(import.meta.dirname, '../../../src/target')
it('assembles every version archive from one stateless definition and a single runtime', () => {
  const importsAllowed = new Set([
    '../api.ts',
    '../components/version-page/definition.ts',
    '../components/version-page/customer-data.ts',
    '../components/version-page/product-data.ts',
    '../components/version-page/wfl-data.ts',
    '../components/version-page/identity-data.ts',
  ])
  for (const resource of resources) {
    const [domain, entity] = resource.split('/')
    const registration = targetResourceRegistry.resolve(domain!, entity!)!
    expect(registration.definition).toMatchObject({ kind: 'version', resource })
    expect(Object.keys(registration.definition!).sort()).toEqual([
      'adapter',
      'fields',
      'kind',
      'resource',
    ])
    const source = readFileSync(
      resolve(root, `definitions/${entity}.ts`),
      'utf8',
    )
    expect(source).toMatch(/defineVersionPage</)
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g))
      expect(importsAllowed.has(match[1]!), `${resource}: ${match[1]}`).toBe(
        true,
      )
    expect(source).not.toMatch(
      /\b(?:reactive|ref|shallowRef|computed|watch|onMounted|fetch|defineComponent|render|eval)\s*\(|<template|<v-|\bas\s+(?:any|unknown)\b/,
    )
  }
  expect(existsSync(resolve(root, 'pages/bob'))).toBe(false)
  expect(existsSync(resolve(root, 'pages/wfl/definition'))).toBe(false)
  expect(
    targetResourceRegistry.resolve('wfl', 'process-instance')!.definition.kind,
  ).toBe('process')
})
