import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useTypedBusinessArchiveViewModel } from '@/pages/bob/shared/typed-business-archive'
import { useSessionStore } from '@/stores/session'
vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
describe('Supplier current profile', () => { beforeEach(() => { setActivePinia(createPinia()); useSessionStore().permissions = ['/bob/supplier/get']; vi.clearAllMocks() }); it('only queries the supplier current profile', async () => { vi.mocked(apiClient.postContract).mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 } } as never); const vm = useTypedBusinessArchiveViewModel('supplier'); await vm.query(); expect(vi.mocked(apiClient.postContract)).toHaveBeenCalledWith('bob/supplier/query', expect.any(Object)) }) })
