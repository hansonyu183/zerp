import { createHash } from 'node:crypto'
import { z } from 'zod'

const decimal = z.string().regex(/^(0|[1-9]\d{0,29})$/)
export const sourceUserPlanSchema = z
  .object({
    source: z.string().min(1).max(200),
    sourceRevision: decimal,
    databaseName: z.string().min(1),
    roles: z.array(
      z
        .object({
          code: z.string().min(1).max(64),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
    users: z
      .array(
        z
          .object({
            sourceKey: z.string().min(1).max(128),
            code: z.string().min(1).max(64),
            name: z.string().min(1).max(128),
            sourceEnabled: z.boolean(),
            sourceEmployeeKey: z.string().max(128).default(''),
            employeeId: z
              .string()
              .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
              .nullable()
              .optional(),
            roleCodes: z.array(z.string().min(1).max(64)),
            blockedReasons: z.array(z.string().min(1).max(200)),
            expectedRevision: decimal,
            deleted: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()

export type SourceUserPlan = z.infer<typeof sourceUserPlanSchema>
export type SourceUserInput = SourceUserPlan['users'][number]

export function migrationDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function sourceUserDigest(user: SourceUserInput): string {
  return migrationDigest({
    code: user.code.trim().toLowerCase(),
    name: user.name.trim(),
    sourceEnabled: user.sourceEnabled,
    sourceEmployeeKey: user.sourceEmployeeKey,
    employeeId: user.employeeId,
    roleCodes: [...new Set(user.roleCodes)].sort(),
    blockedReasons: [...new Set(user.blockedReasons)].sort(),
    deleted: user.deleted,
  })
}

export class SourceUserMigrationError extends Error {
  readonly reason: string
  readonly sourceKey?: string
  constructor(reason: string, sourceKey?: string) {
    super(reason)
    this.name = 'SourceUserMigrationError'
    this.reason = reason
    this.sourceKey = sourceKey
  }
}
