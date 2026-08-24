import { apiClient, type ApiPostRequest } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type BobReferenceCandidate = components['schemas']['ReferenceCandidate']

export const bobSharedApi = {
  queryReferenceCandidates: (input: ApiPostRequest<'bob/reference/query'>) =>
    apiClient.postContract('bob/reference/query', input),
}
