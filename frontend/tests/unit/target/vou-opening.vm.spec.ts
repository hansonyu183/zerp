import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { useTargetSession } from '@/target/session/vm.ts'
import {
  openingPage,
  useOpeningEditorViewModel,
} from '@/target/pages/vou/opening/vm.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetOpenings: vi.fn(),
  deleteTargetVoucher: vi.fn(),
  queryTargetVoucherAudit: vi.fn(),
  queryTargetAccountingBooks: vi.fn(),
  queryTargetAccountingSubjects: vi.fn(),
  queryTargetVouReferences: vi.fn(),
  submitTargetOpening: vi.fn(),
  getTargetOpening: vi.fn(),
}))
const bookId = '01J00000000000000000000001'
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.csrfToken = 'csrf'
  session.apiPaths = [
    '/vou/opening/submit-new',
    '/vou/opening/get',
    '/acc/book/query',
    '/acc/subject/query',
  ]
  vi.mocked(api.queryTargetAccountingBooks).mockResolvedValue({
    items: [
      { id: bookId, name: '测试账簿', code: 'ACC-0001', baseCurrency: 'CNY' },
    ],
    total: 1,
    page: 1,
    pageSize: 200,
  } as never)
  vi.mocked(api.queryTargetAccountingSubjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 200,
  })
})
it('retains a failed form and its submit identity, but closes and new instances never restore it', async () => {
  const changed = vi.fn().mockResolvedValue(true)
  const vm = useOpeningEditorViewModel(changed)
  await vm.openCreate()
  await vm.selectBook(bookId)
  vm.addLine()
  vm.draft.value.lines[0]!.amount = '12.30'
  const submissionId = vm.draft.value.submissionId
  vi.mocked(api.submitTargetOpening).mockRejectedValueOnce(
    new api.TargetApiError('acc_opening_unbalanced', 'diagnostic', 'req'),
  )
  await vm.submit()
  expect(vm.error.value).toContain('逐币种')
  expect(vm.open.value).toBe(true)
  expect(vm.draft.value.lines[0]!.amount).toBe('12.30')
  expect(vm.draft.value.submissionId).toBe(submissionId)
  expect(changed).not.toHaveBeenCalled()
  vm.close()
  await vm.openCreate()
  expect(vm.draft.value.lines).toEqual([])
  expect(vm.draft.value.submissionId).not.toBe(submissionId)
  vm.dispose()
  const fresh = useOpeningEditorViewModel(changed)
  expect(fresh.open.value).toBe(false)
  expect(fresh.draft.value.lines).toEqual([])
  fresh.dispose()
})
it.each([
  new TypeError('connection lost'),
  new api.TargetApiError('invalid_response', 'invalid response', 'req'),
])(
  'never replays unknown submission, verifies the same submission and refreshes once (%s)',
  async (failure) => {
    const changed = vi.fn().mockResolvedValue(true)
    const vm = useOpeningEditorViewModel(changed)
    await vm.openCreate()
    await vm.selectBook(bookId)
    const submissionId = vm.draft.value.submissionId
    vi.mocked(api.submitTargetOpening).mockRejectedValueOnce(failure)
    await vm.submit()
    await vm.submit()
    expect(api.submitTargetOpening).toHaveBeenCalledTimes(1)
    expect(vm.unknown.value).toBe(true)
    vi.mocked(api.getTargetOpening).mockResolvedValue({
      submissionId,
      bookId,
    } as never)
    await vm.verify()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(vm.open.value).toBe(false)
    vm.dispose()
  },
)
it('does not request reference data without exact authority and ignores results after account change', async () => {
  const session = useTargetSession()
  session.apiPaths = ['/vou/opening/submit-new']
  const vm = useOpeningEditorViewModel(vi.fn())
  await vm.openCreate()
  await vm.loadReference('employee')
  expect(api.queryTargetAccountingBooks).not.toHaveBeenCalled()
  expect(api.queryTargetVouReferences).not.toHaveBeenCalled()
  session.generation++
  expect(vm.open.value).toBe(false)
  expect(vm.draft.value.bookId).toBe('')
  vm.dispose()
})

it('omits the renderer empty status when querying the real opening contract', async () => {
  await openingPage.search('csrf', {
    ...openingPage.normalizeFilters(openingPage.initialFilters()),
    page: 1,
  })
  expect(api.queryTargetOpenings).toHaveBeenCalledWith(
    'csrf',
    expect.objectContaining({ status: undefined, pageSize: 20 }),
  )
})
it.each([false, true])(
  'clones into a fresh intent and verifies an unknown original deletion before resubmission (%s)',
  async (unknown) => {
    const session = useTargetSession()
    session.apiPaths.push('/vou/opening/delete', '/vou/opening/audit-history')
    session.user = { id: 'submitter' } as never
    const changed = vi.fn().mockResolvedValue(true)
    const vm = useOpeningEditorViewModel(changed)
    const original = {
      entity: 'opening',
      bookId,
      documentId: bookId,
      submissionId: 'original',
      revision: '1',
      status: 'PENDING',
      submittedBy: 'submitter',
      payload: {
        bookId,
        submissionId: 'original',
        idempotencyKey: 'old-key',
        lines: [],
        assets: [],
        bills: [],
        containers: [],
      },
    }
    await vm.cloneSubmission(original as never)
    expect(vm.draft.value.submissionId).not.toBe('original')
    expect(vm.source.value?.submissionId).toBe('original')
    await vm.submit()
    expect(api.submitTargetOpening).not.toHaveBeenCalled()
    vi.mocked(api.deleteTargetVoucher).mockResolvedValue({
      deleted: true,
      submissionId: 'original',
    } as never)
    if (unknown) {
      vi.mocked(api.deleteTargetVoucher).mockRejectedValueOnce(
        new api.TargetApiError('invalid_response', 'invalid response', 'req'),
      )
    }
    await vm.deleteSource()
    if (unknown) {
      await vm.deleteSource()
      expect(api.deleteTargetVoucher).toHaveBeenCalledTimes(1)
      expect(vm.unknown.value).toBe(true)
      vi.mocked(api.queryTargetVoucherAudit).mockResolvedValue([
        {
          action: 'DELETED',
          submissionId: 'original',
          fromRevision: '1',
          actorId: 'submitter',
        },
      ] as never)
      await vm.verify()
      expect(vm.unknown.value).toBe(false)
    }
    expect(vm.source.value).toBeNull()
    expect(vm.open.value).toBe(true)
    expect(api.deleteTargetVoucher).toHaveBeenCalledWith('csrf', 'opening', {
      documentId: bookId,
      submissionId: 'original',
      expectedRevision: '1',
    })
    expect(changed).toHaveBeenCalledTimes(1)
    vm.dispose()
  },
)
