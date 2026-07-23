import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSignInViewModel } from '@/pages/auth/user/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({
    replace: vi.fn(),
  }),
}))

describe('useSignInViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('首次进入登录页不显示已有会话错误', () => {
    const session = useSessionStore()
    session.errorMessage = 'session expired'

    const vm = useSignInViewModel()

    expect(vm.errorMessage.value).toBeNull()
  })
})
