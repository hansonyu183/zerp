import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

const runeLength = (value: string) => Array.from(value).length

export function useChangePasswordViewModel() {
  const router = useRouter()
  const session = useSessionStore()
  const currentPassword = ref('')
  const newPassword = ref('')
  const errorMessage = ref<string | null>(null)
  const submitting = ref(false)
  const signingOut = ref(false)
  const newPasswordValid = computed(
    () =>
      runeLength(newPassword.value) >= session.passwordMinLength &&
      runeLength(newPassword.value) <= 256 &&
      /[a-z]/.test(newPassword.value) &&
      /[A-Z]/.test(newPassword.value) &&
      /\d/.test(newPassword.value) &&
      /[^A-Za-z0-9]/.test(newPassword.value),
  )
  const passwordHint = computed(
    () =>
      `${session.passwordMinLength} 至 256 个字符，包含大小写字母、数字和符号`,
  )
  const canSubmit = computed(
    () =>
      currentPassword.value.length > 0 &&
      newPasswordValid.value &&
      !submitting.value,
  )
  async function submit(): Promise<void> {
    if (!canSubmit.value) return
    submitting.value = true
    errorMessage.value = null
    try {
      await session.changePassword({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      })
      await router.replace({ name: 'signin', query: { passwordChanged: '1' } })
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      currentPassword.value = ''
      newPassword.value = ''
      submitting.value = false
    }
  }
  async function signOut(): Promise<void> {
    if (signingOut.value) return
    signingOut.value = true
    try {
      await session.signOut()
      await router.replace('/signin')
    } finally {
      signingOut.value = false
    }
  }
  return {
    currentPassword,
    newPassword,
    errorMessage,
    submitting,
    signingOut,
    canSubmit,
    passwordHint,
    submit,
    signOut,
  }
}
