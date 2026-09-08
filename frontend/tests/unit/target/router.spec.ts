import { createMemoryHistory } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { createTargetRouter } from '@/target/router'

describe('target router', () => {
  it('routes every two-part business resource through the common Host', () => {
    const router = createTargetRouter(createMemoryHistory())

    for (const path of [
      '/app/user',
      '/bob/customer',
      '/wfl/process-definition',
    ]) {
      const route = router.resolve(path)
      expect(route.name).toBe('resource-host')
      expect(route.meta).toMatchObject({
        requiresAuth: true,
        title: '业务功能',
        useCaseKey: 'app/navigation',
      })
    }
  })

  it('keeps Session pages static and resolves non-resource paths to 404', () => {
    const router = createTargetRouter(createMemoryHistory())

    expect(router.resolve('/').name).toBe('resource-home')
    expect(router.resolve('/signin').name).toBe('signin')
    expect(router.resolve('/change-password').name).toBe('change-password')
    expect(router.resolve('/missing-page').name).toBe('not-found')
  })

  it('records a use-case key on every user-facing route', () => {
    const router = createTargetRouter(createMemoryHistory())
    const userFacing = router
      .getRoutes()
      .filter((route) => route.name !== 'app')

    expect(userFacing).not.toHaveLength(0)
    for (const route of userFacing) {
      expect(route.meta.useCaseKey, String(route.name)).toMatch(
        /^[a-z0-9-]+\/[a-z0-9-]+$/,
      )
    }
  })
})
