import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'

export interface UserProfile {
  id: string
  username: string
  displayName: string
}

export interface MenuEntity {
  entity: string
  title: string
  icon?: string
  order?: number
  actions: string[]
}

export interface MenuDomain {
  domain: string
  title: string
  icon?: string
  order?: number
  children: MenuEntity[]
}

export interface SessionData {
  user: UserProfile
  csrfToken: string
  menus: MenuDomain[]
}

export interface SignInRequest {
  username: string
  password: string
}

export const useSessionStore = defineStore('session', () => {
  const initialized = ref(false)
  const loading = ref(false)
  const user = ref<UserProfile | null>(null)
  const menus = ref<MenuDomain[]>([])
  const csrfToken = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)

  const authenticated = computed(() => user.value !== null)

  function applySession(session: SessionData): void {
    user.value = session.user
    menus.value = session.menus
    csrfToken.value = session.csrfToken
    apiClient.setCsrfToken(session.csrfToken)
    errorMessage.value = null
    initialized.value = true
  }

  function clearSession(): void {
    user.value = null
    menus.value = []
    csrfToken.value = null
    apiClient.setCsrfToken(null)
  }

  async function restore(): Promise<boolean> {
    if (initialized.value) return authenticated.value

    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<SessionData>('auth/user/session', {})
      applySession(data)
      return true
    } catch (error) {
      clearSession()
      errorMessage.value = getErrorMessage(error)
      initialized.value = true
      return false
    } finally {
      loading.value = false
    }
  }

  async function signIn(credentials: SignInRequest): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<SessionData, SignInRequest>(
        'auth/user/signin',
        credentials,
      )
      applySession(data)
    } catch (error) {
      clearSession()
      errorMessage.value = getErrorMessage(error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function signOut(): Promise<void> {
    loading.value = true
    try {
      await apiClient.post<null>('auth/user/signout', {})
    } finally {
      clearSession()
      initialized.value = true
      loading.value = false
    }
  }

  return {
    initialized,
    loading,
    user,
    menus,
    csrfToken,
    errorMessage,
    authenticated,
    restore,
    signIn,
    signOut,
    clearSession,
  }
})
