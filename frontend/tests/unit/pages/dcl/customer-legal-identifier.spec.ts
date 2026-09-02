import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import CustomerForm from '@/pages/dcl/customer/CustomerForm.vue'
import { createCustomerForm } from '@/pages/dcl/customer/vm'

const containerStub = defineComponent({ template: '<div><slot /></div>' })
const inputStub = defineComponent({
  name: 'InputStub',
  props: [
    'modelValue',
    'items',
    'label',
    'errorMessages',
    'readonly',
    'disabled',
  ],
  emits: ['update:modelValue', 'update:search'],
  template: '<div />',
})

function customerFormVm() {
  const form = createCustomerForm()
  return {
    form,
    vm: {
      createForm: form,
      editorForm: createCustomerForm(),
      currentView: null,
      editorMode: 'edit',
      editorEditable: true,
      referenceOptions: { operatingEntityId: [] },
      referenceLoading: { operatingEntityId: false },
      searchReference: vi.fn(),
      referenceErrorForAccount: () => null,
      referenceLoadingForAccount: () => false,
      referenceOptionsForAccount: () => [],
      addRemittanceProfile: vi.fn(),
      removeRemittanceProfile: vi.fn(),
      addAccount: vi.fn(),
      removeAccount: vi.fn(),
      setDefaultAccount: vi.fn(),
      openById: vi.fn(),
    },
  }
}

function field(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper
    .findAllComponents(inputStub)
    .find((component) => component.props('label') === label)
}

describe('CustomerForm legal identifier', () => {
  it('shows Chinese identity choices and immediately revalidates the current value when kind changes', async () => {
    const { form, vm } = customerFormVm()
    form.legalIdentifier = '91350211M000100Y46'
    const wrapper = mount(CustomerForm, {
      props: { vm: vm as never, kind: 'create' },
      global: {
        stubs: {
          VRow: containerStub,
          VCol: containerStub,
          VCard: containerStub,
          VCardTitle: containerStub,
          VCardText: containerStub,
          VDivider: containerStub,
          VSpacer: containerStub,
          VTextField: inputStub,
          VSelect: inputStub,
          VSwitch: inputStub,
          VAutocomplete: inputStub,
          VRadioGroup: inputStub,
          VRadio: inputStub,
          VBtn: inputStub,
          CustomerAccountFields: containerStub,
          CustomerAttachments: containerStub,
        },
      },
    })

    const kind = field(wrapper, '身份类型')
    expect(kind?.props('items')).toEqual([
      { title: '大陆企业', value: 'MAINLAND_ENTERPRISE' },
      { title: '大陆个人', value: 'MAINLAND_INDIVIDUAL' },
      { title: '其他', value: 'OTHER' },
    ])
    expect(
      field(wrapper, '统一社会信用代码')?.props('errorMessages'),
    ).toBeUndefined()

    field(wrapper, '统一社会信用代码')?.vm.$emit(
      'update:modelValue',
      '91350211M000100Y47',
    )
    await nextTick()
    expect(field(wrapper, '统一社会信用代码')?.props('errorMessages')).toBe(
      '统一社会信用代码须为校验通过的 18 位代码。',
    )

    field(wrapper, '统一社会信用代码')?.vm.$emit(
      'update:modelValue',
      '91350211M000100Y46',
    )

    kind?.vm.$emit('update:modelValue', 'MAINLAND_INDIVIDUAL')
    await nextTick()

    expect(field(wrapper, '居民身份证号')?.props('errorMessages')).toBe(
      '居民身份证号须为校验通过的 18 位号码。',
    )

    field(wrapper, '居民身份证号')?.vm.$emit(
      'update:modelValue',
      '11010519491231002x',
    )
    await nextTick()
    expect(
      field(wrapper, '居民身份证号')?.props('errorMessages'),
    ).toBeUndefined()

    kind?.vm.$emit('update:modelValue', 'OTHER')
    await nextTick()

    expect(field(wrapper, '法定识别号')?.props('errorMessages')).toBeUndefined()
  })
})
