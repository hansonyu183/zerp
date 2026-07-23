import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getErrorMessage } from '@/api/types'
import { registerMenuRoutes, resolveFirstMenuPath } from '@/router/registry'
import { useSessionStore } from '@/stores/session'

export function useSignInViewModel() {
  const route = useRoute()
  const router = useRouter()
  const session = useSessionStore()
  const username = ref('')
  const password = ref('')
  const errorMessage = ref<string | null>(null)
  const submitting = ref(false)

  const canSubmit = computed(
    () => username.value.trim().length > 0 && password.value.length > 0,
  )

  async function submit(): Promise<void> {
    if (!canSubmit.value || submitting.value) return

    submitting.value = true
    errorMessage.value = null
    try {
      await session.signIn({
        username: username.value.trim(),
        password: password.value,
      })
      registerMenuRoutes(router, session.menus)

      const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
      const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//')
      await router.replace(
        safeRedirect ? redirect : resolveFirstMenuPath(session.menus),
      )
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      password.value = ''
      submitting.value = false
    }
  }

  return {
    username,
    password,
    errorMessage,
    submitting,
    canSubmit,
    submit,
  }
}
