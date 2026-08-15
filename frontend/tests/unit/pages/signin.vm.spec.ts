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

  it('登录成功后规范化用户名、清空密码并返回完整安全深链', async () => {
    routerState.query = { redirect: '/bob/customer?tab=history#version-2' }
    const session = useSessionStore()
    vi.spyOn(session, 'signIn').mockResolvedValue()
    const vm = useSignInViewModel()
    vm.username.value = '  tester  '
    vm.password.value = 'password'

    await vm.submit()

    expect(session.signIn).toHaveBeenCalledWith({
      username: 'tester',
      password: 'password',
    })
    expect(vm.username.value).toBe('tester')
    expect(vm.password.value).toBe('')
    expect(replace).toHaveBeenCalledWith('/bob/customer?tab=history#version-2')
  })

  it.each(['//external.example.com', 'https://external.example.com'])(
    '登录成功后拒绝无效跳转 %s 并回到工作台',
    async (redirect) => {
      routerState.query = { redirect }
      const session = useSessionStore()
      vi.spyOn(session, 'signIn').mockResolvedValue()
      const vm = useSignInViewModel()
      vm.username.value = 'tester'
      vm.password.value = 'password'

      await vm.submit()

      expect(replace).toHaveBeenCalledWith('/home/dashboard')
    },
  )

  it('登录失败后清空密码并保留已规范化的用户名', async () => {
    const session = useSessionStore()
    vi.spyOn(session, 'signIn').mockRejectedValue(new Error('密码错误。'))
    const vm = useSignInViewModel()
    vm.username.value = '  tester  '
    vm.password.value = 'wrong-password'

    await vm.submit()

    expect(vm.username.value).toBe('tester')
    expect(vm.password.value).toBe('')
    expect(vm.errorMessage.value).toBe('密码错误。')
  })

  it('提交期间忽略重复提交', async () => {
    let finishSignIn: (() => void) | undefined
    const session = useSessionStore()
    const signIn = vi.spyOn(session, 'signIn').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSignIn = resolve
        }),
    )
    const vm = useSignInViewModel()
    vm.username.value = 'tester'
    vm.password.value = 'password'

    const firstSubmit = vm.submit()
    const secondSubmit = vm.submit()

    expect(signIn).toHaveBeenCalledOnce()
    finishSignIn?.()
    await Promise.all([firstSubmit, secondSubmit])
  })
})
