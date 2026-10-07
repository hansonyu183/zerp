import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PriorFactBlock from '../../../src/target/components/document-page/PriorFactBlock.vue'
import {
  priorFactPayload,
  type PriorFactDraft,
} from '../../../src/target/components/document-page/prior-fact-data.ts'

describe('prior source state choice', () => {
  it('requires an explicit closed or open choice after enabling prior registration', async () => {
    const wrapper = mount(PriorFactBlock, {
      props: { entity: 'purchase-order', disabled: false },
      global: {
        stubs: {
          FieldInput: {
            name: 'FieldInput',
            props: ['field', 'modelValue'],
            template: '<div />',
          },
          FormBlock: true,
        },
      },
    })
    wrapper
      .findComponent({ name: 'FieldInput' })
      .vm.$emit('update:modelValue', true)
    const draft = wrapper.emitted('update:modelValue')![0]![0] as PriorFactDraft
    expect(draft.sourceClosed).toBeNull()
    expect(() => priorFactPayload(draft)).toThrow('请选择源单关闭状态')
    await wrapper.setProps({ modelValue: draft })
    const choice = wrapper.findAllComponents({ name: 'FieldInput' })[1]!
    expect(choice.props('modelValue')).toBeNull()
    expect(choice.props('field').options).toEqual([
      { value: true, caption: '已关闭' },
      { value: false, caption: '未关闭' },
    ])
    choice.vm.$emit('update:modelValue', false)
    const open = wrapper
      .emitted('update:modelValue')!
      .at(-1)![0] as PriorFactDraft
    expect(priorFactPayload(open).sourceClosed).toBe(false)
    choice.vm.$emit('update:modelValue', true)
    const closed = wrapper
      .emitted('update:modelValue')!
      .at(-1)![0] as PriorFactDraft
    expect(priorFactPayload(closed).sourceClosed).toBe(true)
    wrapper.unmount()
  })
})
