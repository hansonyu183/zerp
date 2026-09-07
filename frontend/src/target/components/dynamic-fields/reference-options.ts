import { ref, shallowRef } from 'vue'

import { queryTargetRoles } from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'

import { FieldContractError } from './contract.ts'
import type {
  ReferenceOption,
  ReferenceOptions,
  ReferenceSource,
} from './types.ts'

const roleQueryPath = '/app/role/query'
const pageSize = 20 as const

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : '引用选项加载失败。'
}

function assertReferenceSource(
  source: unknown,
): asserts source is ReferenceSource {
  if (source !== 'app/role') throw new FieldContractError('使用未登记的引用源')
}

export function useReferenceOptionsViewModel() {
  const session = useTargetSession()
  const options = shallowRef<ReferenceOptions>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  let disposed = false
  let requestVersion = 0

  function tokenFor(generation: number): string | null {
    if (
      disposed ||
      session.generation !== generation ||
      !session.can(roleQueryPath) ||
      !session.csrfToken
    )
      return null
    return session.csrfToken
  }

  function canRead(source: ReferenceSource): boolean {
    assertReferenceSource(source)
    return tokenFor(session.generation) !== null
  }

  function isCurrent(request: number, generation: number): boolean {
    return (
      !disposed &&
      request === requestVersion &&
      session.generation === generation
    )
  }

  async function loadRoles(
    request: number,
    generation: number,
    initialToken: string,
  ): Promise<void> {
    const roles: ReferenceOption[] = []
    let page = 1
    let total = Number.POSITIVE_INFINITY

    while (roles.length < total) {
      const token = page === 1 ? initialToken : tokenFor(generation)
      if (!token || !isCurrent(request, generation)) return
      const result = await queryTargetRoles(token, {
        keyword: '',
        page,
        pageSize,
      })
      if (!isCurrent(request, generation) || !tokenFor(generation)) return
      roles.push(
        ...result.items.map((role) =>
          role.enabled
            ? { id: role.id, name: role.name }
            : { id: role.id, name: role.name, disabled: true },
        ),
      )
      total = result.total
      if (result.items.length === 0) break
      page += 1
    }

    if (isCurrent(request, generation) && tokenFor(generation))
      options.value = { 'app/role': roles }
  }

  async function load(source: ReferenceSource): Promise<void> {
    assertReferenceSource(source)
    const request = ++requestVersion
    const generation = session.generation
    const token = tokenFor(generation)
    if (!token) {
      if (!disposed && request === requestVersion) {
        options.value = {}
        error.value = null
        loading.value = false
      }
      return
    }

    loading.value = true
    error.value = null
    options.value = {}
    try {
      switch (source) {
        case 'app/role':
          await loadRoles(request, generation, token)
          return
      }
    } catch (cause) {
      if (isCurrent(request, generation)) {
        options.value = {}
        error.value = messageOf(cause)
      }
    } finally {
      if (!disposed && request === requestVersion) loading.value = false
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    requestVersion += 1
    options.value = {}
    error.value = null
    loading.value = false
  }

  return { options, loading, error, canRead, load, dispose }
}
