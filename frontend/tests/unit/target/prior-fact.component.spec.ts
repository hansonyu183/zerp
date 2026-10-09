import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SnapshotValue from '../../../src/target/components/document-page/SnapshotValue.vue'
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
            props: ['field', 'modelValue', 'disabled'],
            template: '<div />',
          },
          FormBlock: true,
        },
      },
    })
    expect(
      wrapper.findComponent({ name: 'FieldInput' }).props('disabled'),
    ).toBe(false)
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
  it('explicitly locked service registration refuses toggle events while normal purchase remains editable', async () => {
    const wrapper = mount(PriorFactBlock, {
      props: {
        entity: 'service-contract',
        disabled: false,
        allowToggle: false,
      },
      global: {
        stubs: {
          FieldInput: {
            name: 'FieldInput',
            props: ['field', 'modelValue', 'disabled'],
            template: '<div />',
          },
          FormBlock: true,
        },
      },
    })
    const field = wrapper.findComponent({ name: 'FieldInput' })
    expect(field.props('disabled')).toBe(true)
    field.vm.$emit('update:modelValue', true)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.setProps({ entity: 'purchase-order', allowToggle: true })
    expect(field.props('disabled')).toBe(false)
    field.vm.$emit('update:modelValue', true)
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('original external receipt relationships', () => {
  it('renders the original sales document and line without confusing it with a prior receipt type', () => {
    const wrapper = mount(SnapshotValue, {
      props: {
        field: 'priorLineOrigins',
        value: [
          {
            lineId: 'line-1',
            sourceDocumentType: 'BB',
            sourceDocumentKey: '548909',
            sourceLineKey: '5',
          },
        ],
      },
      global: {
        stubs: {
          CollectionBlock: {
            props: ['caption', 'modelValue', 'fields'],
            template:
              '<section>{{caption}}<div v-for="row in modelValue"><span v-for="field in fields">{{field.caption}}<slot name="summary" :value="row" :field="field" /></span></div></section>',
          },
        },
      },
    })
    expect(wrapper.text()).toContain('原单据行关联')
    expect(wrapper.text()).toContain('原行键')
    expect(wrapper.text()).toContain('销售订单')
    expect(wrapper.text()).toContain('548909')
    expect(wrapper.text()).not.toContain('单据数据错误')
    wrapper.unmount()
    const prior = mount(SnapshotValue, {
      props: { field: 'sourceDocumentType', value: 'BB' },
    })
    expect(prior.text()).toContain('未知选项')
    prior.unmount()
  })
})
