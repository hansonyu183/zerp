import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UserEditorPresentation from '@/target/pages/app/user/UserEditorPresentation.vue'
import UserListPresentation from '@/target/pages/app/user/UserListPresentation.vue'

const buttonStub = {
  props: ['disabled'],
  emits: ['click'],
  template:
    '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

describe('app/user presentation components retained for #381', () => {
  it('renders the target user list, pagination, status and feedback and emits UI intent', async () => {
    const wrapper = mount(UserListPresentation, {
      props: {
        items: [
          {
            id: 'user-1',
            code: 'buyer',
            name: '采购员',
            enabled: true,
            actionLabel: '维护',
          },
        ],
        total: 21,
        page: 1,
        keyword: '',
        queryError: '查询失败',
        feedback: '保存成功',
        canCreate: true,
      },
      global: {
        stubs: {
          ManagementPageFrame: {
            props: ['title'],
            template:
              '<section>{{ title }}<slot name="actions"/><slot name="alerts"/><slot name="filters"/><slot/><slot name="footer"/></section>',
          },
          AppSnackbar: {
            props: ['message'],
            emits: ['dismiss'],
            template:
              '<div>{{ message }}<button @click="$emit(\'dismiss\')">dismiss</button></div>',
          },
          VAlert: { template: '<div><slot /></div>' },
          VTextField: { template: '<input />' },
          VBtn: buttonStub,
          VChip: { template: '<span><slot /></span>' },
          VDataTable: {
            props: ['items'],
            template:
              '<div><span>{{ items[0].code }} {{ items[0].name }}</span><slot name="item.enabled" :item="items[0]"/><slot name="item.actions" :item="items[0]"/></div>',
          },
          VPagination: {
            emits: ['update:modelValue'],
            template:
              '<button @click="$emit(\'update:modelValue\', 2)">下一页</button>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('buyer 采购员')
    expect(wrapper.text()).toContain('启用')
    expect(wrapper.text()).toContain('查询失败')
    expect(wrapper.text()).toContain('保存成功')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '维护')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '下一页')!
      .trigger('click')

    expect(wrapper.emitted('open')).toEqual([['user-1']])
    expect(wrapper.emitted('page')).toEqual([[2]])
  })

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
})
