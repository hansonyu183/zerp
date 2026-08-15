import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@/api/types'
import AppLayout from '@/layouts/AppLayout.vue'
import { useSessionStore } from '@/stores/session'

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
        children: [
          { path: 'home/dashboard', component: { template: '<div />' } },
        ],
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

  it('按后端契约校验资料和密码表单', async () => {
    const router = createTestRouter()
    await router.push('/home/dashboard')
    const session = useSessionStore()
    const getProfile = vi.spyOn(session, 'getProfile').mockResolvedValue({
      id: '1',
      username: 'admin',
      displayName: '管理员',
      avatarUrl: 'https://example.com/avatar.png',
    })
    const updateProfile = vi.spyOn(session, 'updateProfile').mockResolvedValue({
      id: '1',
      username: 'admin',
      displayName: '新名称',
      avatarUrl: null,
    })
    const changePassword = vi
      .spyOn(session, 'changePassword')
      .mockResolvedValue(undefined)

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
            template:
              '<button :disabled="disabled || loading" @click="$emit(`click`)"><slot /></button>',
          },
          VCard: {
            template:
              '<section><slot /><slot name="text" /><slot name="actions" /></section>',
          },
          VCardActions: { template: '<div><slot /></div>' },
          VCardText: { template: '<div><slot /></div>' },
          VDialog: {
            props: ['modelValue'],
            template: '<div v-if="modelValue"><slot /></div>',
          },
          VDivider: { template: '<hr>' },
          VIcon: { template: '<span />' },
          VImg: { template: '<img>' },
          VList: { template: '<div><slot /></div>' },
          VListGroup: {
            template:
              '<div><slot name="activator" :props="{}" /><slot /></div>',
          },
          VListItem: { template: '<button />' },
          VMain: { template: '<main><slot /></main>' },
          VMenu: {
            template:
              '<div><slot name="activator" :props="{}" /><slot /></div>',
          },
          VNavigationDrawer: {
            template: '<nav><slot /><slot name="append" /></nav>',
          },
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

    await (
      wrapper.vm as unknown as { openProfile: () => Promise<void> }
    ).openProfile()
    expect(getProfile).toHaveBeenCalledOnce()
    expect(wrapper.get('input[aria-label="显示名称"]').element.value).toBe(
      '管理员',
    )
    expect(wrapper.get('input[aria-label="头像地址"]').element.value).toBe(
      'https://example.com/avatar.png',
    )

    const profileSaveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '保存')
    await wrapper.get('input[aria-label="显示名称"]').setValue('名'.repeat(129))
    expect(profileSaveButton?.attributes('disabled')).toBeDefined()

    await wrapper.get('input[aria-label="显示名称"]').setValue('新名称')
    await wrapper
      .get('input[aria-label="头像地址"]')
      .setValue('https://user:password@example.com/avatar.png')
    expect(profileSaveButton?.attributes('disabled')).toBeDefined()

    await wrapper
      .get('input[aria-label="头像地址"]')
      .setValue('https://example.com/avatar.png#preview')
    expect(profileSaveButton?.attributes('disabled')).toBeDefined()

    await wrapper
      .get('input[aria-label="头像地址"]')
      .setValue(`https://example.com/${'a'.repeat(501)}`)
    expect(profileSaveButton?.attributes('disabled')).toBeDefined()

    await wrapper
      .get('input[aria-label="头像地址"]')
      .setValue('https:example.com/avatar.png')
    expect(profileSaveButton?.attributes('disabled')).toBeDefined()

    await wrapper.get('input[aria-label="显示名称"]').setValue(' 新名称 ')
    await wrapper.get('input[aria-label="头像地址"]').setValue('')
    expect(profileSaveButton?.attributes('disabled')).toBeUndefined()
    await (
      wrapper.vm as unknown as { saveProfile: () => Promise<void> }
    ).saveProfile()
    expect(updateProfile).toHaveBeenCalledWith({
      displayName: '新名称',
      avatarUrl: null,
    })

    await (wrapper.vm as unknown as { openPassword: () => void }).openPassword()

    const updateButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '更新密码')
    const topbarButtons = wrapper.get('header').findAll('button')
    const feedbackIndex = topbarButtons.findIndex(
      (button) => button.attributes('aria-label') === '提交反馈',
    )
    const themeIndex = topbarButtons.findIndex(
      (button) => button.attributes('aria-label') === '切换深色模式',
    )
    expect(feedbackIndex).toBeGreaterThanOrEqual(0)
    expect(themeIndex).toBeGreaterThan(feedbackIndex)
    expect(updateButton?.attributes('disabled')).toBeDefined()
    expect(
      wrapper.get('input[aria-label="当前密码"]').attributes('autocomplete'),
    ).toBe('current-password')
    expect(
      wrapper.get('input[aria-label="新密码"]').attributes('autocomplete'),
    ).toBe('new-password')
    expect(
      wrapper.get('input[aria-label="确认新密码"]').attributes('autocomplete'),
    ).toBe('new-password')

    await wrapper.get('input[aria-label="当前密码"]').setValue('old-password')
    await wrapper.get('input[aria-label="新密码"]').setValue('old-password')
    await wrapper.get('input[aria-label="确认新密码"]').setValue('old-password')
    expect(updateButton?.attributes('disabled')).toBeDefined()

    await wrapper.get('input[aria-label="新密码"]').setValue('New-password-2!')
    await wrapper
      .get('input[aria-label="确认新密码"]')
      .setValue('New-password-2!')
    expect(updateButton?.attributes('disabled')).toBeUndefined()

    await updateButton?.trigger('click')
    await flushPromises()

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'New-password-2!',
    })
    expect(router.currentRoute.value).toMatchObject({
      name: 'signin',
      query: { passwordChanged: '1' },
    })
  })

  it('显示菜单加载失败并提供重新加载入口', async () => {
    const router = createTestRouter()
    await router.push('/home/dashboard')
    const session = useSessionStore()
    session.menuErrorMessage = '菜单加载失败：网络连接失败，请检查网络后重试。'
    const retryMenu = vi.spyOn(session, 'retryMenu').mockResolvedValue()

    const wrapper = mount(AppLayout, {
      shallow: true,
      global: {
        plugins: [router],
        stubs: {
          AppSnackbar: {
            props: ['message', 'actionLabel'],
            emits: ['action'],
            template: `
              <div v-if="message">
                <span>{{ message }}</span>
                <button v-if="actionLabel" @click="$emit('action')">
                  {{ actionLabel }}
                </button>
              </div>
            `,
          },
        },
      },
    })

    expect(wrapper.text()).toContain('菜单加载失败')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(retryMenu).toHaveBeenCalledOnce()
  })

  it('重新加载菜单发现会话失效时返回登录页', async () => {
    const router = createTestRouter()
    await router.push('/home/dashboard')
    const session = useSessionStore()
    session.menuErrorMessage = '菜单加载失败：请重试。'
    vi.spyOn(session, 'retryMenu').mockImplementation(async () => {
      session.clearSession()
      throw new ApiError('business', '登录状态已失效', { code: 1001 })
    })

    const wrapper = mount(AppLayout, {
      shallow: true,
      global: {
        plugins: [router],
        stubs: {
          AppSnackbar: {
            props: ['message', 'actionLabel'],
            emits: ['action'],
            template:
              '<button v-if="message" @click="$emit(`action`)">{{ actionLabel }}</button>',
          },
        },
      },
    })

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value).toMatchObject({
      name: 'signin',
      query: { redirect: '/home/dashboard' },
    })
  })
})
