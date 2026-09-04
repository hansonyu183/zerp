import { describe, expect, it } from 'vitest'
import {
  vouEntityInputDescriptors,
  type VouInputFieldDescriptor,
} from '@zerp/model'

import {
  hasCompleteTargetPermissions,
  targetWireValueLabel,
} from '../../../src/target/vm.ts'

describe('target presentation and complete-loop permissions', () => {
  it('requires every permission in the save loop', () => {
    const required = [
      '/acc/book/query',
      '/acc/subject/query',
      '/acc/subject/save',
    ]

    expect(hasCompleteTargetPermissions(required, required)).toBe(true)
    for (const missing of required)
      expect(
        hasCompleteTargetPermissions(
          required.filter((permission) => permission !== missing),
          required,
        ),
      ).toBe(false)
  })

  it('presents every rendered VOU enum, boolean, variant, and WFL action in Chinese', () => {
    const values = new Set<string>(['false', 'true'])
    const collect = (fields: readonly VouInputFieldDescriptor[]) => {
      for (const field of fields) {
        for (const value of field.enumValues ?? []) values.add(value)
        for (const variant of field.variants ?? []) values.add(variant.id)
        if (field.fields) collect(field.fields)
        if (field.item) collect(field.item)
      }
    }
    for (const fields of Object.values(vouEntityInputDescriptors)) collect(fields)
    for (const action of [
      'OPEN_DOCUMENT',
      'CREATE_CHILD',
      'APPROVE_CHILD',
      'REJECT_CHILD',
      'RETRY_CHILD',
      'CANCEL_CHILD',
    ]) values.add(action)

    for (const value of values)
      expect(targetWireValueLabel(value), value).not.toBe(value)

    expect(targetWireValueLabel('true')).toBe('是')
    expect(targetWireValueLabel('CURRENT')).toBe('当前版本')
    expect(targetWireValueLabel('APPROVE_CHILD')).toBe('批准下游单据')
    expect(targetWireValueLabel('asset-primary')).toBe('资产期初')
  })
})
