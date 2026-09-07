import { computed, shallowRef, toRaw } from 'vue'
import { ulid } from 'ulid'

import { TargetApiError } from '../../../api.ts'

export type ArchiveVersion<Snapshot> = {
  submissionId: string
  versionNo: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  revision: string
  snapshot: Snapshot
}

export type ArchiveSubmissionCommand<Snapshot> = {
  subjectId: string
  submissionId: string
  idempotencyKey: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  snapshot: Snapshot
}

export function useArchiveSubmissionEditor<Snapshot>(options: {
  createSnapshot: () => Snapshot
  validate: (snapshot: Snapshot) => string | null
  canSubmitNew: () => boolean
  canSubmitChange: () => boolean
  canGet: () => boolean
  get: (input: { subjectId: string; submissionId: string }) => Promise<unknown>
  versions: (
    subjectId: string,
  ) => Promise<{ items: readonly ArchiveVersion<Snapshot>[] }>
  submitNew: (input: ArchiveSubmissionCommand<Snapshot>) => Promise<unknown>
  submitChange: (input: ArchiveSubmissionCommand<Snapshot>) => Promise<unknown>
}) {
  const open = shallowRef(false)
  const mode = shallowRef<'create' | 'change'>('create')
  const error = shallowRef<string | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const outcomeUnknown = shallowRef(false)
  const subjectId = shallowRef('')
  const latestApprovedSubmissionId = shallowRef<string | null>(null)
  const latestApprovedRevision = shallowRef<string | null>(null)
  const draft = shallowRef<Snapshot>(options.createSnapshot())
  const command = shallowRef<ArchiveSubmissionCommand<Snapshot> | null>(null)
  let generation = 0

  const canSubmit = computed(
    () =>
      !saving.value &&
      !loading.value &&
      !outcomeUnknown.value &&
      (mode.value === 'create'
        ? options.canSubmitNew()
        : options.canSubmitChange() &&
          latestApprovedSubmissionId.value !== null &&
          latestApprovedRevision.value !== null),
  )
  const canVerifyOutcome = computed(
    () => outcomeUnknown.value && options.canGet() && !saving.value,
  )

  const destroyIntent = () => {
    subjectId.value = ''
    latestApprovedSubmissionId.value = null
    latestApprovedRevision.value = null
    command.value = null
    outcomeUnknown.value = false
  }
  const reset = (next: Snapshot) => {
    draft.value = next
    error.value = null
    destroyIntent()
  }
  const close = () => {
    if (saving.value) return
    ++generation
    open.value = false
    loading.value = false
    saving.value = false
    reset(options.createSnapshot())
  }
  const openCreate = () => {
    ++generation
    reset(options.createSnapshot())
    subjectId.value = ulid()
    mode.value = 'create'
    loading.value = false
    open.value = true
  }
  const openClone = (snapshot: Snapshot) => {
    ++generation
    reset(structuredClone(snapshot))
    subjectId.value = ulid()
    mode.value = 'create'
    loading.value = false
    open.value = true
  }
  const openChange = async (id: string) => {
    const requestGeneration = ++generation
    reset(options.createSnapshot())
    subjectId.value = id
    mode.value = 'change'
    open.value = true
    loading.value = true
    try {
      const versions = await options.versions(id)
      if (requestGeneration !== generation) return
      const approved = versions.items
        .filter((item) => item.status === 'APPROVED')
        .reduce<(typeof versions.items)[number] | null>(
          (latest, item) =>
            !latest || item.versionNo > latest.versionNo ? item : latest,
          null,
        )
      if (!approved) {
        error.value = '没有可编辑的正式版本。'
        return
      }
      draft.value = structuredClone(toRaw(approved.snapshot))
      latestApprovedSubmissionId.value = approved.submissionId
      latestApprovedRevision.value = approved.revision
    } catch (cause) {
      if (requestGeneration === generation)
        error.value =
          cause instanceof Error ? cause.message : '正式版本读取失败。'
    } finally {
      if (requestGeneration === generation) loading.value = false
    }
  }

  const buildCommand = () => ({
    subjectId: subjectId.value,
    submissionId: ulid(),
    idempotencyKey: ulid(),
    expectedLatestApprovedSubmissionId: latestApprovedSubmissionId.value,
    expectedLatestApprovedRevision: latestApprovedRevision.value,
    snapshot: structuredClone(toRaw(draft.value)),
  })
  const submit = async () => {
    if (!canSubmit.value) return
    const invalid = options.validate(draft.value)
    if (invalid) {
      error.value = invalid
      return
    }
    const pending = command.value ?? buildCommand()
    command.value = pending
    const requestGeneration = generation
    saving.value = true
    error.value = null
    try {
      if (mode.value === 'create') await options.submitNew(pending)
      else await options.submitChange(pending)
      if (requestGeneration !== generation) return
      open.value = false
      draft.value = options.createSnapshot()
      destroyIntent()
      return 'changed' as const
    } catch (cause) {
      if (requestGeneration !== generation) return
      error.value = cause instanceof Error ? cause.message : '提交失败。'
      const unknown =
        !(cause instanceof TargetApiError) ||
        cause.errorKey === 'invalid_response'
      if (unknown) {
        outcomeUnknown.value = true
        error.value = `${error.value} 提交结果未知，请先核实后再继续。`
      } else command.value = null
    } finally {
      if (requestGeneration === generation) saving.value = false
    }
  }

  const verifyOutcome = async () => {
    const pending = command.value
    if (!pending || !canVerifyOutcome.value) return
    const requestGeneration = generation
    saving.value = true
    error.value = null
    try {
      await options.get({
        subjectId: pending.subjectId,
        submissionId: pending.submissionId,
      })
      if (requestGeneration !== generation) return
      open.value = false
      draft.value = options.createSnapshot()
      destroyIntent()
      return 'changed' as const
    } catch (cause) {
      if (requestGeneration !== generation) return
      if (
        cause instanceof TargetApiError &&
        cause.errorKey === 'approval_not_found'
      ) {
        outcomeUnknown.value = false
        error.value = '已核实提交未生效，可以重试。'
        return 'not-changed' as const
      }
      error.value = `${cause instanceof Error ? cause.message : '提交结果核实失败。'} 结果仍未知。`
    } finally {
      if (requestGeneration === generation) saving.value = false
    }
  }

  const dispose = () => {
    ++generation
    open.value = false
    loading.value = false
    saving.value = false
    reset(options.createSnapshot())
  }

  return {
    open,
    mode,
    error,
    loading,
    saving,
    outcomeUnknown,
    draft,
    canSubmit,
    canVerifyOutcome,
    openCreate,
    openClone,
    openChange,
    submit,
    verifyOutcome,
    close,
    dispose,
  }
}
