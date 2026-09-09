import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs } from './helpers/archive-stubs.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetVouchers: vi.fn(),
  queryTargetOpenings: vi.fn(),
  getTargetVoucher: vi.fn(),
  reviewTargetVoucher: vi.fn(),
  queryTargetVoucherAudit: vi.fn(),
  deleteTargetVoucher: vi.fn(),
}))
const stubs = {
  ...archiveStubs,
  VPagination: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<button @click="$emit('update:modelValue',modelValue+1)">下一页</button>`,
  },
}
const id = '01J00000000000000000000001'
const row = {
  vouType: 'purchase-order' as const,
  documentId: id,
  documentNo: 'CG01',
  revision: '1',
  handlerName: null,
  businessDate: '2026-09-01',
  submittedDate: '2026-09-02',
  counterpartyName: '供应商',
  status: 'PENDING' as const,
  amount: '10.00',
  currency: 'CNY',
}
const page = { items: [row], page: 1, pageSize: 20 as const, total: 21 }
const detail = {
  entity: 'purchase-order',
  documentId: id,
  documentNo: 'CG01',
  submissionId: id,
  revision: '1',
  status: 'PENDING',
  submittedBy: 'submitter',
  availableApprovalActions: ['approve', 'reject'],
  payload: {
    businessDate: '2026-09-01',
    currency: 'CNY',
    remark: '原备注',
    attachments: [],
    supplier: {
      objectId: id,
      approvalEntryId: id,
      selectionOrigin: 'HISTORICAL',
    },
    warehouse: { objectId: id },
    productLines: [],
  },
} as Awaited<ReturnType<typeof api.getTargetVoucher>>
function host(entity = 'purchase-order') {
  return mount(ResourceHost, {
    props: { domain: 'vou', entity },
    global: { stubs },
  })
}
async function click(wrapper: VueWrapper, label: string) {
  if (label === '查询') {
    await wrapper.get('form.dynamic-form').trigger('submit')
    await flushPromises()
    return
  }
  const button = wrapper
    .findAll('button')
    .find((button) => button.text() === label)
  expect(button, `${label}: ${wrapper.text()}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.user = { id: 'reviewer', code: 'reviewer', name: '审批人' }
  session.csrfToken = 'csrf'
  session.apiPaths = ['query', 'get', 'approve', 'reject', 'audit-history'].map(
    (action) => `/vou/purchase-order/${action}`,
  )
  vi.mocked(api.queryTargetVouchers).mockResolvedValue(page)
  vi.mocked(api.getTargetVoucher).mockResolvedValue(detail)
})
it('pages with the submitted query snapshot and ignores a late earlier query', async () => {
  const first = deferred<typeof page>()
  vi.mocked(api.queryTargetVouchers).mockReturnValueOnce(first.promise)
  const wrapper = host()
  await flushPromises()
  await wrapper.get('[aria-label="单号"]').setValue('CG')
  await click(wrapper, '查询')
  await wrapper.get('[aria-label="单号"]').setValue('未提交条件')
  await click(wrapper, '下一页')
  expect(api.queryTargetVouchers).toHaveBeenLastCalledWith(
    'csrf',
    'purchase-order',
    expect.objectContaining({
      page: 2,
      filters: expect.objectContaining({ documentNo: 'CG' }),
    }),
  )
  first.resolve({ ...page, items: [{ ...row, documentNo: 'STALE' }] })
  await flushPromises()
  expect(wrapper.text()).toContain('CG01')
  expect(wrapper.text()).not.toContain('STALE')
  wrapper.unmount()
})
it('keeps failed reasons, cancels without writing or refreshing, and clears details on Session change', async () => {
  const wrapper = host()
  await flushPromises()
  await click(wrapper, '打开')
  await click(wrapper, '驳回')
  await wrapper.get('[aria-label="操作原因"]').setValue('需要修订')
  vi.mocked(api.reviewTargetVoucher).mockRejectedValue(
    new api.TargetApiError('approval_stale_revision', 'diagnostic', 'request'),
  )
  await click(wrapper, '确定')
  expect(wrapper.text()).toContain('单据已变化')
  expect(
    (wrapper.get('[aria-label="操作原因"]').element as HTMLTextAreaElement)
      .value,
  ).toBe('需要修订')
  await click(wrapper, '取消')
  expect(api.queryTargetVouchers).toHaveBeenCalledTimes(1)
  useTargetSession().generation++
  await flushPromises()
  expect(wrapper.find('[data-testid="vou-detail"]').exists()).toBe(false)
  wrapper.unmount()
})
it('does not replay an unknown review and unlocks only after its exact audit', async () => {
  vi.mocked(api.reviewTargetVoucher).mockRejectedValue(
    new TypeError('lost response'),
  )
  vi.mocked(api.queryTargetVoucherAudit).mockResolvedValue([])
  const wrapper = host()
  await flushPromises()
  await click(wrapper, '打开')
  await click(wrapper, '批准')
  await click(wrapper, '确定')
  await click(wrapper, '查询')
  await click(wrapper, '核实操作结果')
  expect(wrapper.text()).toContain('未知')
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    ...detail,
    revision: '2',
    status: 'APPROVED',
    availableApprovalActions: [],
  })
  vi.mocked(api.queryTargetVoucherAudit).mockResolvedValue([
    {
      submissionId: id,
      action: 'APPROVED',
      fromRevision: '1',
      toRevision: '2',
      actorId: 'reviewer',
      reason: null,
    },
  ] as Awaited<ReturnType<typeof api.queryTargetVoucherAudit>>)
  await click(wrapper, '核实操作结果')
  expect(api.reviewTargetVoucher).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('已批准')
  wrapper.unmount()
})
it('reports a successful approval separately when its single refresh fails', async () => {
  const wrapper = host()
  await flushPromises()
  await click(wrapper, '打开')
  vi.mocked(api.reviewTargetVoucher).mockResolvedValue({
    ...detail,
    revision: '2',
    status: 'APPROVED',
    availableApprovalActions: [],
  })
  vi.mocked(api.queryTargetVouchers).mockRejectedValue(
    new Error('refresh failed'),
  )
  await click(wrapper, '批准')
  await click(wrapper, '确定')
  expect(api.reviewTargetVoucher).toHaveBeenCalledTimes(1)
  expect(api.queryTargetVouchers).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('刷新失败')
  wrapper.unmount()
})
it('discards a delayed detail when the resource changes', async () => {
  const pending = deferred<typeof detail>()
  vi.mocked(api.getTargetVoucher).mockReturnValueOnce(pending.promise)
  const wrapper = host()
  await flushPromises()
  await click(wrapper, '打开')
  useTargetSession().apiPaths.push('/vou/sale-order/approve')
  await wrapper.setProps({ entity: 'sale-order' })
  pending.resolve(detail)
  await flushPromises()
  expect(wrapper.find('[data-testid="vou-detail"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('原备注')
  wrapper.unmount()
})
it('keeps opening deletion locked until the exact deletion audit is visible', async () => {
  const session = useTargetSession()
  session.user = { id: 'submitter', code: 'submitter', name: '提交人' }
  session.apiPaths = ['query', 'get', 'delete', 'audit-history'].map(
    (action) => `/vou/opening/${action}`,
  )
  vi.mocked(api.queryTargetOpenings).mockResolvedValue({
    ...page,
    items: [
      {
        ...row,
        vouType: 'opening',
        bookName: '账簿',
        amount: null,
        counterpartyName: null,
      },
    ],
  } as Awaited<ReturnType<typeof api.queryTargetOpenings>>)
  vi.mocked(api.getTargetVoucher).mockResolvedValue({
    ...detail,
    entity: 'opening',
    bookId: id,
    bookName: '账簿',
    businessDate: row.businessDate,
    availableApprovalActions: [],
    payload: { bookId: id, lines: [], assets: [], bills: [], containers: [] },
  } as Awaited<ReturnType<typeof api.getTargetVoucher>>)
  vi.mocked(api.deleteTargetVoucher).mockRejectedValue(
    new TypeError('lost response'),
  )
  const wrapper = host('opening')
  await flushPromises()
  await click(wrapper, '打开')
  await click(wrapper, '删除开放提交')
  await click(wrapper, '确定删除')
  await click(wrapper, '查询')
  expect(api.deleteTargetVoucher).toHaveBeenCalledTimes(1)
  vi.mocked(api.getTargetVoucher).mockRejectedValue(
    new api.TargetApiError('approval_not_found', '', 'req'),
  )
  vi.mocked(api.queryTargetVoucherAudit).mockResolvedValue([
    {
      submissionId: id,
      action: 'DELETED',
      fromRevision: '1',
      actorId: 'submitter',
      reason: null,
    },
  ] as Awaited<ReturnType<typeof api.queryTargetVoucherAudit>>)
  await click(wrapper, '核实操作结果')
  expect(wrapper.find('[data-testid="vou-detail"]').exists()).toBe(false)
  expect(api.deleteTargetVoucher).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
