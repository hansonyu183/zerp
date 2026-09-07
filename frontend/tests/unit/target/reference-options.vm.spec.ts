import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as targetApi from '@/target/api.ts'
import { FieldContractError } from '@/target/components/dynamic-fields/contract.ts'
import { useReferenceOptionsViewModel } from '@/target/components/dynamic-fields/reference-options.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  queryTargetRoles: vi.fn(),
  queryTargetBobReferences: vi.fn(),
}))

const queryRoles = vi.mocked(targetApi.queryTargetRoles)

function role(id: string, enabled = true) {
  return {
    id,
    code: id,
    py: id,
    name: `角色 ${id}`,
    enabled,
    revision: '1',
    availableActions: [],
    manageable: true,
    assignable: true,
    type: 'NORMAL' as const,
    description: null,
  }
}

function authorize(...paths: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf-token'
  session.apiPaths = paths
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('reference-options public view-model seam', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  it('loads every role page into the finite app/role option source', async () => {
    authorize('/app/role/query')
    queryRoles
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, index) => role(`${index + 1}`)),
        total: 21,
        page: 1,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        items: [role('21', false)],
        total: 21,
        page: 2,
        pageSize: 20,
      } as never)
    const vm = useReferenceOptionsViewModel()

    await vm.load('app/role')

    expect(queryRoles).toHaveBeenNthCalledWith(1, 'csrf-token', {
      keyword: '',
      page: 1,
      pageSize: 20,
    })
    expect(queryRoles).toHaveBeenNthCalledWith(2, 'csrf-token', {
      keyword: '',
      page: 2,
      pageSize: 20,
    })
    expect(vm.options.value['app/role']).toEqual([
      { id: '1', name: '角色 1' },
      ...Array.from({ length: 19 }, (_, index) => ({
        id: `${index + 2}`,
        name: `角色 ${index + 2}`,
      })),
      { id: '21', name: '角色 21', disabled: true },
    ])
    expect(vm.loading.value).toBe(false)
    expect(vm.error.value).toBeNull()
  })

  it('does not request reference options without the exact query permission', async () => {
    authorize('/app/role/get')
    const vm = useReferenceOptionsViewModel()

    await vm.load('app/role')

    expect(queryRoles).not.toHaveBeenCalled()
    expect(vm.options.value).toEqual({})
    expect(vm.loading.value).toBe(false)
    expect(vm.canRead('app/role')).toBe(false)
  })

  it('rejects an unknown source at the public boundary', async () => {
    const vm = useReferenceOptionsViewModel()

    expect(() => vm.canRead('unsafe/source' as never)).toThrow(
      FieldContractError,
    )
    await expect(vm.load('unsafe/source' as never)).rejects.toThrow(
      FieldContractError,
    )
  })

  it('records an authorized empty role result as an empty finite source', async () => {
    authorize('/app/role/query')
    queryRoles.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never)
    const vm = useReferenceOptionsViewModel()

    await vm.load('app/role')

    expect(vm.options.value).toEqual({ 'app/role': [] })
    expect(vm.canRead('app/role')).toBe(true)
  })

  it('reports a source-local load error without retaining options', async () => {
    authorize('/app/role/query')
    queryRoles.mockRejectedValue(new Error('offline'))
    const vm = useReferenceOptionsViewModel()

    await vm.load('app/role')

    expect(vm.options.value).toEqual({})
    expect(vm.error.value).toBe('offline')
    expect(vm.loading.value).toBe(false)
  })

  it('rejects a late role page from a replacement session', async () => {
    authorize('/app/role/query')
    const late = deferred<{
      items: ReturnType<typeof role>[]
      total: number
      page: number
      pageSize: number
    }>()
    queryRoles.mockReturnValueOnce(late.promise as never)
    const vm = useReferenceOptionsViewModel()

    const loading = vm.load('app/role')
    expect(vm.loading.value).toBe(true)
    const session = useTargetSession()
    session.generation += 1
    session.csrfToken = 'replacement-token'
    late.resolve({ items: [role('late')], total: 1, page: 1, pageSize: 20 })
    await loading

    expect(vm.options.value).toEqual({})
    expect(vm.error.value).toBeNull()
    expect(vm.loading.value).toBe(false)
  })

  it('rejects the final page when role query permission is revoked', async () => {
    authorize('/app/role/query')
    const lastPage = deferred<{
      items: ReturnType<typeof role>[]
      total: number
      page: number
      pageSize: number
    }>()
    queryRoles
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, index) => role(`${index + 1}`)),
        total: 21,
        page: 1,
        pageSize: 20,
      } as never)
      .mockReturnValueOnce(lastPage.promise as never)
    const vm = useReferenceOptionsViewModel()

    const loading = vm.load('app/role')
    await vi.waitFor(() => expect(queryRoles).toHaveBeenCalledTimes(2))
    useTargetSession().apiPaths = []
    lastPage.resolve({ items: [role('21')], total: 21, page: 2, pageSize: 20 })
    await loading

    expect(vm.options.value).toEqual({})
    expect(vm.canRead('app/role')).toBe(false)
  })

  it('rejects a late role page after disposal', async () => {
    authorize('/app/role/query')
    const late = deferred<{
      items: ReturnType<typeof role>[]
      total: number
      page: number
      pageSize: number
    }>()
    queryRoles.mockReturnValueOnce(late.promise as never)
    const vm = useReferenceOptionsViewModel()

    const loading = vm.load('app/role')
    vm.dispose()
    late.resolve({ items: [role('late')], total: 1, page: 1, pageSize: 20 })
    await loading

    expect(vm.options.value).toEqual({})
    expect(vm.error.value).toBeNull()
    expect(vm.loading.value).toBe(false)
  })
})

it('loads current BOB customer subunits only with the exact reference permission', async () => {
  setActivePinia(createPinia())
  vi.mocked(targetApi.queryTargetBobReferences).mockResolvedValue([
    { objectId: 'subunit', name: '真实子单位' },
  ] as never)
  authorize('/bob/customer/query')
  const denied = useReferenceOptionsViewModel()
  await denied.load('bob/customer-subunit')
  expect(targetApi.queryTargetBobReferences).not.toHaveBeenCalled()
  authorize('/bob/reference/query')
  const allowed = useReferenceOptionsViewModel()
  await allowed.load('bob/customer-subunit')
  expect(targetApi.queryTargetBobReferences).toHaveBeenCalledWith(
    'csrf-token',
    { entity: 'customer-subunit' },
  )
  expect(allowed.options.value['bob/customer-subunit']).toEqual([
    { id: 'subunit', name: '真实子单位' },
  ])
})
