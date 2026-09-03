import { computed, onMounted, ref } from 'vue'

import {
  queryTargetUsers,
  restoreTargetSession,
  signInTarget,
  TargetApiError,
} from './api.ts'

export function useTargetProbe() {
  const username = ref('')
  const password = ref('')
  const csrfToken = ref('')
  const message = ref('正在恢复会话…')
  const requestId = ref('')
  const users = ref<Awaited<ReturnType<typeof queryTargetUsers>>['items']>([])
  const signedIn = computed(() => csrfToken.value.length > 0)

  async function restoreSession() {
    try {
      const session = await restoreTargetSession()
      csrfToken.value = session.csrfToken
      message.value = `当前用户：${session.user.displayName}`
    } catch (error) {
      message.value = targetErrorMessage(error, '请登录。', '请登录。')
      requestId.value = targetErrorRequestId(error)
    }
  }

  async function signIn() {
    try {
      const session = await signInTarget(username.value, password.value)
      csrfToken.value = session.csrfToken
      message.value = `当前用户：${session.user.displayName}`
    } catch (error) {
      message.value = targetErrorMessage(
        error,
        '登录失败。',
        '用户名或密码错误。',
      )
      requestId.value = targetErrorRequestId(error)
    }
  }

  async function queryUsers() {
    try {
      const page = await queryTargetUsers(csrfToken.value)
      users.value = page.items
      message.value = `已查询 ${page.items.length} 位用户。`
    } catch (error) {
      message.value = targetErrorMessage(error, '查询失败。', '请重新登录。')
      requestId.value = targetErrorRequestId(error)
    }
  }

  onMounted(() => void restoreSession())
  return {
    username,
    password,
    message,
    requestId,
    users,
    signedIn,
    signIn,
    queryUsers,
  }
}

function targetErrorMessage(
  error: unknown,
  fallback: string,
  unauthenticated: string,
): string {
  if (!(error instanceof TargetApiError)) return fallback
  if (error.errorKey === 'unauthenticated') return unauthenticated
  if (error.errorKey === 'forbidden') return '无权执行此操作。'
  return error.message || fallback
}

function targetErrorRequestId(error: unknown): string {
  return error instanceof TargetApiError ? error.requestId : ''
}
