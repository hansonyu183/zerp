import {
  getCurrentScope,
  onScopeDispose,
  reactive,
  type Ref,
} from 'vue'
import { apiClient } from '@/api/client'
import {
  getErrorMessage,
  type PageRequest,
  type PageResult,
} from '@/api/types'
import { useSessionStore } from '@/stores/session'
import type {
  IntermediaryDeliveryDraft,
  IntermediaryProductReference,
  IntermediaryStageDraft,
} from './types'

interface ReferenceState {
  options: IntermediaryProductReference[]
  loading: boolean
  error: string | null
  sequence: number
}

interface ReferenceQueryItem {
  objectId: string
  code: string
  effectiveVersionId: string | null
  currentVersion: {
    versionId: string
    status: string
    summary: {
      name: string
      unit?: string
      supplierType?: string
      plateNumber?: string
      platformObjectId?: string
      containerType?: 'NONE' | 'SOLVENT' | 'RESIN'
      quantityPerContainer?: string
    }
  }
}

export function useIntermediaryReferences(
  stageDraft: Ref<IntermediaryStageDraft | null>,
) {
  const session = useSessionStore()
  const referenceStates = reactive<Record<string, ReferenceState>>({})
  const referenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function referenceState(key: string): ReferenceState {
    if (!referenceStates[key]) {
      referenceStates[key] = {
        options: [],
        loading: false,
        error: null,
        sequence: 0,
      }
    }
    return referenceStates[key]
  }

  function referenceOptions(key: string): IntermediaryProductReference[] {
    return referenceState(key).options
  }

  function referenceLoading(key: string): boolean {
    return referenceState(key).loading
  }

  function referenceError(key: string): string | null {
    return referenceState(key).error
  }

  function referenceEntity(key: string): string {
    if (key === 'customer' || key === 'filterCustomer') return 'customer'
    if (key === 'supplier' || key === 'platform') return 'supplier'
    if (key === 'product') return 'product'
    if (key === 'vehicle') return 'vehicle'
    return 'employee'
  }

  function referenceFilters(key: string): Record<string, unknown> {
    if (key === 'supplier') return { supplierType: 'GENERAL' }
    if (key === 'platform') return { supplierType: 'LOGISTICS_PLATFORM' }
    return {}
  }

  function searchReference(key: string, keyword: string): void {
    const timer = referenceTimers.get(key)
    if (timer) clearTimeout(timer)
    referenceTimers.set(
      key,
      setTimeout(() => {
        referenceTimers.delete(key)
        void loadReference(key, keyword)
      }, keyword ? 250 : 0),
    )
  }

  async function loadReference(key: string, keyword: string): Promise<void> {
    const state = referenceState(key)
    const entity = referenceEntity(key)
    if (!session.can(`/bob/${entity}/query`)) {
      state.error = `缺少${entity}查询权限。`
      return
    }
    const sequence = ++state.sequence
    state.loading = true
    state.error = null
    try {
      const { data } = await apiClient.post<
        PageResult<ReferenceQueryItem>,
        PageRequest
      >(`bob/${entity}/query`, {
        page: 1,
        pageSize: 20,
        filters: {
          status: ['EFFECTIVE'],
          ...referenceFilters(key),
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        },
        sort: [{ field: 'name', order: 'asc' }],
      })
      if (sequence !== state.sequence) return
      const selectedPlatform =
        key === 'vehicle'
          ? (stageDraft.value as IntermediaryDeliveryDraft | null)?.platform
          : null
      state.options = (data.items ?? [])
        .filter(
          (item) =>
            item.currentVersion.status === 'EFFECTIVE' &&
            item.effectiveVersionId === item.currentVersion.versionId &&
            (
              !selectedPlatform ||
              item.currentVersion.summary.platformObjectId ===
                selectedPlatform.objectId
            ),
        )
        .map((item) => ({
          objectId: item.objectId,
          versionId: item.currentVersion.versionId,
          entity,
          code: item.code,
          name: item.currentVersion.summary.name,
          unit: item.currentVersion.summary.unit,
          supplierType: item.currentVersion.summary.supplierType,
          plateNumber: item.currentVersion.summary.plateNumber,
          platformObjectId: item.currentVersion.summary.platformObjectId,
          containerType: item.currentVersion.summary.containerType,
          quantityPerContainer:
            item.currentVersion.summary.quantityPerContainer,
        }))
    } catch (error) {
      if (sequence === state.sequence) state.error = getErrorMessage(error)
    } finally {
      if (sequence === state.sequence) state.loading = false
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const timer of referenceTimers.values()) clearTimeout(timer)
    })
  }

  return {
    searchReference,
    referenceOptions,
    referenceLoading,
    referenceError,
  }
}
