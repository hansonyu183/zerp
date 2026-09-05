import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createTargetRouter } from '@/target/router'

describe('formal target router', () => {
  it('registers the restored shell pages and resolves unknown paths to 404', () => {
    const router = createTargetRouter(createMemoryHistory())

    expect(router.resolve('/signin').name).toBe('signin')
    expect(router.resolve('/change-password').name).toBe('change-password')
    expect(router.resolve('/home/dashboard').name).toBe('page:home/dashboard')
    expect(router.resolve('/app/menu').name).toBe('page:app/menu')
    expect(router.resolve('/missing-page').name).toBe('not-found')
  })

  it('records a use-case key on every user-facing route', () => {
    const router = createTargetRouter(createMemoryHistory())
    const userFacing = router
      .getRoutes()
      .filter(
        (route) => route.name !== 'app' && route.name !== 'app-home-redirect',
      )

    expect(userFacing).not.toHaveLength(0)
    for (const route of userFacing) {
      expect(route.meta.useCaseKey, String(route.name)).toMatch(
        /^[a-z0-9-]+\/[a-z0-9-]+$/,
      )
    }
  })
})
