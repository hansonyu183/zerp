import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useTargetSession } from '../../../session/vm.ts'

export function useSignInViewModel() {
  const route = useRoute()
  const router = useRouter()
  const session = useTargetSession()
  const username = ref('')
  const password = ref('')
  const error = ref<string | null>(null)
  const submitting = ref(false)
  const success = computed(() =>
    route.query.passwordChanged === '1' ? '密码已更新，请重新登录。' : null,
  )
  const canSubmit = computed(
    () => username.value.trim().length > 0 && password.value.length > 0,
  )

  async function submit(): Promise<void> {
    if (!canSubmit.value || submitting.value) return
    submitting.value = true
    error.value = null
    username.value = username.value.trim()
    try {
      await session.signIn(username.value, password.value)
      if (session.passwordChangeRequired) {
        await router.replace('/change-password')
        return
      }
      const redirect =
        typeof route.query.redirect === 'string' ? route.query.redirect : ''
      const safe = redirect.startsWith('/') && !redirect.startsWith('//')
      await router.replace(safe ? redirect : '/home/dashboard')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '登录失败。'
    } finally {
      password.value = ''
      submitting.value = false
    }
  }

  return { username, password, error, success, submitting, canSubmit, submit }
}
