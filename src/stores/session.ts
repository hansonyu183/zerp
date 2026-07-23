import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiClient } from '@/api/client'
import { ApiError, getErrorMessage } from '@/api/types'

const UNAUTHENTICATED_CODE = 1001

function isUnauthenticatedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.kind === 'business' &&
    (error.code === UNAUTHENTICATED_CODE ||
      error.code === String(UNAUTHENTICATED_CODE))
  )
}

export interface UserProfile {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
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
  menus?: unknown
}

export interface SignInRequest {
  username: string
  password: string
}

export function normalizeMenus(value: unknown): MenuDomain[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((candidate): MenuDomain[] => {
    if (!candidate || typeof candidate !== 'object') return []

    const domain = candidate as Record<string, unknown>
    if (
      typeof domain.domain !== 'string' ||
      domain.domain === 'app' ||
      typeof domain.title !== 'string' ||
      !Array.isArray(domain.children)
    ) {
      return []
    }

    const children = domain.children.flatMap((candidateEntity): MenuEntity[] => {
      if (!candidateEntity || typeof candidateEntity !== 'object') return []

      const entity = candidateEntity as Record<string, unknown>
      if (typeof entity.entity !== 'string' || typeof entity.title !== 'string') {
        return []
      }

      return [{
        entity: entity.entity,
        title: entity.title,
        ...(typeof entity.icon === 'string' ? { icon: entity.icon } : {}),
        ...(typeof entity.order === 'number' ? { order: entity.order } : {}),
        actions: Array.isArray(entity.actions)
          ? entity.actions.filter((action): action is string => typeof action === 'string')
          : [],
      }]
    })

    return [{
      domain: domain.domain,
      title: domain.title,
      ...(typeof domain.icon === 'string' ? { icon: domain.icon } : {}),
      ...(typeof domain.order === 'number' ? { order: domain.order } : {}),
      children,
    }]
  })
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
    menus.value = normalizeMenus(session.menus)
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
    menus,
    csrfToken,
    errorMessage,
    authenticated,
    restore,
    signIn,
    signOut,
    updateProfile,
    changePassword,
    clearSession,
  }
})
