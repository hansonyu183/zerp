import { randomBytes } from 'node:crypto'
import type { Kysely } from 'kysely'
import { ulid } from 'ulid'
import type { DB } from '../../src/db/generated.ts'
import { AccService } from '../../src/acc/service.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

export async function seedOpeningFixture(db: Kysely<DB>) {
  const bootstrap = new TargetBootstrapService(db)
  const catalog = await readTargetPermissionCatalog()
  // Catalog conversion is tested separately; this fixture installs only newly added paths.
  const existing = new Set(
    (await db.selectFrom('app_permissions').select('path').execute()).map(
      (row) => row.path,
    ),
  )
  const missing = catalog.filter(
    (row) => row.path.startsWith('/vou/opening/') && !existing.has(row.path),
  )
  if (missing.length)
    await db
      .insertInto('app_permissions')
      .values(
        missing.map((row) => ({
          id: row.id,
          path: row.path,
          domain: row.domain,
          entity: row.entity,
          action: row.action,
          description: row.title,
          status: 'ENABLED' as const,
        })),
      )
      .execute()
  const permissions = [
    ...catalog
      .filter((row) => row.path.startsWith('/vou/opening/'))
      .map((row) => row.path),
    '/acc/book/query',
    '/acc/book/get',
    '/acc/subject/query',
  ]
  const password = randomBytes(24).toString('base64url')
  const passwordHash = await hashPassword(password)
  async function principal(paths: string[]) {
    const principal = {
      userId: ulid(),
      roleId: ulid(),
      username: `opening-${ulid()}`,
      passwordHash,
      password,
    }
    await bootstrap.createE2EPrincipal(principal, false, paths)
    return { ...principal, actor: { id: principal.userId, permissions: paths } }
  }
  const submitter = await principal(permissions)
  const reviewer = await principal(permissions)
  const outsider = await principal(permissions)
  const noQuery = await principal(['/vou/opening/approve'])
  const reader = await principal(permissions)
  const acc = new AccService(db)
  const opening = new VouOpeningService(db, acc)
  const trusted = { ...submitter.actor, trusted: true }
  const book = await acc.createBook(
    {
      id: ulid(),
      name: '期初验收账簿',
      description: '',
      startMonth: '2026-09',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [
        submitter.userId,
        reviewer.userId,
        reader.userId,
        noQuery.userId,
      ],
      operateUserIds: [submitter.userId, reviewer.userId, noQuery.userId],
    },
    trusted,
  )
  const debit = await acc.createSubject(
    {
      id: ulid(),
      bookId: book.id,
      code: '1001',
      name: '期初借方',
      parentId: null,
      balanceDirection: 'DEBIT',
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    },
    trusted,
  )
  const credit = await acc.createSubject(
    {
      ...debit,
      id: ulid(),
      code: '3001',
      name: '期初贷方',
      balanceDirection: 'CREDIT',
    },
    trusted,
  )
  const input = {
    bookId: book.id,
    submissionId: ulid(),
    idempotencyKey: ulid(),
    lines: [],
    assets: [],
    bills: [],
    containers: [],
  }
  return {
    acc,
    opening,
    book,
    debit,
    credit,
    input,
    submitter,
    reviewer,
    outsider,
    noQuery,
    reader,
  }
}
