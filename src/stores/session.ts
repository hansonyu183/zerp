import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiClient } from '@/api/client'
import { ApiError, getErrorMessage } from '@/api/types'
import {
  buildMenus,
  normalizePermissions,
  type MenuDomain,
  type MenuEntity,
} from '@/router/registry'

const UNAUTHENTICATED_CODE = 1001

function isUnauthenticatedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.kind === 'business' &&
    (error.code === UNAUTHENTICATED_CODE ||
      error.code === String(UNAUTHENTICATED_CODE))
  )
}

export type { MenuDomain, MenuEntity }

export interface UserProfile {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
}

export interface SessionData {
  user: UserProfile
  csrfToken: string
  permissions?: unknown
}

export interface SignInRequest {
  username: string
  password: string
}

export const useSessionStore = defineStore('session', () => {
  const initialized = ref(false)
  const loading = ref(false)
  const user = ref<UserProfile | null>(null)
  const permissions = ref<string[]>([])
  const csrfToken = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)

  const authenticated = computed(() => user.value !== null)
  const menus = computed<MenuDomain[]>(() => buildMenus(permissions.value))
  const permissionSet = computed(() => new Set(permissions.value))

  function can(permissionPath: string): boolean {
    return permissionSet.value.has(permissionPath)
  }

  function applySession(session: SessionData): void {
    user.value = session.user
    permissions.value = normalizePermissions(session.permissions)
    csrfToken.value = session.csrfToken
    apiClient.setCsrfToken(session.csrfToken)
    errorMessage.value = null
    initialized.value = true
  }

  function clearSession(): void {
    user.value = null
    permissions.value = []
    csrfToken.value = null
    apiClient.setCsrfToken(null)
  }

  async function restore(options: { force?: boolean } = {}): Promise<boolean> {
    if (initialized.value && !options.force) return authenticated.value

    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<SessionData>('app/user/session', {})
      applySession(data)
      return true
    } catch (error) {
      clearSession()
      errorMessage.value = isUnauthenticatedError(error)
        ? null
        : getErrorMessage(error)
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
        'app/user/signin',
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
      await apiClient.post<null>('app/user/signout', {})
    } finally {
      clearSession()
      initialized.value = true
      loading.value = false
    }
  }

  async function updateProfile(profile: {
    displayName: string
    avatarUrl?: string
  }): Promise<void> {
    const { data } = await apiClient.post<UserProfile, typeof profile>(
      'app/user/profile',
      profile,
    )
    user.value = data
  }

  async function changePassword(passwords: {
    currentPassword: string
    newPassword: string
  }): Promise<void> {
    await apiClient.post<null, typeof passwords>('app/user/password', passwords)
  }

  return {
    initialized,
    loading,
    user,
    permissions,
    menus,
    csrfToken,
    errorMessage,
    authenticated,
    can,
    restore,
    signIn,
    signOut,
    updateProfile,
    changePassword,
    clearSession,
  }
})
