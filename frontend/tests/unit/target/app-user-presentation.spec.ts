import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UserEditorPresentation from '@/target/pages/app/user/UserEditorPresentation.vue'

const buttonStub = {
  props: ['disabled'],
  emits: ['click'],
  template:
    '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

describe('retained app/user editor presentation', () => {
  it('renders only the target editor form and emits save and close intent', async () => {
    const wrapper = mount(UserEditorPresentation, {
      props: {
        open: true,
        mode: 'edit',
        code: 'buyer',
        name: '采购员',
        password: '',
        roleIds: ['role-1'],
        roleOptions: [{ title: '采购', value: 'role-1' }],
        canSave: true,
      },
      global: {
        stubs: {
          VDialog: { template: '<div><slot /></div>' },
          VCard: {
            props: ['title'],
            template: '<section>{{ title }}<slot /></section>',
          },
          VCardText: { template: '<div><slot /></div>' },
          VCardActions: { template: '<div><slot /></div>' },
          VAlert: { template: '<div><slot /></div>' },
          VTextField: {
            props: ['label', 'modelValue', 'disabled'],
            template:
              '<label>{{ label }}<input :value="modelValue" :disabled="disabled" /></label>',
          },
          VSelect: {
            props: ['label'],
            template: '<label>{{ label }}<select /></label>',
          },
          VBtn: buttonStub,
          VSpacer: { template: '<span />' },
        },
      },
    })

    expect(wrapper.text()).toContain('编辑用户')
    expect(wrapper.text()).toContain('用户编码')
    expect(wrapper.text()).toContain('名称')
    expect(wrapper.text()).toContain('角色')
    expect(wrapper.text()).not.toContain('状态')
    expect(wrapper.text()).not.toContain('版本')
    expect(wrapper.text()).not.toContain('停用')
    expect(wrapper.text()).not.toContain('启用')

    for (const label of ['保存', '取消'])
      await wrapper
        .findAll('button')
        .find((item) => item.text() === label)!
        .trigger('click')

    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('keeps the saving editor mounted and disables every mutable control and cancellation', async () => {
    const wrapper = mount(UserEditorPresentation, {
      props: {
        open: true,
        mode: 'create',
        code: 'buyer',
        name: '采购员',
        password: 'Temporary-1234',
        roleIds: ['role-1'],
        roleOptions: [{ title: '采购', value: 'role-1' }],
        saving: true,
        canSave: true,
      },
      global: {
        stubs: {
          VDialog: { template: '<div><slot /></div>' },
          VCard: { template: '<section><slot /></section>' },
          VCardText: { template: '<div><slot /></div>' },
          VCardActions: { template: '<div><slot /></div>' },
          VAlert: { template: '<div><slot /></div>' },
          VTextField: {
            props: ['label', 'disabled'],
            template: '<input :aria-label="label" :disabled="disabled" />',
          },
          VSelect: {
            props: ['label', 'disabled'],
            template: '<select :aria-label="label" :disabled="disabled" />',
          },
          VBtn: buttonStub,
          VSpacer: { template: '<span />' },
        },
      },
    })

    for (const control of wrapper.findAll('input, select'))
      expect(control.attributes('disabled')).toBeDefined()
    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['取消', '保存'])
    for (const button of buttons)
      expect(button.attributes('disabled')).toBeDefined()

    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ saving: false, loading: true })
    for (const control of wrapper.findAll('input, select'))
      expect(control.attributes('disabled')).toBeDefined()
  })
})
