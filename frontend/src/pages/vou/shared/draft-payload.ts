import type { ApiPostRequest } from '@/api/client'

export type DraftPayload = ApiPostRequest<'vou/purchase-order/create'>['data']
