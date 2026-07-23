import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'

vi.mock('vuetify', () => ({
  useTheme: () => ({
    global: { name: { value: 'zerpLight' } },
    change: vi.fn(),
  }),
}))

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

function installLocalStorage() {
  const values = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: vi.fn(() => values.clear()),
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    },
  })
}

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppLayout,
        children: [{ path: 'home/dashboard', component: { template: '<div />' } }],
      },
      { path: '/signin', name: 'signin', component: { template: '<div />' } },
    ],
  })
}

describe('AppLayout account interactions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    installMatchMedia(false)
    installLocalStorage()
  })

  it('校验密码表单并标注 password autocomplete', async () => {
    const router = createTestRouter()
    await router.push('/home/dashboard')

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [router],
        stubs: {
          RouterView: { template: '<div />' },
          VAppBar: { template: '<header><slot /></header>' },
          VAppBarNavIcon: { template: '<button />' },
          VAlert: { template: '<div><slot /></div>' },
          VAvatar: { template: '<div><slot /></div>' },
          VBtn: {
            props: ['disabled', 'loading'],
            emits: ['click'],
            template: '<button :disabled="disabled || loading" @click="$emit(`click`)"><slot /></button>',
          },
          VCard: { template: '<section><slot /><slot name="text" /><slot name="actions" /></section>' },
          VCardActions: { template: '<div><slot /></div>' },
          VCardText: { template: '<div><slot /></div>' },
          VDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
          VDivider: { template: '<hr>' },
          VIcon: { template: '<span />' },
          VImg: { template: '<img>' },
          VList: { template: '<div><slot /></div>' },
          VListGroup: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
          VListItem: { template: '<button />' },
          VMain: { template: '<main><slot /></main>' },
          VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
          VNavigationDrawer: { template: '<nav><slot /><slot name="append" /></nav>' },
          VSnackbar: { template: '<div><slot /></div>' },
          VSpacer: { template: '<span />' },
          VTextField: {
            props: ['autocomplete', 'label', 'modelValue', 'required', 'type'],
            emits: ['update:modelValue'],
            template: `
              <input
                :aria-label="label"
                :autocomplete="autocomplete"
                :required="required"
                :type="type"
                :value="modelValue"
                @input="$emit('update:modelValue', $event.target.value)"
              >
            `,
          },
        },
      },
    })

    await (wrapper.vm as unknown as { openPassword: () => void }).openPassword()

    const updateButton = wrapper.findAll('button').find((button) => button.text() === '更新密码')
    expect(updateButton?.attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[aria-label="当前密码"]').attributes('autocomplete')).toBe('current-password')
    expect(wrapper.get('input[aria-label="新密码"]').attributes('autocomplete')).toBe('new-password')
    expect(wrapper.get('input[aria-label="确认新密码"]').attributes('autocomplete')).toBe('new-password')

    await wrapper.get('input[aria-label="当前密码"]').setValue('old-password')
    await wrapper.get('input[aria-label="新密码"]').setValue('new-pass')
    await wrapper.get('input[aria-label="确认新密码"]').setValue('different-pass')
    expect(updateButton?.attributes('disabled')).toBeDefined()

    await wrapper.get('input[aria-label="新密码"]').setValue('new-password')
    await wrapper.get('input[aria-label="确认新密码"]').setValue('new-password')
    expect(updateButton?.attributes('disabled')).toBeUndefined()
  })
})
