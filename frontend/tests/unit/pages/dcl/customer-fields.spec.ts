import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import CustomerAccountFields from '@/pages/dcl/customer-account/CustomerAccountFields.vue'
import { createCustomerAccountForm } from '@/pages/dcl/customer-account/form'

const containerStub = defineComponent({
  name: 'ContainerStub',
  template: '<div><slot /></div>',
})
const inputStub = defineComponent({
  name: 'InputStub',
  props: [
    'modelValue',
    'items',
    'label',
    'loading',
    'errorMessages',
    'required',
  ],
  emits: ['update:modelValue', 'update:search'],
  template: '<div />',
})

describe('CustomerAccountFields', () => {
  it('renders controlled references and reloads the sales subject when its type changes', async () => {
    const form = createCustomerAccountForm()
    form.primarySalesAttribution.subjectObjectId = 'EMP-1'
    const wrapper = mount(CustomerAccountFields, {
      props: {
        modelValue: form,
        referenceOptions: {
          customerTypeId: [{ value: 'TYPE-1', title: 'T-001 · 普通客户' }],
          settlementMethodId: [{ value: 'SET-1', title: 'S-001 · 月结' }],
          paymentMethodId: [{ value: 'PAY-1', title: 'P-001 · 银行转账' }],
          primarySalesAttributionSubjectObjectId: [
            { value: 'EMP-1', title: 'E-001 · 张三' },
          ],
        },
        referenceLoading: {
          customerTypeId: false,
          settlementMethodId: false,
          paymentMethodId: false,
          primarySalesAttributionSubjectObjectId: false,
        },
        referenceError: {
          customerTypeId: null,
          settlementMethodId: '结算方式请求失败',
          paymentMethodId: null,
          primarySalesAttributionSubjectObjectId: null,
        },
      },
      global: {
        stubs: {
          VRow: containerStub,
          VCol: containerStub,
          VTextField: inputStub,
          VTextarea: inputStub,
          VBtn: inputStub,
          VSpacer: containerStub,
          VSelect: inputStub,
          VAutocomplete: inputStub,
        },
      },
    })

    const settlement = wrapper
      .findAllComponents(inputStub)
      .find((component) => component.props('label') === '结算方式')
    expect(settlement?.props('items')).toEqual([
      { value: 'SET-1', title: 'S-001 · 月结' },
    ])
    expect(settlement?.props('errorMessages')).toBe('结算方式请求失败')

    const salesType = wrapper
      .findAllComponents(inputStub)
      .find((component) => component.props('label') === '主要业务归属类型')
    salesType?.vm.$emit('update:modelValue', 'CHANNEL_PARTNER')
    await nextTick()

    expect(form.primarySalesAttribution.subjectObjectId).toBe('')
    expect(wrapper.emitted('searchReference')).toContainEqual([
      'primarySalesAttributionSubjectObjectId',
      '',
    ])
  })
})
