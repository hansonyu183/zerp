import { effectScope, nextTick, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  session: undefined as any,
}))

vi.mock('vue-router', () => ({ useRouter: () => harness.router }))
vi.mock('@/target/session/vm.ts', () => ({
  useTargetSession: () => harness.session,
}))

import { useChangePasswordViewModel } from '@/target/pages/auth/change-password/vm.ts'

function deferred<T>() {
  let resolve: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve: resolve! }
}

function createViewModel() {
  const scope = effectScope()
  const vm = scope.run(useChangePasswordViewModel)
  if (!vm) throw new Error('failed to create change-password view model')
  return { scope, vm }
}

function fillValidPasswords(vm: ReturnType<typeof useChangePasswordViewModel>) {
  vm.currentPassword.value = 'current-password'
  vm.newPassword.value = 'new-password'
  vm.confirmPassword.value = 'new-password'
}

describe('forced password change view model', () => {
  beforeEach(() => {
    harness.router.replace.mockReset()
    harness.session = reactive({
      user: { id: 'user-1', code: 'tester', name: '测试用户' },
      csrfToken: 'csrf-token',
      passwordMinLength: 12,
      changePassword: vi.fn(),
    })
  })

  it('retains inputs after a failure and permits a successful retry', async () => {
    harness.session.changePassword
      .mockRejectedValueOnce(new Error('当前密码不正确'))
      .mockImplementationOnce(async () => {
        harness.session.user = null
        harness.session.csrfToken = null
        return true
      })
    const { scope, vm } = createViewModel()
    fillValidPasswords(vm)

    await vm.submit()
    expect(vm.error.value).toBe('当前密码不正确')
    expect(vm.currentPassword.value).toBe('current-password')
    expect(vm.newPassword.value).toBe('new-password')
    expect(vm.confirmPassword.value).toBe('new-password')

    await vm.submit()
    expect(harness.session.changePassword).toHaveBeenCalledTimes(2)
    expect(harness.router.replace).toHaveBeenCalledWith(
      '/signin?passwordChanged=1',
    )
    expect(vm.currentPassword.value).toBe('')
    expect(vm.newPassword.value).toBe('')
    expect(vm.confirmPassword.value).toBe('')
    scope.stop()
  })

  it('clears fields and does not navigate when the view scope is disposed', async () => {
    const passwordChange = deferred<boolean>()
    harness.session.changePassword.mockReturnValue(passwordChange.promise)
    const { scope, vm } = createViewModel()
    fillValidPasswords(vm)

    const submitting = vm.submit()
    scope.stop()
    passwordChange.resolve(true)
    await submitting

    expect(vm.currentPassword.value).toBe('')
    expect(vm.newPassword.value).toBe('')
    expect(vm.confirmPassword.value).toBe('')
    expect(harness.router.replace).not.toHaveBeenCalled()
  })

  it('clears fields and ignores a late result after the account changes', async () => {
    const passwordChange = deferred<boolean>()
    harness.session.changePassword.mockReturnValue(passwordChange.promise)
    const { scope, vm } = createViewModel()
    fillValidPasswords(vm)

    const submitting = vm.submit()
    harness.session.user = { id: 'user-2', code: 'other', name: '另一位用户' }
    harness.session.csrfToken = 'csrf-token-2'
    await nextTick()
    passwordChange.resolve(true)
    await submitting

    expect(vm.currentPassword.value).toBe('')
    expect(vm.newPassword.value).toBe('')
    expect(vm.confirmPassword.value).toBe('')
    expect(harness.router.replace).not.toHaveBeenCalled()
    scope.stop()
  })
})
