import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSignInViewModel } from '@/pages/auth/user/vm'
import { useSessionStore } from '@/stores/session'

const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}))
const replace = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routerState.query }),
  useRouter: () => ({
    replace,
  }),
}))

describe('useSignInViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    routerState.query = {}
    replace.mockReset()
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

  it('登录成功后优先返回安全的原始页面', async () => {
    routerState.query = { redirect: '/bob/customer' }
    const session = useSessionStore()
    vi.spyOn(session, 'signIn').mockResolvedValue()
    const vm = useSignInViewModel()
    vm.username.value = 'tester'
    vm.password.value = 'password'

    await vm.submit()

    expect(session.signIn).toHaveBeenCalledWith({
      username: 'tester',
      password: 'password',
    })
    expect(replace).toHaveBeenCalledWith('/bob/customer')
  })

  it('登录成功后对无效跳转回到工作台', async () => {
    routerState.query = { redirect: '//external.example.com' }
    const session = useSessionStore()
    vi.spyOn(session, 'signIn').mockResolvedValue()
    const vm = useSignInViewModel()
    vm.username.value = 'tester'
    vm.password.value = 'password'

    await vm.submit()

    expect(replace).toHaveBeenCalledWith('/home/dashboard')
  })
})
