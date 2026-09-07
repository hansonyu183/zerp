import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { useMappingViewModel } from '@/target/pages/acc/mapping/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  getTargetMappingCatalog: vi.fn(),
  queryTargetMappings: vi.fn(),
  getTargetMapping: vi.fn(),
  saveTargetMapping: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
})
it('mapping only loads authorized resources and keeps failed input until closing', async () => {
  const session = useTargetSession()
  session.csrfToken = 'test'
  session.apiPaths = ['/acc/mapping/save']
  const vm = useMappingViewModel()
  await vm.initialize()
  expect(api.getTargetMappingCatalog).not.toHaveBeenCalled()
  expect(api.queryTargetMappings).not.toHaveBeenCalled()
  vm.create()
  vm.draft.value.bookId = 'book'
  vm.draft.value.vouEntity = 'sale-order'
  vi.mocked(api.saveTargetMapping).mockRejectedValue(
    new api.TargetApiError('acc_mapping_invalid_data', 'bad', 'request'),
  )
  await vm.save()
  expect(vm.draft.value.bookId).toBe('book')
  expect(vm.error.value).toBe('映射配置无效，请检查条件、模板、科目与维度。')
  vm.close()
  vm.create()
  expect(vm.draft.value.bookId).toBe('')
  vm.dispose()
})
it('unknown writes are not replayed or unlocked by an ordinary query; stale reads cannot reopen a closed editor', async () => {
  const session = useTargetSession()
  session.csrfToken = 'test'
  session.apiPaths = [
    '/acc/mapping/save',
    '/acc/mapping/query',
    '/acc/mapping/get',
  ]
  const vm = useMappingViewModel()
  vm.create()
  vm.draft.value.bookId = 'book'
  vm.draft.value.vouEntity = 'sale-order'
  vi.mocked(api.saveTargetMapping).mockRejectedValue(new Error('network'))
  await vm.save()
  expect(vm.unknown.value).toBe(true)
  vi.mocked(api.queryTargetMappings).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  vm.bookId.value = 'book'
  await vm.search()
  await vm.save()
  expect(api.saveTargetMapping).toHaveBeenCalledTimes(1)
  let resolve!: (
    value: Awaited<ReturnType<typeof api.getTargetMapping>>,
  ) => void
  vi.mocked(api.getTargetMapping).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const opening = vm.edit('book', 'sale-order')
  vm.close()
  resolve({
    subjectId: 'id',
    revision: '1',
    book: { id: 'book', code: 'B', name: '账簿' },
    vouEntity: { id: 'sale-order', code: 'sale-order', name: '销售订单' },
    defaultResult: 'UN_POST',
    definition: {
      defaultTemplateId: null,
      rules: [],
      templates: [],
      assetConfiguration: null,
    },
  })
  await opening
  expect(vm.open.value).toBe(false)
  vm.dispose()
})
