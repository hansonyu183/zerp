import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RoleEditorPresentation from '@/target/pages/app/role/RoleEditorPresentation.vue'

const buttonStub = {
  props: ['disabled'],
  emits: ['click'],
  template:
    '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

describe('APP role editor presentation', () => {
  it('renders only name, description and permissions and emits save and close intent', async () => {
    const wrapper = mount(RoleEditorPresentation, {
      props: {
        open: true,
        mode: 'edit',
        name: '采购',
        description: '采购职责',
        permissionIds: ['permission-1'],
        permissionOptions: [
          { title: '/bob/customer/create（启用）', value: 'permission-1' },
        ],
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
            props: ['label'],
            template: '<label>{{ label }}<input /></label>',
          },
          VTextarea: {
            props: ['label'],
            template: '<label>{{ label }}<textarea /></label>',
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

    expect(wrapper.text()).toContain('编辑角色')
    expect(wrapper.text()).toContain('名称')
    expect(wrapper.text()).toContain('说明')
    expect(wrapper.text()).toContain('权限')
    expect(wrapper.text()).not.toContain('编码')
    expect(wrapper.text()).not.toContain('状态')
    expect(wrapper.text()).not.toContain('版本')

    for (const label of ['保存', '取消'])
      await wrapper
        .findAll('button')
        .find((item) => item.text() === label)!
        .trigger('click')

    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
