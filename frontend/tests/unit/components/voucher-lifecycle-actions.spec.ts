import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import VoucherLifecycleActions from '@/components/voucher/VoucherLifecycleActions.vue'

const passthrough = (name: string, tag = 'div') =>
  defineComponent({
    name,
    setup(_, { slots }) {
      return () => h(tag, slots.default?.())
    },
  })

const VBtnStub = defineComponent({
  name: 'VBtn',
  inheritAttrs: false,
  props: { disabled: Boolean },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        'button',
        { ...attrs, disabled: props.disabled, onClick: () => emit('click') },
        slots.default?.(),
      )
  },
})

const VDialogStub = defineComponent({
  name: 'VDialog',
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () => (props.modelValue ? h('div', slots.default?.()) : null)
  },
})

const VTextareaStub = defineComponent({
  name: 'VTextarea',
  props: { modelValue: String, label: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('textarea', {
        'aria-label': props.label,
        value: props.modelValue,
        onInput: (event: Event) =>
          emit(
            'update:modelValue',
            (event.target as HTMLTextAreaElement).value,
          ),
      })
  },
})

function mountActions() {
  return mount(VoucherLifecycleActions, {
    props: {
      status: 'CHECKED',
      availability: {
        get: true,
        save: false,
        check: false,
        uncheck: true,
        approve: true,
        unapprove: false,
        finalize: false,
        unfinalize: false,
        delete: false,
        shortCloseRequest: false,
        shortCloseCancel: false,
        shortCloseConfirm: false,
        shortCloseUnconfirm: false,
        audit: false,
      },
      labels: {
        check: '核对',
        uncheck: '反核对',
        approve: '批准',
        unapprove: '反批准',
        finalize: '完成',
        unfinalize: '撤销完成',
        checked: '已核对',
        finalized: '已完成',
      },
    },
    global: {
      components: {
        VBtn: VBtnStub,
        VCard: passthrough('VCard'),
        VCardActions: passthrough('VCardActions'),
        VCardText: passthrough('VCardText'),
        VDialog: VDialogStub,
        VSpacer: passthrough('VSpacer'),
        VTextarea: VTextareaStub,
      },
    },
  })
}

describe('VoucherLifecycleActions', () => {
  it('runs uncheck directly without opening a reason dialog', async () => {
    const wrapper = mountActions()

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('action')).toEqual([['uncheck']])
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('still requires a reason before emitting unapprove', async () => {
    const wrapper = mountActions()
    await wrapper.setProps({
      status: 'APPROVED',
      availability: {
        ...wrapper.props('availability'),
        uncheck: false,
        approve: false,
        unapprove: true,
        finalize: true,
      },
    })

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('action')).toBeUndefined()
    await wrapper.get('textarea').setValue('需要撤销批准')
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === '确认反批准')
    expect(confirm).toBeDefined()
    await confirm!.trigger('click')

    expect(wrapper.emitted('action')).toEqual([['unapprove', '需要撤销批准']])
  })
})
