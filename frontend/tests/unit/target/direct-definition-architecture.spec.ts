import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { targetResourceRegistry } from '@/target/navigation/registry.ts'

const definitionRoot = resolve(
  import.meta.dirname,
  '../../../src/target/definitions',
)
const resources = [
  'app/user',
  'app/role',
  'aux/employee-category',
  'aux/position',
  'aux/measurement-unit',
  'aux/payment-method',
  'aux/asset-category',
  'aux/operating-entity',
  'aux/employee',
  'aux/warehouse',
  'aux/fund-account',
  'aux/vehicle',
]
const allowedImports = new Set([
  '../api.ts',
  '../components/direct-page/definition.ts',
  '../components/direct-page/references.ts',
])

describe('the actual direct definitions stay stateless and reach one runtime', () => {
  it('registers the complete scoped set with the single definition interface', () => {
    let component: unknown
    for (const resource of resources) {
      const [domain, entity] = resource.split('/')
      const registration = targetResourceRegistry.resolve(domain!, entity!)!
      expect(registration.definition).toMatchObject({
        kind: 'direct',
        resource,
      })
      expect(Object.keys(registration.definition!).sort()).toEqual([
        'adapter',
        'fields',
        'kind',
        'resource',
      ])
      component ??= registration.component
      expect(registration.component).toBe(component)
    }
    expect(targetResourceRegistry.resolve('aux', 'department')).toBeNull()
  })
  it('rejects state, templates, arbitrary imports and requests in every registered definition source', () => {
    const files = readdirSync(definitionRoot)
    expect(files.length).toBe(resources.length)
    for (const filename of files) {
      expect(filename.endsWith('.ts')).toBe(true)
      const source = readFileSync(resolve(definitionRoot, filename), 'utf8')
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (match) => match[1]!,
      )
      for (const dependency of imports)
        expect(
          allowedImports.has(dependency),
          `${filename}: ${dependency}`,
        ).toBe(true)
      expect(source, filename).not.toMatch(
        /\b(?:reactive|shallowReactive|ref|shallowRef|computed|watch|onMounted|onBeforeUnmount|fetch|XMLHttpRequest|defineComponent|h|render|eval|require)\s*\(|\bimport\s*\(|<template|<v-|https?:\/\//,
      )
      expect(source, filename).not.toMatch(/^\s*(?:let|var)\s/m)
      expect(source, filename).toMatch(/defineDirectPage</)
      expect(source, filename).not.toMatch(/\bas\s+(?:any|unknown)\b/)
    }
  })
})
