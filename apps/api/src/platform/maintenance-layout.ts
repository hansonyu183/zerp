import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
type Executor = Kysely<DB> | Transaction<DB>
export async function publicSchemaLayout(
  db: Executor,
  tables: readonly string[],
) {
  if (!tables.length) return { columns: [], constraints: [], indexes: [] }
  const columns =
    await sql`SELECT cls.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,pg_get_expr(d.adbin,d.adrelid) AS column_default,
    a.attidentity::text AS identity_generation,a.attgenerated::text AS generated
    FROM pg_attribute a JOIN pg_class cls ON cls.oid=a.attrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE ns.nspname='public' AND cls.relname IN (${sql.join(tables)}) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY table_name,column_name`.execute(db)
  const constraints =
    await sql`SELECT cls.relname AS table_name,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class cls ON cls.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    WHERE ns.nspname='public' AND cls.relname IN (${sql.join(tables)}) ORDER BY cls.relname,c.conname`.execute(
      db,
    )
  const indexes =
    await sql`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (${sql.join(tables)}) ORDER BY tablename,indexname`.execute(
      db,
    )
  const value = {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  }
  return value
}

export async function publicTableNames(db: Executor) {
  return (
    await sql<{
      tablename: string
    }>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
      db,
    )
  ).rows.map((row) => row.tablename)
}
