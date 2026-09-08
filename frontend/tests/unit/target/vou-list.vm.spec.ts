import { openingPage } from '@/target/pages/vou/opening/vm.ts'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { useTargetSession } from '@/target/session/vm.ts'
import { saleOrderPage } from '@/target/navigation/vou-pages.ts'
import { useVouListViewModel } from '@/target/components/vou-list-page/vm.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetVouchers: vi.fn(),
  getTargetVoucher: vi.fn(),
  reviewTargetVoucher: vi.fn(),
  queryTargetVoucherAudit: vi.fn(),
  deleteTargetVoucher: vi.fn(),
}))
const id = '01J00000000000000000000001'
const row = {
  vouType: 'sale-order' as const,
  documentId: id,
  documentNo: 'XS01',
  revision: '1',
  handlerName: null,
  businessDate: '2026-09-01',
  submittedDate: '2026-09-02',
  counterpartyName: '客户',
  status: 'PENDING' as const,
  amount: '10.00',
  currency: 'CNY',
}
const page = { items: [row], page: 1, pageSize: 20 as const, total: 21 }
function authorize(...actions: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf'
  session.apiPaths = actions.map((a) => `/vou/sale-order/${a}`)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  vi.mocked(api.queryTargetVouchers).mockResolvedValue(page)
})
it('only queries with exact permission and pages with the submitted nested filter snapshot', async () => {
  authorize('approve')
  const denied = useVouListViewModel(saleOrderPage)
  await denied.initialize()
  expect(api.queryTargetVouchers).not.toHaveBeenCalled()
  authorize('query')
  const vm = useVouListViewModel(saleOrderPage)
  vm.filterInput.value = {
    ...vm.filterInput.value,
    businessDate: { from: '2026-01-01', to: '2026-01-31' },
    documentNo: 'XS',
  }
  await vm.submitSearch()
  vm.filterInput.value.businessDate.from = '2026-02-01'
  await vm.goToPage(2)
  expect(api.queryTargetVouchers).toHaveBeenLastCalledWith(
    'csrf',
    'sale-order',
    expect.objectContaining({
      page: 2,
      filters: expect.objectContaining({
        dateFrom: '2026-01-01',
        documentNo: 'XS',
      }),
    }),
  )
})
it('ignores stale query and detail results after dispose or account change', async () => {
  authorize('query', 'get')
  const pending = deferred<typeof page>()
  vi.mocked(api.queryTargetVouchers).mockReturnValueOnce(pending.promise)
  const vm = useVouListViewModel(saleOrderPage)
  const first = vm.initialize()
  await vm.submitSearch()
  pending.resolve({ ...page, items: [{ ...row, documentNo: 'OLD' }] })
  await first
  expect(vm.items.value[0]?.documentNo).toBe('XS01')
  const detail = deferred<Awaited<ReturnType<typeof api.getTargetVoucher>>>()
  vi.mocked(api.getTargetVoucher).mockReturnValueOnce(detail.promise)
  const open = vm.open(row)
  vm.dispose()
  detail.resolve({ documentId: id } as never)
  await open
  expect(vm.selected.value).toBeNull()
})
it('does not replay unknown approval after ordinary refresh and refreshes a confirmed write once', async () => {
  authorize('query', 'get', 'approve')
  const detail = {
    documentId: id,
    entity: 'sale-order',
    submissionId: 'submission',
    revision: '1',
    status: 'PENDING',
    availableApprovalActions: ['approve'],
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>
  vi.mocked(api.getTargetVoucher).mockResolvedValue(detail)
  const vm = useVouListViewModel(saleOrderPage)
  await vm.open(row)
  vi.mocked(api.reviewTargetVoucher).mockRejectedValueOnce(
    new Error('network lost'),
  )
  await vm.review('approve', '')
  await vm.refresh()
  await vm.review('approve', '')
  expect(api.reviewTargetVoucher).toHaveBeenCalledTimes(1)
  expect(vm.unknown.value.has(id)).toBe(true)
  const next = useVouListViewModel(saleOrderPage)
  await next.open(row)
  vi.mocked(api.reviewTargetVoucher).mockResolvedValue({
    ...detail,
    status: 'APPROVED',
    revision: '2',
    availableApprovalActions: [],
  })
  vi.mocked(api.queryTargetVouchers).mockClear()
  await next.review('approve', '')
  expect(api.queryTargetVouchers).toHaveBeenCalledTimes(1)
  expect(next.feedback.value).toBe('操作成功。')
})

it('unlocks unknown approval only after exact authorized audit evidence', async () => {
  authorize('query', 'get', 'approve', 'audit-history')
  useTargetSession().user = { id: 'reviewer', code: 'reviewer', name: '审批人' }
  const detail = {
    documentId: id,
    entity: 'sale-order',
    submissionId: 'submission',
    revision: '1',
    status: 'PENDING',
    availableApprovalActions: ['approve'],
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>
  vi.mocked(api.getTargetVoucher).mockResolvedValue(detail)
  vi.mocked(api.reviewTargetVoucher).mockRejectedValue(
    new Error('lost response'),
  )
  vi.mocked(api.queryTargetVoucherAudit).mockResolvedValue([])
  const vm = useVouListViewModel(saleOrderPage)
  await vm.open(row)
  await vm.review('approve', '')
  await vm.verifyOutcome()
  expect(vm.unknown.value.has(id)).toBe(true)
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    ...detail,
    status: 'APPROVED',
    revision: '2',
    availableApprovalActions: [],
  })
  vi.mocked(api.queryTargetVoucherAudit).mockResolvedValue([
    {
      submissionId: 'submission',
      action: 'APPROVED',
      fromRevision: '1',
      toRevision: '2',
      actorId: 'reviewer',
      reason: null,
    },
  ] as never)
  await vm.verifyOutcome()
  expect(vm.unknown.value.has(id)).toBe(false)
  expect(api.reviewTargetVoucher).toHaveBeenCalledTimes(1)
  expect(vm.selected.value?.status).toBe('APPROVED')
})

it('keeps a failed approval reason, cancels without refresh, and clears detail on account switch', async () => {
  authorize('query', 'get', 'reject')
  const detail = {
    documentId: id,
    entity: 'sale-order',
    submissionId: 'submission',
    revision: '1',
    status: 'PENDING',
    availableApprovalActions: ['reject'],
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>
  vi.mocked(api.getTargetVoucher).mockResolvedValue(detail)
  const vm = useVouListViewModel(saleOrderPage)
  await vm.open(row)
  vm.requestReview('reject')
  vm.reason.value = '需要修订'
  vi.mocked(api.reviewTargetVoucher).mockRejectedValue(
    new api.TargetApiError('approval_stale_revision', 'diagnostic', 'request'),
  )
  await vm.confirmReview()
  expect(vm.requestedAction.value).toBe('reject')
  expect(vm.reason.value).toBe('需要修订')
  expect(api.queryTargetVouchers).not.toHaveBeenCalled()
  vm.cancelReview()
  expect(vm.requestedAction.value).toBeNull()
  expect(api.queryTargetVouchers).not.toHaveBeenCalled()
  useTargetSession().generation += 1
  expect(vm.selected.value).toBeNull()
  expect(vm.reason.value).toBe('')
})

it('does not attribute another rejection reason to an unknown command', async () => {
  authorize('get', 'reject', 'audit-history')
  useTargetSession().user = { id: 'reviewer', code: 'reviewer', name: '审批人' }
  const detail = {
    documentId: id,
    entity: 'sale-order',
    submissionId: 'submission',
    revision: '1',
    status: 'PENDING',
    availableApprovalActions: ['reject'],
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>
  vi.mocked(api.getTargetVoucher).mockResolvedValue(detail)
  vi.mocked(api.reviewTargetVoucher).mockRejectedValue(
    new Error('lost response'),
  )
  const vm = useVouListViewModel(saleOrderPage)
  await vm.open(row)
  await vm.review('reject', '本次原因')
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    ...detail,
    status: 'REJECTED',
    revision: '2',
    availableApprovalActions: [],
  })
  vi.mocked(api.queryTargetVoucherAudit).mockResolvedValue([
    {
      submissionId: 'submission',
      action: 'REJECTED',
      fromRevision: '1',
      actorId: 'reviewer',
      reason: '另一标签页原因',
    },
  ] as never)
  await vm.verifyOutcome()
  expect(vm.feedback.value).toBe('已核实原修订已变化，此次操作未写入。')
  expect(api.reviewTargetVoucher).toHaveBeenCalledTimes(1)
})

it('opening deletion stays locked after a lost response until the exact deletion audit is verified', async () => {
  const session = useTargetSession()
  session.csrfToken = 'csrf'
  session.apiPaths = ['get', 'query', 'delete', 'audit-history'].map(
    (action) => `/vou/opening/${action}`,
  )
  session.user = { id: 'submitter', code: 'submitter', name: '提交人' }
  const detail = {
    documentId: id,
    entity: 'opening',
    submissionId: 'submission',
    revision: '1',
    status: 'PENDING',
    submittedBy: 'submitter',
    availableApprovalActions: [],
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>
  vi.mocked(api.getTargetVoucher).mockResolvedValue(detail)
  vi.mocked(api.deleteTargetVoucher).mockRejectedValue(
    new TypeError('lost response'),
  )
  const registration = {
    ...openingPage,
    search: vi
      .fn()
      .mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }),
  }
  const vm = useVouListViewModel(registration)
  await vm.open({
    ...row,
    vouType: 'opening',
    bookName: '账簿',
    counterpartyName: null,
    amount: null,
  })
  expect(vm.canDelete.value).toBe(true)
  await vm.deleteSelected()
  await vm.deleteSelected()
  await vm.refresh()
  expect(api.deleteTargetVoucher).toHaveBeenCalledTimes(1)
  expect(vm.unknown.value.has(id)).toBe(true)
  vi.mocked(api.getTargetVoucher).mockRejectedValue(
    new api.TargetApiError('approval_not_found', 'not found', 'req'),
  )
  vi.mocked(api.queryTargetVoucherAudit).mockResolvedValue([
    {
      submissionId: 'submission',
      action: 'DELETED',
      fromRevision: '1',
      actorId: 'submitter',
      reason: null,
    },
  ] as never)
  await vm.verifyOutcome()
  expect(vm.selected.value).toBeNull()
  expect(vm.unknown.value.has(id)).toBe(false)
  expect(api.deleteTargetVoucher).toHaveBeenCalledTimes(1)
  vm.dispose()
})
