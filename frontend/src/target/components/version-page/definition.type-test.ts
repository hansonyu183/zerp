import type { Ref } from 'vue'
import * as api from '../../api.ts'
import { supplierPage } from '../../definitions/supplier.ts'
import type { EditFields } from '../dynamic-fields/edit-fields.ts'
import type {
  VersionAdapter,
  VersionDefinition,
  VersionSnapshots,
} from './definition.ts'
import type { FormFields } from '../dynamic-fields/form-fields.ts'
import type { DetailFields } from './detail-fields.ts'
type Customer = VersionSnapshots['bob/customer']
const nested: EditFields<Customer> = [
  // @ts-expect-error Top-level fields cannot reach into customer subunits.
  { key: 'subunits.0.name', type: 'text', caption: '名称' },
]
const wrongType: EditFields<Customer> = [
  // @ts-expect-error Amount/number fields cannot bind a string identity.
  { key: 'legalName', type: 'integer', caption: '名称' },
]
const arrayField: FormFields<Customer> = [
  {
    // @ts-expect-error Repeating subunits require a detail block.
    key: 'subunits',
    type: 'snapshot-reference',
    source: 'customer-types',
    caption: '子单位',
  },
]
const badSource: FormFields<Customer> = [
  {
    key: 'defaultOperatingEntity',
    type: 'snapshot-reference',
    // @ts-expect-error Reference sources are a closed catalog, not arbitrary API paths.
    source: '/custom/api',
    caption: '主体',
  },
]
const nestedDetails: DetailFields<Customer> = [
  {
    key: 'subunits',
    type: 'rows',
    caption: '子单位',
    fields: [
      // @ts-expect-error Child details use their row's actual keys.
      { key: 'legalName', type: 'text', caption: '名称' },
    ],
  },
]
const state: VersionDefinition = {
  ...supplierPage,
  // @ts-expect-error Version definitions cannot own reactive runtime state.
  vm: {} as Ref<object>,
}
const renderer: VersionDefinition = {
  ...supplierPage,
  // @ts-expect-error A definition cannot inject layout callbacks.
  render: () => null,
}
const resource: VersionDefinition = {
  ...supplierPage,
  // @ts-expect-error The version resource set is finite.
  resource: 'bob/unknown',
}
declare const customerAdapter: VersionAdapter<Customer>
const wrongApi: VersionAdapter<Customer> = {
  ...customerAdapter,
  // @ts-expect-error A customer snapshot cannot be submitted through a supplier route.
  submitNew: api.submitNewTargetSupplier,
}
void [
  nested,
  wrongType,
  arrayField,
  badSource,
  nestedDetails,
  state,
  renderer,
  resource,
  wrongApi,
]
