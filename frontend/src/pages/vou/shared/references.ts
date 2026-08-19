import { getCurrentScope, onScopeDispose, reactive, type Ref } from 'vue'
import { apiClient, type BobApiEntity } from '@/api/client'
import { getErrorMessage, type PageRequest, type PageResult } from '@/api/types'
import type {
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherProductLineDraft,
  VoucherProductionOutputDraft,
  VoucherReference,
} from '@/components/voucher'
import { useSessionStore } from '@/stores/session'

interface ReferenceListItem {
  objectId: string
  code: string
  effectiveVersionId: string | null
  currentVersion: {
    versionId: string
    status: string
    summary: Record<string, unknown> & { name?: string }
  }
}

interface ReferenceState {
  options: VoucherReference[]
  loading: boolean
  errorMessage: string | null
  sequence: number
}

export function useVoucherReferences(
  config: VoucherEntityConfig,
  form: Ref<VoucherDraftForm>,
) {
  const session = useSessionStore()
  const references = reactive<Record<string, ReferenceState>>({})
  const searchTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const referenceControllers = new Map<string, AbortController>()

  function referenceState(key: string): ReferenceState {
    if (!references[key]) {
      references[key] = {
        options: [],
        loading: false,
        errorMessage: null,
        sequence: 0,
      }
    }
    return references[key]
  }

  function referenceOptions(key: string): readonly VoucherReference[] {
    return referenceState(key).options
  }

  function referenceLoading(key: string): boolean {
    return referenceState(key).loading
  }

  function referenceError(key: string): string | null {
    return referenceState(key).errorMessage
  }

  function referenceDefinition(key: string): {
    entities: BobApiEntity[]
    filters?: Record<string, unknown>
  } {
    if (key === 'customer') return { entities: ['customer'] }
    if (key === 'supplier') {
      return {
        entities: ['supplier'],
        filters: { supplierType: 'GENERAL' },
      }
    }
    if (key === 'counterparty' || key === 'party') {
      if (key === 'counterparty') {
        return { entities: [form.value.counterpartyType || 'customer'] }
      }
      if (config.partyMode === 'customer') return { entities: ['customer'] }
      if (config.partyMode === 'supplier') return { entities: ['supplier'] }
      if (config.partyMode === 'none') return { entities: [] }
      return { entities: ['customer', 'supplier'] }
    }
    if (['employee', 'salesperson', 'purchaser', 'handler'].includes(key)) {
      return { entities: ['employee'] }
    }
    if (
      key === 'warehouse' ||
      key === 'materialWarehouse' ||
      key === 'finishedWarehouse'
    ) {
      return { entities: ['warehouse'] }
    }
    if (key === 'fundAccount') return { entities: ['fund-account'] }
    if (key === 'product') {
      return {
        entities: ['product'],
        ...(config.productionMode === 'self'
          ? { filters: { productKind: 'STANDARD_FINISHED' } }
          : {}),
      }
    }
    if (key === 'actualMaterial') {
      return {
        entities: ['product'],
        filters: { productKind: 'RAW_MATERIAL' },
      }
    }
    if (key === 'platform') {
      return {
        entities: ['supplier'],
        filters: { supplierType: 'LOGISTICS_PLATFORM' },
      }
    }
    if (key === 'vehicle') {
      return { entities: ['vehicle'] }
    }
    return { entities: [] }
  }

  function selectedReferences(): VoucherReference[] {
    const result: VoucherReference[] = []
    for (const value of Object.values(form.value)) {
      if (value && typeof value === 'object' && 'objectId' in value) {
        result.push(value as VoucherReference)
      } else if (Array.isArray(value)) {
        for (const item of value as Array<
          VoucherProductLineDraft | VoucherProductionOutputDraft
        >) {
          if (item.product) result.push(item.product)
          if ('materials' in item && Array.isArray(item.materials)) {
            for (const material of item.materials) {
              if (material.actualMaterial) result.push(material.actualMaterial)
            }
          }
        }
      }
    }
    return result
  }

  function searchReference(key: string, keyword: string): void {
    const previous = searchTimers.get(key)
    if (previous) clearTimeout(previous)
    searchTimers.set(
      key,
      setTimeout(() => void loadReference(key, keyword), 250),
    )
  }

  async function loadReference(key: string, keyword: string): Promise<void> {
    const definition = referenceDefinition(key)
    const state = referenceState(key)
    if (definition.entities.length === 0) return
    const missingPermission = definition.entities.find(
      (entity) => !session.can(`/bob/${entity}/query`),
    )
    if (missingPermission) {
      state.errorMessage = `缺少 ${missingPermission} 查询权限。`
      return
    }

    const sequence = ++state.sequence
    referenceControllers.get(key)?.abort()
    const controller = new AbortController()
    referenceControllers.set(key, controller)
    state.loading = true
    state.errorMessage = null
    try {
      const pages = await Promise.all(
        definition.entities.map(async (entity) => {
          if (entity === 'customer') {
            const { data } = await apiClient.postContract(
              'bob/reference/query',
              {
                entity,
                ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
              },
              { signal: controller.signal },
            )
            return data.map(
              (item): VoucherReference => ({
                objectId: item.objectId,
                versionId: item.versionId,
                entity,
                code: item.code,
                name: item.name,
              }),
            )
          }
          const { data } = await apiClient.post<
            PageResult<ReferenceListItem>,
            PageRequest
          >(
            `bob/${entity}/query`,
            {
              page: 1,
              pageSize: 20,
              filters: {
                status: ['EFFECTIVE'],
                ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
                ...(definition.filters ?? {}),
                ...(entity === 'supplier' &&
                (key === 'counterparty' || key === 'party')
                  ? { supplierType: 'GENERAL' }
                  : {}),
              },
              sort: [{ field: 'name', order: 'asc' }],
            },
            { signal: controller.signal },
          )
          return (data.items ?? []).flatMap((item): VoucherReference[] => {
            if (
              item.currentVersion.status !== 'EFFECTIVE' ||
              !item.effectiveVersionId ||
              item.effectiveVersionId !== item.currentVersion.versionId ||
              !item.currentVersion.summary.name
            ) {
              return []
            }
            const summary = item.currentVersion.summary
            return [
              {
                objectId: item.objectId,
                versionId: item.effectiveVersionId,
                entity,
                code: item.code,
                name: String(summary.name),
                ...(typeof summary.unit === 'string'
                  ? { unit: summary.unit }
                  : {}),
                ...(typeof summary.currency === 'string'
                  ? { currency: summary.currency }
                  : {}),
                ...(typeof summary.plateNumber === 'string'
                  ? { plateNumber: summary.plateNumber }
                  : {}),
                ...(typeof summary.supplierType === 'string'
                  ? { supplierType: summary.supplierType }
                  : {}),
                ...(typeof summary.platformObjectId === 'string'
                  ? { platformObjectId: summary.platformObjectId }
                  : {}),
                ...(typeof summary.productKind === 'string'
                  ? { productKind: summary.productKind }
                  : {}),
                ...(typeof summary.pricingQuantityPerInventoryUnit === 'string'
                  ? {
                      pricingQuantityPerInventoryUnit:
                        summary.pricingQuantityPerInventoryUnit,
                    }
                  : {}),
              },
            ]
          })
        }),
      )
      if (sequence !== state.sequence) return
      const platformObjectId =
        key === 'vehicle' ? form.value.platform?.objectId : undefined
      state.options = [...selectedReferences(), ...pages.flat()]
        .filter(
          (item) =>
            definition.entities.includes(item.entity as BobApiEntity) &&
            (!platformObjectId || item.platformObjectId === platformObjectId),
        )
        .filter(
          (item, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.objectId === item.objectId &&
                candidate.versionId === item.versionId,
            ) === index,
        )
    } catch (error) {
      if (sequence === state.sequence) {
        state.errorMessage = getErrorMessage(error)
      }
    } finally {
      if (sequence === state.sequence) state.loading = false
      if (referenceControllers.get(key) === controller) {
        referenceControllers.delete(key)
      }
    }
  }

  function clearReferenceSearches(): void {
    for (const timer of searchTimers.values()) clearTimeout(timer)
    searchTimers.clear()
    for (const controller of referenceControllers.values()) controller.abort()
    referenceControllers.clear()
  }

  if (getCurrentScope()) onScopeDispose(clearReferenceSearches)

  return {
    referenceOptions,
    referenceLoading,
    referenceError,
    searchReference,
    clearReferenceSearches,
  }
}
