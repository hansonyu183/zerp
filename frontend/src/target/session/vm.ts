import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  changeTargetPassword,
  getTargetProfile,
  getTargetMenu,
  restoreTargetSession,
  saveTargetProfile,
  signInTarget,
  signOutTarget,
  TargetApiError,
} from '../api.ts'

type SessionData = Awaited<ReturnType<typeof restoreTargetSession>>
type MenuData = Awaited<ReturnType<typeof getTargetMenu>>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败。'
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof TargetApiError && error.errorKey === 'unauthenticated'
}

export const useTargetSession = defineStore('target-session', () => {
  const initialized = ref(false)
  const loading = ref(false)
  const user = ref<SessionData['user'] | null>(null)
  const csrfToken = ref<string | null>(null)
  const permissions = ref<string[]>([])
  const passwordChangeRequired = ref(false)
  const passwordMinLength = ref(12)
  const menu = ref<MenuData | null>(null)
  const error = ref<string | null>(null)
  const menuError = ref<string | null>(null)
  let signInRequest: Promise<void> | null = null

  const authenticated = computed(() => user.value !== null)
  const menus = computed(() => menu.value?.navigation.items ?? [])

  function applySession(data: SessionData): void {
    user.value = data.user
    csrfToken.value = data.csrfToken
    permissions.value = [...data.permissions]
    passwordChangeRequired.value = data.passwordChangeRequired
    passwordMinLength.value = data.passwordMinLength
    initialized.value = true
    error.value = null
  }

  function clear(): void {
    user.value = null
    csrfToken.value = null
    permissions.value = []
    passwordChangeRequired.value = false
    passwordMinLength.value = 12
    menu.value = null
    menuError.value = null
  }

  async function retryMenu(): Promise<void> {
    if (!csrfToken.value) return
    try {
      menu.value = await getTargetMenu(csrfToken.value)
      menuError.value = null
    } catch (cause) {
      if (isUnauthenticated(cause)) {
        clear()
        throw cause
      }
      menuError.value = `菜单加载失败：${errorMessage(cause)}`
    }
  }

  async function restore(options: { force?: boolean } = {}): Promise<boolean> {
    if (initialized.value && !options.force) return authenticated.value
    loading.value = true
    error.value = null
    try {
      applySession(await restoreTargetSession())
      if (!passwordChangeRequired.value) await retryMenu()
      return true
    } catch (cause) {
      clear()
      initialized.value = true
      error.value = isUnauthenticated(cause) ? null : errorMessage(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  function signIn(username: string, password: string): Promise<void> {
    if (signInRequest) return signInRequest
    loading.value = true
    error.value = null
    signInRequest = (async () => {
      try {
        applySession(await signInTarget(username.trim(), password))
        if (!passwordChangeRequired.value) await retryMenu()
      } catch (cause) {
        clear()
        error.value = errorMessage(cause)
        throw cause
      } finally {
        loading.value = false
        signInRequest = null
      }
    })()
    return signInRequest
  }

  async function signOut(): Promise<void> {
    try {
      if (csrfToken.value) await signOutTarget(csrfToken.value)
    } finally {
      clear()
      initialized.value = true
      localStorage.setItem('zerp-session-event', `${Date.now()}:signout`)
    }
  }

  async function getProfile() {
    if (!csrfToken.value) throw new Error('请重新登录。')
    return getTargetProfile(csrfToken.value)
  }

  async function saveProfile(input: {
    displayName: string
    avatarUrl?: string | null
  }) {
    if (!csrfToken.value) throw new Error('请重新登录。')
    const profile = await saveTargetProfile(csrfToken.value, input)
    if (user.value) {
      user.value = {
        ...user.value,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      }
    }
    return profile
  }

  async function changePassword(input: {
    currentPassword: string
    newPassword: string
  }) {
    if (!csrfToken.value) throw new Error('请重新登录。')
    await changeTargetPassword(csrfToken.value, input)
    clear()
    initialized.value = true
  }

  function can(permission: string): boolean {
    return permissions.value.includes(permission)
  }

  function isKnownRoute(path: string): boolean {
    return (
      menu.value?.availableRoutes.some((route) => route.routePath === path) ??
      false
    )
  }

  return {
    initialized,
    loading,
    user,
    csrfToken,
    permissions,
    passwordChangeRequired,
    passwordMinLength,
    menu,
    menus,
    error,
    menuError,
    authenticated,
    retryMenu,
    restore,
    signIn,
    signOut,
    getProfile,
    saveProfile,
    changePassword,
    clear,
    can,
    isKnownRoute,
  }
})
