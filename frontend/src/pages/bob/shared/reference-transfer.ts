import { computed, ref, type Ref } from 'vue'
import { ApiError, getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { bobSharedApi, type BobReferenceCandidate } from './api'
import type { BobEntity, BobListItem } from './types'

type TransferableBobEntity =
  'operating-entity' | 'employee' | 'supplier' | 'product'

function isTransferableBobEntity(
  entity: BobEntity,
): entity is TransferableBobEntity {
  return ['operating-entity', 'employee', 'supplier', 'product'].includes(
    entity,
  )
}

export function useBobReferenceTransfer(
  entity: BobEntity,
  successMessage: Ref<string | null>,
  query: () => Promise<void>,
) {
  const session = useSessionStore()
  const transferableEntity = isTransferableBobEntity(entity) ? entity : null
  const open = ref(false)
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  const source = ref<BobListItem | null>(null)
  const targetId = ref<string | null>(null)
  const candidates = ref<BobReferenceCandidate[]>([])
  let searchRequest = 0
  const options = computed(() =>
    candidates.value.map((candidate) => ({
      title: `${candidate.code} · ${candidate.name}`,
      value: candidate.objectId,
    })),
  )

  function canTransfer(): boolean {
    return (
      transferableEntity !== null &&
      session.can('/bob/reference/transfer') &&
      session.can(`/bob/${entity}/query`)
    )
  }

  async function openFor(row: BobListItem): Promise<void> {
    if (!canTransfer() || !transferableEntity) return
    source.value = row
    targetId.value = null
    candidates.value = []
    errorMessage.value = null
    open.value = true
    await search('')
  }

  async function search(keyword: string): Promise<void> {
    const currentSource = source.value
    if (!currentSource || !canTransfer() || !transferableEntity) return
    const request = ++searchRequest
    loading.value = true
    try {
      const { data } = await bobSharedApi.queryReferenceCandidates({
        entity: transferableEntity,
        keyword: keyword.trim(),
        sourceObjectId: currentSource.objectId,
      })
      if (request === searchRequest) candidates.value = data
    } catch (error) {
      if (request === searchRequest) errorMessage.value = getErrorMessage(error)
    } finally {
      if (request === searchRequest) loading.value = false
    }
  }

  function close(): void {
    if (loading.value) return
    open.value = false
    errorMessage.value = null
    source.value = null
    targetId.value = null
    candidates.value = []
  }

  async function confirm(): Promise<boolean> {
    const currentSource = source.value
    const targetObjectId = targetId.value
    if (
      !currentSource ||
      !targetObjectId ||
      !transferableEntity ||
      loading.value
    ) {
      return false
    }
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await bobSharedApi.transferReferences({
        entity: transferableEntity,
        sourceObjectId: currentSource.objectId,
        targetObjectId,
        sourceObjectRevision: currentSource.objectRevision,
      })
      await query()
      loading.value = false
      close()
      successMessage.value = `${currentSource.code} 已停用，并完成 ${data.affectedObjects} 个业务对象的引用转移。`
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      loading.value = false
    }
  }

  async function handleLifecycleError(
    error: unknown,
    row: BobListItem,
    action: string,
  ): Promise<boolean> {
    if (
      action !== 'disable' ||
      !(error instanceof ApiError) ||
      error.kind !== 'business' ||
      error.message !== 'object has active direct references' ||
      !canTransfer()
    ) {
      return false
    }
    await openFor(row)
    return true
  }

  return {
    referenceTransferOpen: open,
    referenceTransferLoading: loading,
    referenceTransferError: errorMessage,
    referenceTransferSource: source,
    referenceTransferTargetId: targetId,
    referenceTransferCandidates: candidates,
    referenceTransferOptions: options,
    closeReferenceTransfer: close,
    confirmReferenceTransfer: confirm,
    searchReferenceTransfer: search,
    handleReferenceTransferLifecycleError: handleLifecycleError,
  }
}
