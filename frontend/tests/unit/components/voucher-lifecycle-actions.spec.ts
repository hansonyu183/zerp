import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import VoucherLifecycleActions from '@/components/voucher/VoucherLifecycleActions.vue'
import VoucherReasonDialog from '@/pages/vou/shared/VoucherReasonDialog.vue'

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
      availability: {
        get: true,
        save: false,
        submit: false,
        unsubmit: true,
        reject: false,
        approve: true,
        unapprove: false,
        finalize: false,
        unfinalize: false,
        delete: false,
        audit: false,
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
  it('runs unsubmit directly without opening a reason dialog', async () => {
    const wrapper = mountActions()

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('action')).toEqual([['unsubmit']])
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('still requires a reason before emitting unapprove', async () => {
    const wrapper = mountActions()
    await wrapper.setProps({
      availability: {
        ...wrapper.props('availability'),
        unsubmit: false,
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

  it('requires a reason before emitting reject', async () => {
    const wrapper = mountActions()
    await wrapper.setProps({
      availability: {
        ...wrapper.props('availability'),
        unsubmit: false,
        approve: false,
        reject: true,
      },
    })

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('action')).toBeUndefined()
    await wrapper.get('textarea').setValue('资料需补正')
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === '确认驳回')
    await confirm!.trigger('click')

    expect(wrapper.emitted('action')).toEqual([['reject', '资料需补正']])
  })
})

describe('VoucherReasonDialog', () => {
  it('keeps a rejected reverse action reason visible inside the dialog', () => {
    const wrapper = mount(VoucherReasonDialog, {
      props: {
        modelValue: true,
        reason: '撤销测试',
        title: '反批准',
        errorMessage: '已有下游单据，请先反向处理下游单据。',
      },
      global: {
        components: {
          VAlert: passthrough('VAlert'),
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

    expect(wrapper.text()).toContain('已有下游单据，请先反向处理下游单据。')
  })
})
