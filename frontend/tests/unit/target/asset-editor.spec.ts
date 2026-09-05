import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { createVouDraftPayload } from '@zerp/model'

import AssetEditor from '@/target/pages/vou/shared/editors/AssetEditor.vue'

function mountEditor() {
  const payload = createVouDraftPayload('asset-acquisition', () =>
    'A'.repeat(26),
  )
  const wrapper = mount(AssetEditor, {
    props: { payload, referenceOptions: {} },
    global: {
      stubs: {
        BaseFields: { template: '<div />' },
        ObjectReferenceSelect: { template: '<select><slot /></select>' },
        ReferenceIdSelect: { template: '<select><slot /></select>' },
        ReferenceSelect: { template: '<select><slot /></select>' },
        'v-row': { template: '<div><slot /></div>' },
        'v-col': { template: '<div><slot /></div>' },
        'v-table': { template: '<table><slot /></table>' },
        'v-btn': {
          emits: ['click'],
          template: '<button @click="$emit(\'click\')"><slot /></button>',
        },
        'v-text-field': {
          props: ['label', 'modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        'v-number-input': {
          props: ['label', 'modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input type="number" :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
        },
      },
    },
  })
  return { payload, wrapper }
}

describe('asset acquisition editor public seam', () => {
  it('labels its required inputs and retains consecutive numeric edits', async () => {
    const { payload, wrapper } = mountEditor()

    for (const label of [
      '资产名称',
      '原值金额',
      '使用年限（月数）',
      '残值率（比例）',
      '存放位置',
    ])
      expect(wrapper.find(`input[aria-label="${label}"]`).exists()).toBe(true)

    await wrapper.get('input[aria-label="原值金额"]').setValue('1000.00')
    await wrapper.get('input[aria-label="使用年限（月数）"]').setValue('24')
    await wrapper.get('input[aria-label="残值率（比例）"]').setValue('5.00')

    expect(payload.assetAcquisitionLines[0]).toMatchObject({
      originalValue: '1000.00',
      usefulLifeMonths: 24,
      residualRate: '5.00',
    })
  })
})
