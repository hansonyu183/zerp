import { z } from '@hono/zod-openapi'

export const userRevisionSchema = z.string().regex(/^[1-9]\d*$/)

export const userSummarySchema = z
  .object({
    id: z.string(),
    code: z.string(),
    py: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    revision: userRevisionSchema,
    availableActions: z.array(z.enum(['VIEW', 'EDIT', 'ENABLE', 'DISABLE'])),
  })
  .strict()
