import type { Ref } from 'vue'
import type { DirectDefinition, EditFields } from './definition.ts'
import { defineDirectPage } from './definition.ts'
import type { TargetMeasurementUnitCreateInput } from '../../api.ts'
import { measurementUnitPage } from '../../definitions/measurement-unit.ts'

const wrongValue: EditFields<TargetMeasurementUnitCreateInput> = [
  // @ts-expect-error Integer editors cannot bind to string fields.
  { key: 'symbol', type: 'integer', caption: '符号' },
]
const nested: EditFields<TargetMeasurementUnitCreateInput> = [
  // @ts-expect-error Only top-level keys of the typed payload are allowed.
  { key: 'data.name', type: 'text', caption: '名称' },
]
const multiple: EditFields<TargetMeasurementUnitCreateInput> = [
  // @ts-expect-error Multi-reference fields require an array value.
  { key: 'name', type: 'multi-reference', source: 'roles', caption: '名称' },
]
const url: EditFields<{ managerId: string }> = [
  {
    key: 'managerId',
    type: 'reference',
    // @ts-expect-error References use a finite catalog, never URLs.
    source: '/api/arbitrary',
    caption: '负责人',
  },
]
const state: DirectDefinition = {
  ...measurementUnitPage,
  // @ts-expect-error Definitions cannot hold a page VM.
  vm: {} as Ref<object>,
}
// @ts-expect-error Definitions cannot supply arbitrary render functions.
const render: DirectDefinition = { ...measurementUnitPage, render: () => null }
const resource: DirectDefinition = {
  ...measurementUnitPage,
  // @ts-expect-error Resource keys belong to the registered closed direct-maintenance set.
  resource: 'aux/unknown',
}
defineDirectPage<{ name: string }>({
  resource: 'aux/position',
  fields: [],
  adapter: {
    ...measurementUnitPage.adapter,
    // @ts-expect-error A reactive empty value does not satisfy the adapter payload.
    empty: () => ({ name: {} as Ref<string> }),
  },
})
void [wrongValue, nested, multiple, url, state, render, resource]
