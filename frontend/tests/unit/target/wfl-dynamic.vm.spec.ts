import { describe, expect, it } from 'vitest'

import { createDynamicWflViewModel } from '@/target/pages/wfl/dynamic/vm.ts'

describe('dynamic WFL route view model', () => {
  it('accepts only an exact server-catalog route with the generic instance permission', () => {
    const routes = [
      {
        routePath: '/wfl/sale-flow',
        permissionCode: '/wfl/process-instance/query',
      },
    ]
    expect(
      createDynamicWflViewModel('sale-flow', routes, [
        '/wfl/process-instance/query',
      ]).available.value,
    ).toBe(true)
    expect(
      createDynamicWflViewModel('disabled-flow', routes, [
        '/wfl/process-instance/query',
      ]).available.value,
    ).toBe(false)
    expect(
      createDynamicWflViewModel('sale-flow', routes, []).available.value,
    ).toBe(false)
  })

  it('rejects malformed and reserved workflow codes before rendering the page', () => {
    const permission = ['/wfl/process-instance/query']
    const route = (code: string) => [
      { routePath: `/wfl/${code}`, permissionCode: permission[0]! },
    ]
    for (const code of ['UPPER', 'a', 'process-definition', 'process-instance'])
      expect(
        createDynamicWflViewModel(code, route(code), permission).available
          .value,
      ).toBe(false)
  })

  it('recomputes availability when the same route component receives a new code', () => {
    const vm = createDynamicWflViewModel(
      'sale-flow',
      [
        {
          routePath: '/wfl/purchase-flow',
          permissionCode: '/wfl/process-instance/query',
        },
      ],
      ['/wfl/process-instance/query'],
    )

    expect(vm.available.value).toBe(false)
    vm.setCode('purchase-flow')
    expect(vm.code.value).toBe('purchase-flow')
    expect(vm.available.value).toBe(true)
  })
})
