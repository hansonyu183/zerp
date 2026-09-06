import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ListPageShell from '@/target/components/list-page/ListPageShell.vue'
import UserEditorPresentation from '@/target/pages/app/user/UserEditorPresentation.vue'

const buttonStub = {
  props: ['disabled'],
  emits: ['click'],
  template:
    '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

describe('public list Shell and retained app/user editor presentation', () => {
  it('renders the enabled list, pagination, status and feedback and emits UI intent', async () => {
    const wrapper = mount(ListPageShell, {
      props: {
        title: '用户管理',
        items: [
          {
            id: 'user-1',
            code: 'buyer',
            py: 'caigouyuan',
            name: '采购员',
            enabled: true,
          },
        ],
        total: 21,
        page: 1,
        keyword: '',
        queryError: '查询失败',
        feedback: '保存成功',
        showEnabled: true,
        canSearch: true,
        canCreate: true,
        canEdit: () => true,
        canEnable: () => false,
        canDisable: () => true,
        isRowPending: () => false,
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
          VForm: { template: '<form><slot /></form>' },
          VBtn: buttonStub,
          VChip: { template: '<span><slot /></span>' },
          VDataTable: {
            props: {
              items: { type: Array, required: true },
              disableSort: { type: Boolean, default: false },
            },
            template:
              '<div data-testid="table" :data-disable-sort="String(disableSort)"><span>{{ items[0].code }} {{ items[0].name }}</span><slot name="item.enabled" :item="items[0]"/><slot name="item.actions" :item="items[0]"/></div>',
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
    expect(
      wrapper.get('[data-testid="table"]').attributes('data-disable-sort'),
    ).toBe('true')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '编辑')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '停用')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '下一页')!
      .trigger('click')

    expect(wrapper.emitted('edit')).toEqual([
      [expect.objectContaining({ id: 'user-1' })],
    ])
    expect(wrapper.emitted('disable')).toEqual([
      [expect.objectContaining({ id: 'user-1' })],
    ])
    expect(wrapper.emitted('page')).toEqual([[2]])
  })

  it('does not submit the filter while an input method is composing', async () => {
    const wrapper = mount(ListPageShell, {
      props: {
        title: '用户管理',
        items: [],
        total: 0,
        page: 1,
        keyword: '',
        canSearch: true,
      },
      global: {
        stubs: {
          ManagementPageFrame: {
            template:
              '<section><slot name="filters"/><slot/><slot name="footer"/></section>',
          },
          AppSnackbar: { template: '<div />' },
          VForm: {
            emits: ['submit'],
            template:
              '<form @submit.prevent="$emit(\'submit\', $event)"><slot /></form>',
          },
          VTextField: {
            emits: ['keydown'],
            template: '<input @keydown="$emit(\'keydown\', $event)" />',
          },
          VBtn: { template: '<button type="submit"><slot /></button>' },
          VAlert: { template: '<div><slot /></div>' },
          VChip: { template: '<span><slot /></span>' },
          VDataTable: { template: '<div />' },
          VPagination: { template: '<div />' },
        },
      },
    })

    const field = wrapper.get('[data-testid="list-keyword"]')
    await field.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(wrapper.emitted('search')).toBeUndefined()

    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('search')).toHaveLength(1)
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
