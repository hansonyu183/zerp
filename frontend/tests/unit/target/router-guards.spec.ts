import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createSessionGuard } from '@/target/router/guards.ts'
import { createTargetRouter } from '@/target/router/index.ts'
import { useTargetSession } from '@/target/session/vm.ts'

describe('target router session guard', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function authenticatedSession(apiPaths: string[] = []) {
    const session = useTargetSession()
    session.initialized = true
    session.user = { id: 'u1', code: 'tester', name: '测试' }
    session.apiPaths = apiPaths
    return session
  }

  it('preserves the complete same-site deep link for unauthenticated users', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = useTargetSession()
    vi.spyOn(session, 'restore').mockImplementation(async () => {
      session.initialized = true
      return false
    })
    router.beforeEach(createSessionGuard(session))

    await router.push('/bob/customer?tab=history#version-2')
    expect(router.currentRoute.value).toMatchObject({
      name: 'signin',
      query: { redirect: '/bob/customer?tab=history#version-2' },
    })
  })

  it('restricts forced-password sessions to the change-password page', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = authenticatedSession(['/bob/customer/query'])
    session.passwordChangeRequired = true
    router.beforeEach(createSessionGuard(session))

    await router.push('/bob/customer')
    expect(router.currentRoute.value.name).toBe('change-password')
  })

  it('admits a resource with any exact action and rejects one with none', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = authenticatedSession(['/app/user/create'])
    router.beforeEach(createSessionGuard(session))

    await router.push('/app/user')
    expect(router.currentRoute.value.name).toBe('resource-host')

    await router.push('/bob/customer')
    expect(router.currentRoute.value.name).toBe('forbidden')
  })

  it('uses refreshed Session permissions for later direct navigation', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = authenticatedSession(['/dcl/customer/query'])
    router.beforeEach(createSessionGuard(session))

    await router.push('/dcl/customer')
    expect(router.currentRoute.value.name).toBe('resource-host')

    session.apiPaths = []
    await router.push('/')
    await router.push('/dcl/customer')
    expect(router.currentRoute.value.name).toBe('forbidden')
  })
})
