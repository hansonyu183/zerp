import { computed, ref } from 'vue'
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
    submitting.value = true
    try {
      await session.changePassword({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      })
      await router.replace('/signin?passwordChanged=1')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '密码修改失败。'
    } finally {
      currentPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
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
