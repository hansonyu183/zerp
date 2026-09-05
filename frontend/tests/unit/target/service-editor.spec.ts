import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import {
  createVouDraftPayload,
  type VouVersionedReferenceInput,
} from '@zerp/model'

import ServiceEditor from '@/target/pages/vou/shared/editors/ServiceEditor.vue'
import type { VouReferenceOption } from '@/target/pages/vou/shared/vm.ts'

const otherUnit = {
  entity: 'other-unit' as const,
  objectId: 'O'.repeat(26),
  approvalEntryId: 'A'.repeat(26),
  code: 'QT-01',
  name: '旧其他单位',
} satisfies VouReferenceOption
const salesPartner = {
  entity: 'sales-partner' as const,
  objectId: 'S'.repeat(26),
  approvalEntryId: 'P'.repeat(26),
  code: 'XS-01',
  name: '新销售合作方',
} satisfies VouReferenceOption

function reference(option: VouReferenceOption): VouVersionedReferenceInput {
  return {
    objectId: option.objectId,
    approvalEntryId: option.approvalEntryId!,
    selectionOrigin: 'CURRENT',
  }
}

function mountEditor() {
  const payload = createVouDraftPayload('service-contract', () =>
    'D'.repeat(26),
  )
  payload.counterpartyType = 'other-unit'
  payload.counterparty = reference(otherUnit)
  const wrapper = mount(ServiceEditor, {
    props: {
      payload,
      referenceOptions: {
        'other-unit': [otherUnit],
        'sales-partner': [salesPartner],
      },
    },
    global: {
      stubs: {
        BaseFields: { template: '<div />' },
        ReferenceIdSelect: { template: '<div />' },
        ReferenceSelect: {
          name: 'ReferenceSelect',
          props: ['label', 'modelValue', 'options'],
          emits: ['update:modelValue'],
          template: '<div />',
        },
        'v-row': { template: '<div><slot /></div>' },
        'v-col': { template: '<div><slot /></div>' },
        'v-card': { template: '<section><slot /></section>' },
        'v-card-title': { template: '<h4><slot /></h4>' },
        'v-card-text': { template: '<div><slot /></div>' },
        'v-select': {
          name: 'VSelect',
          props: ['label', 'modelValue', 'items'],
          emits: ['update:modelValue'],
          template: '<div />',
        },
        'v-text-field': { template: '<div />' },
        'v-textarea': { template: '<div />' },
      },
    },
  })
  return { payload, wrapper }
}

function componentByLabel(
  wrapper: ReturnType<typeof mount>,
  name: string,
  label: string,
) {
  const component = wrapper
    .findAllComponents({ name })
    .find((candidate) => candidate.props('label') === label)
  if (!component) throw new Error(`${name} with label ${label} not found`)
  return component
}

describe('service editor public seam', () => {
  it('clears a stale counterparty when its type changes, then retains the new consecutive selection', async () => {
    const { payload, wrapper } = mountEditor()
    const typeSelect = componentByLabel(wrapper, 'VSelect', '合作方类型')
    const counterpartySelect = componentByLabel(
      wrapper,
      'ReferenceSelect',
      '合作方',
    )

    expect(counterpartySelect.props('options')).toEqual([otherUnit])

    await typeSelect.vm.$emit('update:modelValue', 'sales-partner')

    expect(payload.counterpartyType).toBe('sales-partner')
    expect(payload.counterparty).toEqual({
      objectId: '',
      approvalEntryId: '',
      selectionOrigin: 'CURRENT',
    })
    expect(wrapper.emitted('change')).toHaveLength(1)
    expect(counterpartySelect.props('options')).toEqual([salesPartner])

    await counterpartySelect.vm.$emit(
      'update:modelValue',
      reference(salesPartner),
    )
    await typeSelect.vm.$emit('update:modelValue', 'sales-partner')

    expect(payload.counterparty).toEqual(reference(salesPartner))
    expect(wrapper.emitted('change')).toHaveLength(3)
  })
})
