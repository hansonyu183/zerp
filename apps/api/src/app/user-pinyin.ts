import { createHash } from 'node:crypto'

import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import { searchPinyin } from '../platform/pinyin.ts'

import type { DB } from '../db/generated.ts'

type AnyDb = Kysely<DB> | Transaction<DB>

export interface UserPinyinBackfillReport {
  columnPresent: boolean
  columnRequired: boolean
  constraintPresent: boolean
  userCount: number
  changedUsers: number
  factsSha256: string
}

export interface UserPinyinBackfillBaseline {
  userCount: number
  factsSha256: string
}

type PinyinColumn = {
  is_nullable: 'YES' | 'NO'
}

type UserRow = {
  id: string
  display_name: string
  py: string | null
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function columnState(db: AnyDb) {
  const [column, constraint] = await Promise.all([
    sql<PinyinColumn>`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_users'
        AND column_name = 'py'
    `.execute(db),
    sql<{ present: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.app_users'::regclass
          AND conname = 'app_users_py_nonempty'
      ) AS present
    `.execute(db),
  ])
  return {
    columnPresent: column.rows.length === 1,
    columnRequired: column.rows[0]?.is_nullable === 'NO',
    constraintPresent: constraint.rows[0]?.present ?? false,
  }
}

async function protectedFacts(db: AnyDb) {
  const result = await sql<{
    user_count: string
    facts: string
  }>`
    SELECT
      (SELECT count(*)::text FROM public.app_users) AS user_count,
      concat_ws(E'\n',
        (SELECT coalesce(jsonb_agg(to_jsonb(u) - 'py' ORDER BY u.id), '[]'::jsonb)::text FROM public.app_users u),
        (SELECT coalesce(jsonb_agg(to_jsonb(ur) ORDER BY ur.user_id, ur.role_id), '[]'::jsonb)::text FROM public.app_user_roles ur),
        (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb)::text FROM public.app_audit_events a)
      ) AS facts
  `.execute(db)
  const row = result.rows[0]
  if (!row) throw new Error('unable to read user pinyin backfill baseline')
  return { userCount: Number(row.user_count), factsSha256: digest(row.facts) }
}

async function users(db: AnyDb, columnPresent: boolean): Promise<UserRow[]> {
  const result = columnPresent
    ? await sql<UserRow>`
        SELECT id, display_name, py
        FROM public.app_users
        ORDER BY id
      `.execute(db)
    : await sql<UserRow>`
        SELECT id, display_name, NULL::text AS py
        FROM public.app_users
        ORDER BY id
      `.execute(db)
  return result.rows
}

async function report(db: AnyDb): Promise<UserPinyinBackfillReport> {
  const state = await columnState(db)
  const [facts, rows] = await Promise.all([
    protectedFacts(db),
    users(db, state.columnPresent),
  ])
  const changedUsers = rows.filter(
    (row) => row.py !== searchPinyin(row.display_name),
  ).length
  return { ...state, ...facts, changedUsers }
}

/**
 * Controlled one-time conversion for databases created before app_users.py.
 * Business spelling is computed here; the CLI only supplies scope and baseline.
 */
export class UserPinyinMaintenanceService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async inspect(): Promise<UserPinyinBackfillReport> {
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(report)
  }

  async apply(
    expected: UserPinyinBackfillBaseline,
  ): Promise<UserPinyinBackfillReport> {
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('zerp:user-pinyin-backfill', 0))`.execute(
        tx,
      )
      await sql`LOCK TABLE public.app_users IN ACCESS EXCLUSIVE MODE`.execute(
        tx,
      )
      await sql`LOCK TABLE public.app_user_roles, public.app_audit_events IN SHARE MODE`.execute(
        tx,
      )

      const before = await protectedFacts(tx)
      if (
        before.userCount !== expected.userCount ||
        before.factsSha256 !== expected.factsSha256
      )
        throw new Error(
          'user pinyin baseline changed; inspect again and do not auto-retry',
        )

      let state = await columnState(tx)
      if (!state.columnPresent) {
        await sql`ALTER TABLE public.app_users ADD COLUMN py text`.execute(tx)
        state = await columnState(tx)
      }
      const rows = await users(tx, true)
      let changedUsers = 0
      for (const row of rows) {
        const py = searchPinyin(row.display_name)
        if (!py) throw new Error('a user name has no canonical pinyin')
        if (row.py === py) continue
        await sql`UPDATE public.app_users SET py = ${py} WHERE id = ${row.id}`.execute(
          tx,
        )
        changedUsers += 1
      }
      if (!state.constraintPresent)
        await sql`ALTER TABLE public.app_users ADD CONSTRAINT app_users_py_nonempty CHECK (btrim(py) <> '')`.execute(
          tx,
        )
      if (!state.columnRequired)
        await sql`ALTER TABLE public.app_users ALTER COLUMN py SET NOT NULL`.execute(
          tx,
        )

      const [after, finalState, finalRows] = await Promise.all([
        protectedFacts(tx),
        columnState(tx),
        users(tx, true),
      ])
      if (
        after.userCount !== before.userCount ||
        after.factsSha256 !== before.factsSha256
      )
        throw new Error('user pinyin backfill changed protected user facts')
      if (finalRows.some((row) => row.py !== searchPinyin(row.display_name)))
        throw new Error('user pinyin backfill readback mismatch')
      if (!finalState.columnRequired || !finalState.constraintPresent)
        throw new Error('user pinyin persistence constraints are incomplete')
      return { ...finalState, ...after, changedUsers }
    })
  }
}
