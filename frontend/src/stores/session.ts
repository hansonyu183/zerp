import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiClient, type ApiPostRequest } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getMenu, type MenuData } from '@/api/menu'
import { ApiError, getErrorMessage } from '@/api/types'
import {
  buildMenus,
  buildServerMenus,
  hasRegisteredPage,
  normalizePermissions,
  type MenuDomain,
  type MenuEntity,
} from '@/router/registry'

function isUnauthenticatedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.kind === 'business' &&
    error.errorKey === 'unauthenticated'
  )
}

export type { MenuDomain, MenuEntity }

export type UserProfile = components['schemas']['SessionUser']
export type ProfileView = components['schemas']['ProfileView']
export type SaveProfileRequest = Required<
  ApiPostRequest<'app/user/profile'>
>
export type SessionData = components['schemas']['SessionData']
export type SignInRequest = ApiPostRequest<'app/user/signin'>

export const useSessionStore = defineStore('session', () => {
  const initialized = ref(false)
  const loading = ref(false)
  const user = ref<UserProfile | null>(null)
  const passwordChangeRequired = ref(false)
  const passwordMinLength = ref(12)
  const permissions = ref<string[]>([])
  const csrfToken = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const menuErrorMessage = ref<string | null>(null)
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

  function isKnownRoutePath(path: string): boolean {
    if (menuData.value) {
      return menuData.value.availableRoutes.some(
        (route) => route.routePath === path,
      )
    }

    const match = path.match(/^\/([^/]+)\/([^/]+)$/)
    return match ? hasRegisteredPage(match[1] ?? '', match[2] ?? '') : false
  }

  function applySession(session: SessionData): void {
    user.value = session.user
    passwordChangeRequired.value = session.passwordChangeRequired
    passwordMinLength.value = session.passwordMinLength
    permissions.value = normalizePermissions(session.permissions)
    csrfToken.value = session.csrfToken
    apiClient.setCsrfToken(session.csrfToken)
    errorMessage.value = null
    menuErrorMessage.value = null
    menuData.value = null
    initialized.value = true
  }

  function applyMenuData(data: MenuData): void {
    menuData.value = data
  }

  async function loadMenu(): Promise<MenuData> {
    const { data } = await getMenu()
    applyMenuData(data)
    menuErrorMessage.value = null
    return data
  }

  async function retryMenu(): Promise<void> {
    try {
      await loadMenu()
    } catch (error) {
      if (isUnauthenticatedError(error)) {
        clearSession()
        initialized.value = true
        throw error
      }
      menuErrorMessage.value = `菜单加载失败：${getErrorMessage(error)}`
    }
  }

  function clearSession(): void {
    user.value = null
    permissions.value = []
    csrfToken.value = null
    passwordChangeRequired.value = false
    passwordMinLength.value = 12
    menuData.value = null
    menuErrorMessage.value = null
    apiClient.setCsrfToken(null)
  }

  async function restore(options: { force?: boolean } = {}): Promise<boolean> {
    if (initialized.value && !options.force) return authenticated.value

    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('app/user/session', {})
      applySession(data)
      if (!passwordChangeRequired.value) await retryMenu()
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
      const { data } = await apiClient.postContract(
        'app/user/signin',
        credentials,
      )
      applySession(data)
      if (!passwordChangeRequired.value) await retryMenu()
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
      await apiClient.postContract('app/user/signout', {})
    } finally {
      clearSession()
      initialized.value = true
      loading.value = false
    }
  }

  async function getProfile(): Promise<ProfileView> {
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('app/user/profile', {})
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
      const { data } = await apiClient.postContract(
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
      await apiClient.postContract(
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
    passwordChangeRequired,
    passwordMinLength,
    permissions,
    menus,
    routeMenus,
    menuData,
    csrfToken,
    errorMessage,
    menuErrorMessage,
    authenticated,
    can,
    isKnownRoutePath,
    applyMenuData,
    retryMenu,
    restore,
    signIn,
    signOut,
    getProfile,
    updateProfile,
    changePassword,
    clearSession,
  }
})
