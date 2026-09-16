export {
  seedSaleOrderReferences,
  saleOrderPayload,
  sourceOrderLineId,
} from '../../scripts/lib/business-references.ts'

/** Keep the shared zerp database intact while services retain transaction rollback behavior. */
export async function withWflDatabase(
  run: (
    db: import('kysely').Kysely<import('../../src/db/generated.ts').DB>,
  ) => Promise<void>,
) {
  const { createDatabase } = await import('../../src/db/database.ts')
  const { sql } = await import('kysely')
  if (!process.env.TARGET_TEST_DATABASE_URL)
    throw new Error('TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const rollback = new Error('rollback WFL fixture')
  try {
    await db.transaction().execute(async (tx) => {
      let next = 0
      const scoped = new Proxy(tx, {
        get(target, key) {
          if (key === 'transaction')
            return () => ({
              execute: async (fn: (tx: typeof target) => Promise<unknown>) => {
                const name = `wfl_test_${++next}`
                await sql.raw(`SAVEPOINT ${name}`).execute(target)
                try {
                  const result = await fn(target)
                  await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(target)
                  return result
                } catch (e) {
                  await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(target)
                  throw e
                }
              },
            })
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      await run(scoped)
      throw rollback
    })
  } catch (e) {
    if (e !== rollback) throw e
  } finally {
    await db.destroy()
  }
}
