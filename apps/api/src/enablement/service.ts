import type { Transaction } from 'kysely'
import { ulid } from 'ulid'

import { AppServiceError, type AppErrorKey } from '../app/session.ts'
import type { DB } from '../db/generated.ts'

export interface EnablementFact {
  id: string
  enabled: boolean
  revision: string
}

/** A domain adapter supplies only its own facts and compare-and-set storage. */
export interface EnablementStore<Row extends EnablementFact> {
  read(tx: Transaction<DB>, id: string): Promise<Row | undefined>
  write(
    tx: Transaction<DB>,
    current: Row,
    enabled: boolean,
    revision: string,
  ): Promise<boolean>
}

/** Participate in the caller's transaction; never open or commit another one. */
export async function changeEnablement<Row extends EnablementFact>(
  tx: Transaction<DB>,
  input: { id: string; revision: string; enabled: boolean },
  context: {
    domain: string
    entity: string
    actorId: string
    requestId: string
    eventType: string
    changedError: AppErrorKey
  },
  store: EnablementStore<Row>,
  rules: {
    beforeWrite(current: Row): Promise<void>
    afterWrite(current: Row): Promise<void>
  },
): Promise<void> {
  if (
    !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(input.id) ||
    typeof input.revision !== 'string' ||
    !/^[1-9]\d*$/.test(input.revision)
  )
    throw new AppServiceError('validation_failed', 'invalid enablement input')
  const current = await store.read(tx, input.id)
  if (!current) throw new AppServiceError('not_found', 'object not found')
  if (BigInt(current.revision) !== BigInt(input.revision))
    throw new AppServiceError(context.changedError, 'object revision conflict')
  if (current.enabled === input.enabled)
    throw new AppServiceError('conflict', 'object state is unchanged')
  await rules.beforeWrite(current)
  const revision = String(BigInt(current.revision) + 1n)
  if (!(await store.write(tx, current, input.enabled, revision)))
    throw new AppServiceError(context.changedError, 'object revision conflict')
  await rules.afterWrite(current)
  await tx
    .insertInto('app_audit_events')
    .values({
      id: ulid(),
      event_type: context.eventType,
      actor_user_id: context.actorId,
      target_type: context.entity,
      target_id: current.id,
      result: 'SUCCESS',
      request_id: context.requestId,
      created_by: context.actorId,
      summary: JSON.stringify({
        domain: context.domain,
        entity: context.entity,
        beforeEnabled: current.enabled,
        afterEnabled: input.enabled,
        beforeRevision: current.revision,
        revision,
      }),
    })
    .execute()
}
