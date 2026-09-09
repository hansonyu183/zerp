import { createHash } from 'node:crypto'
import { sql, type Kysely, type Transaction } from 'kysely'
import type {
  ApprovalActor,
  VouIntermediaryCalculationInput,
} from '@zerp/model'
import type { DB } from '../db/generated.ts'
import { VouApplicationError } from './service.ts'

type Script = VouIntermediaryCalculationInput['script']
export type IntermediaryScriptSave = {
  expectedRevision: number | null
  name: string
  source: string
}
export class IntermediaryScriptService {
  private readonly db: Kysely<DB>
  constructor(db: Kysely<DB>) {
    this.db = db
  }

  private authorize(
    actor: ApprovalActor,
    action: 'script-get' | 'script-save',
  ) {
    if (
      !actor.trusted &&
      !actor.permissions.includes(`/vou/intermediary-calculation/${action}`)
    )
      throw new VouApplicationError('approval_invalid_action')
  }

  async get(actor: ApprovalActor): Promise<Script | null> {
    this.authorize(actor, 'script-get')
    return this.read(this.db)
  }

  async read(tx: Kysely<DB> | Transaction<DB>): Promise<Script | null> {
    const result = await sql<{
      script_id: string
      revision: number
      name: string
      source: string
      hash: string
    }>`
      SELECT script_id, revision, name, source, hash FROM vou_intermediary_scripts WHERE script_id = 'GLOBAL'
    `.execute(tx)
    const row = result.rows[0]
    return row
      ? {
          scriptId: row.script_id,
          revision: row.revision,
          name: row.name,
          source: row.source,
          hash: row.hash,
        }
      : null
  }

  async save(
    input: IntermediaryScriptSave,
    actor: ApprovalActor,
  ): Promise<Script> {
    this.authorize(actor, 'script-save')
    if (
      !input.name.trim() ||
      !input.source.trim() ||
      input.name.length > 200 ||
      input.source.length > 200000
    )
      throw new VouApplicationError('vou_invalid_payload')
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('vou:intermediary-script:GLOBAL', 0))`.execute(
        tx,
      )
      const previous = await this.read(tx)
      if ((previous?.revision ?? null) !== input.expectedRevision)
        throw new VouApplicationError('vou_script_stale_revision')
      const script: Script = {
        scriptId: 'GLOBAL',
        revision: (previous?.revision ?? 0) + 1,
        name: input.name.trim(),
        source: input.source,
        hash: createHash('sha256').update(input.source).digest('hex'),
      }
      await sql`
        INSERT INTO vou_intermediary_scripts (script_id, revision, name, source, hash, updated_by, updated_at)
        VALUES ('GLOBAL', ${script.revision}, ${script.name}, ${script.source}, ${script.hash}, ${actor.id}, now())
        ON CONFLICT (script_id) DO UPDATE SET revision = EXCLUDED.revision, name = EXCLUDED.name,
          source = EXCLUDED.source, hash = EXCLUDED.hash, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
      `.execute(tx)
      return script
    })
  }
}
