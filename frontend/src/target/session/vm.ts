import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  changeTargetPassword,
  getTargetProfile,
  restoreTargetSession,
  saveTargetProfile,
  signInTarget,
  signOutTarget,
  TargetApiError,
} from '../api.ts'
import {
  collectNavigationResourceGroups,
  hasNavigationResource,
} from '../navigation/resources.ts'

type SessionData = Awaited<ReturnType<typeof restoreTargetSession>>
type ProfileData = Awaited<ReturnType<typeof getTargetProfile>>

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
  const apiPaths = ref<string[]>([])
  const profile = ref<ProfileData | null>(null)
  const passwordChangeRequired = ref(false)
  const passwordMinLength = ref(12)
  const error = ref<string | null>(null)
  const generation = ref(0)
  let signInRequest: Promise<void> | null = null
  let activeSignInVersion = 0
  let requestVersion = 0
  let profileReadVersion = 0
  let profileWriteVersion = 0
  let sessionTermination: {
    kind: 'signout' | 'password-change'
    request: number
  } | null = null

  const authenticated = computed(() => user.value !== null)
  const resourceGroups = computed(() =>
    authenticated.value && !passwordChangeRequired.value
      ? collectNavigationResourceGroups(apiPaths.value)
      : [],
  )

  function applySession(data: SessionData): void {
    profileReadVersion += 1
    profileWriteVersion += 1
    generation.value += 1
    profile.value = null
    user.value = data.user
    csrfToken.value = data.csrfToken
    apiPaths.value = [...data.apiPaths]
    passwordChangeRequired.value = data.passwordChangeRequired
    passwordMinLength.value = data.passwordMinLength
    initialized.value = true
    error.value = null
  }

  function clearState(): void {
    profileReadVersion += 1
    profileWriteVersion += 1
    generation.value += 1
    user.value = null
    csrfToken.value = null
    apiPaths.value = []
    profile.value = null
    passwordChangeRequired.value = false
    passwordMinLength.value = 12
  }

  function clear(): void {
    requestVersion += 1
    signInRequest = null
    activeSignInVersion = 0
    clearState()
  }

  async function restore(options: { force?: boolean } = {}): Promise<boolean> {
    if (sessionTermination) return false
    if (initialized.value && !options.force) return authenticated.value
    const request = ++requestVersion
    loading.value = true
    error.value = null
    try {
      const data = await restoreTargetSession()
      if (request !== requestVersion) return authenticated.value
      applySession(data)
      return true
    } catch (cause) {
      if (request !== requestVersion) return authenticated.value
      clearState()
      initialized.value = true
      error.value = isUnauthenticated(cause) ? null : errorMessage(cause)
      return false
    } finally {
      if (request === requestVersion) loading.value = false
    }
  }

  function signIn(code: string, password: string): Promise<void> {
    if (sessionTermination)
      return Promise.reject(new Error('当前会话正在结束，请稍后再登录。'))
    if (signInRequest) return signInRequest
    const request = ++requestVersion
    loading.value = true
    error.value = null
    const promise = (async () => {
      try {
        const data = await signInTarget(code.trim(), password)
        if (request !== requestVersion) return
        applySession(data)
      } catch (cause) {
        if (request === requestVersion) clearState()
        if (request === requestVersion) error.value = errorMessage(cause)
        throw cause
      } finally {
        if (request === requestVersion) loading.value = false
        if (activeSignInVersion === request) signInRequest = null
      }
    })()
    activeSignInVersion = request
    signInRequest = promise
    return promise
  }

  async function signOut(): Promise<void> {
    if (sessionTermination?.kind === 'signout') return
    const request = ++requestVersion
    signInRequest = null
    activeSignInVersion = 0
    const termination = { kind: 'signout' as const, request }
    sessionTermination = termination
    const token = csrfToken.value
    clearState()
    initialized.value = true
    loading.value = false
    try {
      if (token) await signOutTarget(token)
    } finally {
      if (sessionTermination === termination) sessionTermination = null
      initialized.value = true
      if (request === requestVersion && typeof localStorage !== 'undefined')
        localStorage.setItem('zerp-session-event', `${Date.now()}:signout`)
    }
  }

  async function getProfile() {
    if (!csrfToken.value) throw new Error('请重新登录。')
    const request = ++profileReadVersion
    const token = csrfToken.value
    const data = await getTargetProfile(token)
    if (
      request === profileReadVersion &&
      token === csrfToken.value &&
      user.value?.id === data.id
    )
      profile.value = data
    return data
  }

  async function saveProfile(input: {
    name: string
    avatarUrl?: string | null
  }) {
    if (!csrfToken.value) throw new Error('请重新登录。')
    const request = ++profileWriteVersion
    const token = csrfToken.value
    const data = await saveTargetProfile(token, input)
    if (
      request === profileWriteVersion &&
      token === csrfToken.value &&
      user.value?.id === data.id
    ) {
      profileReadVersion += 1
      user.value = {
        ...user.value,
        name: data.name,
      }
      profile.value = data
    }
    return data
  }

  async function changePassword(input: {
    currentPassword: string
    newPassword: string
  }): Promise<boolean> {
    if (!csrfToken.value) throw new Error('请重新登录。')
    if (sessionTermination)
      throw new Error('当前会话正在结束，请稍后再修改密码。')
    const request = ++requestVersion
    signInRequest = null
    activeSignInVersion = 0
    const termination = { kind: 'password-change' as const, request }
    sessionTermination = termination
    const token = csrfToken.value
    try {
      await changeTargetPassword(token, input)
      if (request !== requestVersion) return false
      clearState()
      initialized.value = true
      return true
    } finally {
      if (sessionTermination === termination) sessionTermination = null
    }
  }

  function can(permission: string): boolean {
    return apiPaths.value.includes(permission)
  }

  function hasResource(domain: string, entity: string): boolean {
    return (
      authenticated.value &&
      !passwordChangeRequired.value &&
      hasNavigationResource(apiPaths.value, domain, entity)
    )
  }

  return {
    initialized,
    loading,
    user,
    csrfToken,
    apiPaths,
    profile,
    passwordChangeRequired,
    passwordMinLength,
    generation,
    resourceGroups,
    error,
    authenticated,
    restore,
    signIn,
    signOut,
    getProfile,
    saveProfile,
    changePassword,
    clear,
    can,
    hasResource,
  }
})
