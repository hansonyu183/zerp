import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSignInViewModel } from '@/pages/auth/user/vm'
import { useSessionStore } from '@/stores/session'

const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routerState.query }),
  useRouter: () => ({
    replace: vi.fn(),
  }),
}))

describe('useSignInViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    routerState.query = {}
  })

  it('首次进入登录页不显示已有会话错误', () => {
    const session = useSessionStore()
    session.errorMessage = 'session expired'

    const vm = useSignInViewModel()

    expect(vm.errorMessage.value).toBeNull()
  })

  it('改密跳转后显示重新登录提示', () => {
    routerState.query = { passwordChanged: '1' }

    const vm = useSignInViewModel()

    expect(vm.successMessage.value).toBe('密码已更新，请重新登录。')
  })
})
