import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { vouEntities } from '@zerp/model'

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

  it('registers the warehouse, seven ordinary and two dedicated DCL archive routes', () => {
    const router = createTargetRouter(createMemoryHistory())

    for (const entity of [
      'warehouse',
      'operating-entity',
      'vehicle',
      'fund-account',
      'product',
      'employee',
      'supplier',
      'customer',
      'other-unit',
      'sales-partner',
    ]) {
      const route = router.resolve(`/dcl/${entity}`)
      expect(route.name).toBe(`page:dcl/${entity}`)
      expect(route.meta.requiredPermission).toBe(`/dcl/${entity}/query`)
      expect(route.meta.useCaseKey).toBe(`dcl/${entity}`)
    }
  })

  it('registers every VOU entity as an authenticated permission-scoped use case', () => {
    const router = createTargetRouter(createMemoryHistory())

    for (const entity of vouEntities) {
      const route = router.resolve(`/vou/${entity}`)
      expect(route.name).toBe(`page:vou/${entity}`)
      expect(route.meta.requiresAuth).toBe(true)
      expect(route.meta.requiredPermission).toBe(`/vou/${entity}/query`)
      expect(route.meta.useCaseKey).toBe(`vou/${entity}`)
      expect(route.matched.at(-1)?.components?.default).toBeTruthy()
    }
  })

  it('registers ACC, dedicated DCL, static WFL and contract-bounded dynamic routes', () => {
    const router = createTargetRouter(createMemoryHistory())

    for (const [path, permission] of [
      ['/acc/book', '/acc/book/query'],
      ['/acc/subject', '/acc/subject/query'],
      ['/acc/mapping', '/acc/mapping/query'],
      ['/acc/opening', '/acc/opening/query'],
      ['/acc/period', '/acc/period/query'],
      ['/dcl/acc-mapping', '/dcl/acc-mapping/query'],
      ['/dcl/rpt-definition', '/dcl/rpt-definition/query'],
      ['/dcl/wfl-process-definition', '/dcl/wfl-process-definition/query'],
      ['/wfl/process-definition', '/wfl/process-definition/query'],
      ['/wfl/process-instance', '/wfl/process-instance/query'],
    ]) {
      const route = router.resolve(path)
      expect(route.name).toBe(`page:${path.slice(1)}`)
      expect(route.meta.requiredPermission).toBe(permission)
    }

    const workflow = router.resolve('/wfl/sale-flow')
    expect(workflow.name).toBe('page:wfl/dynamic-process')
    expect(workflow.params.processCode).toBe('sale-flow')
    expect(workflow.meta.requiresServerRoute).toBe(true)
    expect(workflow.meta.requiredDynamicPermission).toBe('wfl-query')

    const report = router.resolve('/rpt/rpt-000001')
    expect(report.name).toBe('page:rpt/dynamic-report')
    expect(report.params.reportCode).toBe('rpt-000001')
    expect(report.meta.requiredDynamicPermission).toBe('rpt-query')
  })
})
