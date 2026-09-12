import { createRoute, z } from '@hono/zod-openapi'

export const optionIds = z
  .union([z.string(), z.array(z.string()).max(100)])
  .transform((value) => (typeof value === 'string' ? [value] : value))
  .pipe(z.array(z.string().min(1).max(64)).min(1).max(100))

export const optionPageInput = z
  .object({
    ids: optionIds.optional(),
    keyword: z.string().trim().max(200).default(''),
    page: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(z.number().int().max(100000)),
    pageSize: z.literal('20').transform(() => 20 as const),
  })
  .strict()
export const optionBoolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
export const optionIdentity = z
  .object({
    objectId: z.string(),
    code: z.string(),
    name: z.string(),
    enabled: z.boolean(),
  })
  .strict()
export function optionPage<Item extends z.ZodType>(item: Item) {
  return z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.literal(20),
    })
    .strict()
}
export function auxiliaryRoute<
  const Path extends string,
  Input extends z.ZodObject,
  Data extends z.ZodType,
>(path: Path, input: Input, data: Data) {
  return createRoute({
    method: 'get',
    path,
    request: { query: input },
    responses: {
      200: {
        description: '辅助读取',
        content: {
          'application/json': {
            schema: z.union([
              z.object({
                code: z.literal(0),
                errorKey: z.literal(''),
                message: z.literal('ok'),
                data,
                requestId: z.string(),
              }),
              z.object({
                code: z.union([
                  z.literal(1001),
                  z.literal(1002),
                  z.literal(2001),
                  z.literal(3001),
                  z.literal(5000),
                ]),
                errorKey: z.string(),
                message: z.string(),
                data: z.null(),
                requestId: z.string(),
              }),
            ]),
          },
        },
      },
    },
  })
}
