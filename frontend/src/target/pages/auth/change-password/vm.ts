import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useTargetSession } from '../../../session/vm.ts'

export function useChangePasswordViewModel() {
  const router = useRouter()
  const session = useTargetSession()
  const currentPassword = ref('')
  const newPassword = ref('')
  const confirmPassword = ref('')
  const error = ref<string | null>(null)
  const submitting = ref(false)
  let active = true
  let identityVersion = 0
  let passwordChangePending = false

  function clearPasswords(): void {
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  }

  watch(
    () => session.user?.id ?? null,
    () => {
      if (
        passwordChangePending &&
        session.user === null &&
        session.csrfToken === null
      ) {
        clearPasswords()
        return
      }
      identityVersion += 1
      error.value = null
      submitting.value = false
      clearPasswords()
    },
  )
  onScopeDispose(() => {
    active = false
    passwordChangePending = false
    clearPasswords()
  })
  const validationError = computed(() => {
    if (!currentPassword.value) return '请输入当前密码。'
    if (newPassword.value.length < session.passwordMinLength)
      return `新密码不能少于 ${session.passwordMinLength} 个字符。`
    if (newPassword.value === currentPassword.value)
      return '新密码不能与当前密码相同。'
    if (newPassword.value !== confirmPassword.value)
      return '两次输入的新密码不一致。'
    return null
  })

  async function submit(): Promise<void> {
    if (submitting.value) return
    error.value = validationError.value
    if (error.value) return
    const requestIdentityVersion = identityVersion
    submitting.value = true
    passwordChangePending = true
    try {
      const changed = await session.changePassword({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      })
      if (!active || !changed || requestIdentityVersion !== identityVersion)
        return
      if (session.user || session.csrfToken) return
      clearPasswords()
      await router.replace('/signin?passwordChanged=1')
    } catch (cause) {
      if (active && requestIdentityVersion === identityVersion)
        error.value = cause instanceof Error ? cause.message : '密码修改失败。'
    } finally {
      passwordChangePending = false
      if (active && requestIdentityVersion === identityVersion)
        submitting.value = false
    }
  }

  return {
    currentPassword,
    newPassword,
    confirmPassword,
    error,
    submitting,
    validationError,
    submit,
  }
}
