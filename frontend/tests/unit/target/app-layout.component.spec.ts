import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppLayout from '@/target/layouts/AppLayout.vue'

const harness = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  session: undefined as any,
  getProfile: vi.fn(),
  changePassword: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ fullPath: '/home/dashboard', meta: {} }),
  useRouter: () => harness.router,
}))

vi.mock('vuetify', () => ({
  useTheme: () => ({
    global: { name: { value: 'zerpLight' } },
    change: vi.fn(),
  }),
}))

vi.mock('@/target/session/branding.ts', () => ({
  useTargetBranding: () => ({ enterpriseName: '', load: vi.fn() }),
}))

vi.mock('@/target/session/vm.ts', () => {
  const session = reactive({
    user: { id: 'user-1', code: 'tester', name: '测试用户' },
    csrfToken: 'csrf-token',
    profile: null,
    menus: [],
    menuError: null,
    retryMenu: vi.fn(),
    clear: vi.fn(),
    restore: vi.fn(),
    getProfile: harness.getProfile,
    saveProfile: vi.fn(),
    changePassword: harness.changePassword,
    signOut: harness.signOut,
  })
  harness.session = session
  return { useTargetSession: () => session }
})

const stubs = {
  VAppBar: { template: '<div><slot /></div>' },
  VAppBarNavIcon: { template: '<button><slot /></button>' },
  VSpacer: { template: '<span />' },
  VMenu: {
    template: '<div><slot name="activator" :props="{}" /><slot /></div>',
  },
  VBtn: {
    emits: ['click'],
    template: '<button @click="$emit(\'click\')"><slot /></button>',
  },
  VAvatar: { template: '<span><slot /></span>' },
  VImg: { template: '<img />' },
  VIcon: { template: '<span />' },
  VList: { template: '<div><slot /></div>' },
  VListItem: {
    props: { title: { type: String, default: '' } },
    emits: ['click'],
    template: '<button @click="$emit(\'click\')"><slot />{{ title }}</button>',
  },
  VDivider: { template: '<hr />' },
  VNavigationDrawer: {
    template: '<aside><slot /><slot name="append" /></aside>',
  },
  VListGroup: {
    template: '<div><slot /><slot name="activator" :props="{}" /></div>',
  },
  VMain: { template: '<main><slot /></main>' },
  RouterView: { template: '<div />' },
  VDialog: {
    props: { modelValue: { type: Boolean, default: false } },
    template: '<div v-if="modelValue" role="dialog"><slot /></div>',
  },
  VCard: { template: '<section><slot /></section>' },
  VCardText: { template: '<div><slot /></div>' },
  VCardActions: { template: '<div><slot /></div>' },
  VTextField: {
    props: {
      label: { type: String, required: true },
      modelValue: { type: String, default: '' },
    },
    emits: ['update:modelValue'],
    template:
      '<label>{{ label }}<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></label>',
  },
  AppSnackbar: { template: '<div />' },
}

function mountLayout() {
  return mount(AppLayout, { global: { stubs } })
}

function button(wrapper: ReturnType<typeof mount>, text: string) {
  const candidate = wrapper
    .findAll('button')
    .find((item) => item.text() === text)
  if (!candidate) throw new Error(`missing button ${text}`)
  return candidate
}

describe('target account layout', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(), setItem: vi.fn() },
    })
    harness.router.push.mockReset()
    harness.router.replace.mockReset()
    harness.getProfile.mockReset()
    harness.changePassword.mockReset()
    harness.signOut.mockReset()
    harness.session.user = { id: 'user-1', code: 'tester', name: '测试用户' }
    harness.session.csrfToken = 'csrf-token'
    harness.getProfile.mockResolvedValue({
      id: 'user-1',
      code: 'tester',
      name: '服务端名称',
      avatarUrl: null,
      passwordChangedAt: '2026-09-06T00:00:00.000Z',
      revision: '1',
    })
  })

  it('clears cancelled profile and password form values', async () => {
    const wrapper = mountLayout()
    await button(wrapper, '名称与头像').trigger('click')
    await flushPromises()
    await wrapper.findAll('input')[0]!.setValue('临时名称')
    await button(wrapper, '取消').trigger('click')
    await nextTick()

    await button(wrapper, '名称与头像').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('input')[0]!.element.value).toBe('服务端名称')
    await button(wrapper, '取消').trigger('click')

    await button(wrapper, '更改密码').trigger('click')
    await nextTick()
    await wrapper.findAll('input')[0]!.setValue('current')
    await button(wrapper, '取消').trigger('click')
    await nextTick()
    await button(wrapper, '更改密码').trigger('click')
    await nextTick()
    expect(wrapper.findAll('input')[0]!.element.value).toBe('')
    wrapper.unmount()
  })

  it('loads the profile for the authenticated top bar on mount', async () => {
    const wrapper = mountLayout()
    await nextTick()

    expect(harness.getProfile).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('reloads the top-bar profile when the same account session is restored', async () => {
    const wrapper = mountLayout()
    await nextTick()
    harness.session.user = {
      id: 'user-1',
      code: 'tester',
      name: '测试用户',
    }
    await nextTick()

    expect(harness.getProfile).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('routes to sign-in after a successful password change clears this session', async () => {
    harness.changePassword.mockImplementation(async () => {
      harness.session.user = null
      harness.session.csrfToken = null
      return true
    })
    const wrapper = mountLayout()
    await button(wrapper, '更改密码').trigger('click')
    await nextTick()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('current-password')
    await inputs[1]!.setValue('new-password')
    await inputs[2]!.setValue('new-password')
    await button(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(harness.router.replace).toHaveBeenCalledWith(
      '/signin?passwordChanged=1',
    )
    wrapper.unmount()
  })

  it('retains password fields when the password change fails', async () => {
    harness.changePassword
      .mockRejectedValueOnce(new Error('current password failed'))
      .mockResolvedValueOnce(undefined)
    const wrapper = mountLayout()
    await button(wrapper, '更改密码').trigger('click')
    await nextTick()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('current-password')
    await inputs[1]!.setValue('new-password')
    await inputs[2]!.setValue('new-password')
    await button(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('input')[0]!.element.value).toBe('current-password')
    expect(harness.router.replace).not.toHaveBeenCalled()
    await button(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(harness.changePassword).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('routes to sign-in even when sign-out rejects after local cleanup', async () => {
    harness.signOut.mockRejectedValue(new Error('network unavailable'))
    const wrapper = mountLayout()
    await button(wrapper, '退出登录').trigger('click')
    await flushPromises()

    expect(harness.router.replace).toHaveBeenCalledWith('/signin')
    wrapper.unmount()
  })
})
