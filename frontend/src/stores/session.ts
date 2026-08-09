import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiClient } from '@/api/client'
import { getMenu, type MenuData } from '@/api/menu'
import { ApiError, getErrorMessage } from '@/api/types'
import {
  buildMenus,
  buildServerMenus,
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
  avatarUrl?: string | null
}

export interface ProfileView extends UserProfile {
  passwordChangedAt?: string
  revision?: number
}

export interface SaveProfileRequest {
  displayName: string
  avatarUrl: string | null
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
  const menuData = ref<MenuData | null>(null)

  const authenticated = computed(() => user.value !== null)
  const menus = computed<MenuDomain[]>(() =>
    buildServerMenus(
      menuData.value?.navigation?.items ?? [],
      permissions.value,
    ),
  )
  const routeMenus = computed<MenuDomain[]>(() => {
    const authorizedMenus = buildMenus(permissions.value)
    const registeredRouteKeys = new Set(
      authorizedMenus.flatMap((domain) =>
        domain.children.map(
          (entity) => entity.routeKey ?? `${domain.domain}/${entity.entity}`,
        ),
      ),
    )
    const navigationWorkflowMenus = menus.value.flatMap((domain) =>
      domain.children
        .filter(
          (entity) =>
            entity.routeKey?.startsWith('wfl/') &&
            entity.actions.length > 0 &&
            !registeredRouteKeys.has(entity.routeKey),
        )
        .map((entity) => ({ ...domain, children: [entity] })),
    )
    return [...authorizedMenus, ...navigationWorkflowMenus]
  })
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

  function applyMenuData(data: MenuData): void {
    menuData.value = data
  }

  async function refreshMenu(): Promise<MenuData> {
    const { data } = await getMenu()
    applyMenuData(data)
    errorMessage.value = null
    return data
  }

  async function refreshMenuWithoutLosingSession(): Promise<void> {
    try {
      await refreshMenu()
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        clearSession()
        initialized.value = true
        throw error
      }
      errorMessage.value = `菜单加载失败：${getErrorMessage(error)}`
    }
  }

  function clearSession(): void {
    user.value = null
    permissions.value = []
    csrfToken.value = null
    menuData.value = null
    apiClient.setCsrfToken(null)
  }

  async function restore(options: { force?: boolean } = {}): Promise<boolean> {
    if (initialized.value && !options.force) return authenticated.value

    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<SessionData>('app/user/session', {})
      applySession(data)
      await refreshMenuWithoutLosingSession()
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
      await refreshMenuWithoutLosingSession()
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

  async function getProfile(): Promise<ProfileView> {
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<ProfileView>('app/user/profile', {})
      return data
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      throw error
    }
  }

  async function updateProfile(
    profile: SaveProfileRequest,
  ): Promise<ProfileView> {
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<ProfileView, SaveProfileRequest>(
        'app/user/profile',
        profile,
      )
      user.value = {
        id: data.id,
        username: data.username,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl ?? null,
      }
      return data
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      throw error
    }
  }

  async function changePassword(passwords: {
    currentPassword: string
    newPassword: string
  }): Promise<void> {
    errorMessage.value = null
    try {
      await apiClient.post<null, typeof passwords>(
        'app/user/change-password',
        passwords,
      )
      clearSession()
      initialized.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      throw error
    }
  }

  return {
    initialized,
    loading,
    user,
    permissions,
    menus,
    routeMenus,
    menuData,
    csrfToken,
    errorMessage,
    authenticated,
    can,
    applyMenuData,
    refreshMenu,
    restore,
    signIn,
    signOut,
    getProfile,
    updateProfile,
    changePassword,
    clearSession,
  }
})
