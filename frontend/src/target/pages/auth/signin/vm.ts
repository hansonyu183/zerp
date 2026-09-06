import { computed, onScopeDispose, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useTargetSession } from '../../../session/vm.ts'

export function useSignInViewModel() {
  const route = useRoute()
  const router = useRouter()
  const session = useTargetSession()
  const code = ref('')
  const password = ref('')
  const error = ref<string | null>(null)
  const submitting = ref(false)
  onScopeDispose(() => {
    code.value = ''
    password.value = ''
  })
  const success = computed(() =>
    route.query.passwordChanged === '1' ? '密码已更新，请重新登录。' : null,
  )
  const canSubmit = computed(
    () => code.value.trim().length > 0 && password.value.length > 0,
  )

  async function submit(): Promise<void> {
    if (!canSubmit.value || submitting.value) return
    submitting.value = true
    error.value = null
    code.value = code.value.trim()
    try {
      await session.signIn(code.value, password.value)
      if (session.passwordChangeRequired) {
        await router.replace('/change-password')
        return
      }
      const redirect =
        typeof route.query.redirect === 'string' ? route.query.redirect : ''
      const safe = redirect.startsWith('/') && !redirect.startsWith('//')
      await router.replace(safe ? redirect : '/')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '登录失败。'
    } finally {
      password.value = ''
      submitting.value = false
    }
  }

  return { code, password, error, success, submitting, canSubmit, submit }
}
