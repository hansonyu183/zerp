import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { usePaymentMethodManagementViewModel } from '@/target/pages/aux/payment-method/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  createTargetPaymentMethod: vi.fn(),
  saveTargetPaymentMethod: vi.fn(),
  getTargetPaymentMethod: vi.fn(),
}))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.csrfToken = 'test'
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
  session.apiPaths = ['create', 'get', 'save'].map(
    (action) => `/aux/payment-method/${action}`,
  )
})
it.each(['-1', '1.234', '1e2', '', '01.00', '.5'])(
  'rejects invalid amount %s without writing',
  async (amount) => {
    const vm = usePaymentMethodManagementViewModel()
    const completion = vm.openCreate()
    Object.assign(vm.editor, { name: '现金', defaultSalesSurcharge: amount })
    await vm.saveEditor()
    expect(api.createTargetPaymentMethod).not.toHaveBeenCalled()
    expect(vm.editorError.value).toContain('最多两位小数')
    vm.closeEditor()
    expect(await completion).toBeUndefined()
  },
)
it.each(['0.00', '0.1', '9007199254740993.12'])(
  'preserves decimal string %s in create',
  async (amount) => {
    vi.mocked(api.createTargetPaymentMethod).mockResolvedValue({
      id: 'payment',
      revision: '1',
      enabled: true,
    })
    const vm = usePaymentMethodManagementViewModel()
    const completion = vm.openCreate()
    expect(vm.editor.defaultSalesSurcharge).toBe('0.00')
    Object.assign(vm.editor, {
      name: '现金',
      description: '说明',
      defaultSalesSurcharge: amount,
    })
    await vm.saveEditor()
    expect(api.createTargetPaymentMethod).toHaveBeenCalledWith('test', {
      name: '现金',
      description: '说明',
      defaultSalesSurcharge: amount,
    })
    expect(await completion).toBe('changed')
  },
)
it('fills detail and preserves amount and revision on save', async () => {
  const detail = {
    id: 'payment',
    code: 'PMT-0001',
    py: 'xianjin',
    name: '现金',
    description: '说明',
    defaultSalesSurcharge: '9007199254740993.12',
    revision: '9007199254740993',
    enabled: true,
    availableActions: ['edit'] as 'edit'[],
    updatedAt: '2026-09-06T00:00:00.000Z',
    updatedBy: 'admin',
  }
  vi.mocked(api.getTargetPaymentMethod).mockResolvedValue(detail)
  vi.mocked(api.saveTargetPaymentMethod).mockResolvedValue({
    id: detail.id,
    revision: '9007199254740994',
    enabled: true,
  })
  const vm = usePaymentMethodManagementViewModel()
  const completion = vm.openEdit(detail)
  await flushPromises()
  expect(vm.editor.defaultSalesSurcharge).toBe(detail.defaultSalesSurcharge)
  await vm.saveEditor()
  expect(api.saveTargetPaymentMethod).toHaveBeenCalledWith('test', {
    id: detail.id,
    revision: detail.revision,
    name: '现金',
    description: '说明',
    defaultSalesSurcharge: detail.defaultSalesSurcharge,
  })
  expect(await completion).toBe('changed')
})
it('isolates a pending create after disposal', async () => {
  let resolve!: (value: {
    id: string
    revision: string
    enabled: boolean
  }) => void
  vi.mocked(api.createTargetPaymentMethod).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const vm = usePaymentMethodManagementViewModel()
  const completion = vm.openCreate()
  Object.assign(vm.editor, { name: '现金', defaultSalesSurcharge: '0.01' })
  const saving = vm.saveEditor()
  vm.dispose()
  resolve({ id: 'late', revision: '1', enabled: true })
  await saving
  expect(await completion).toBeUndefined()
  expect(vm.lastCreatedId.value).toBeNull()
  expect(vm.editorOpen.value).toBe(false)
})
it('reports a revision conflict without replaying the write', async () => {
  vi.mocked(api.createTargetPaymentMethod).mockRejectedValue(
    new api.TargetApiError('conflict', 'diagnostic', 'test'),
  )
  const vm = usePaymentMethodManagementViewModel()
  const completion = vm.openCreate()
  Object.assign(vm.editor, { name: '现金', defaultSalesSurcharge: '0.01' })
  await vm.saveEditor()
  await vm.saveEditor()
  expect(vm.editorError.value).toContain('状态已变化')
  expect(api.createTargetPaymentMethod).toHaveBeenCalledTimes(1)
  vm.closeEditor()
  await completion
})
it('blocks replay after an unknown write result', async () => {
  vi.mocked(api.createTargetPaymentMethod).mockRejectedValue(
    new Error('network'),
  )
  const vm = usePaymentMethodManagementViewModel()
  const completion = vm.openCreate()
  const rejected = expect(completion).rejects.toThrow('请求结果未知')
  Object.assign(vm.editor, { name: '现金', defaultSalesSurcharge: '0.01' })
  await vm.saveEditor()
  await rejected
  await vm.saveEditor()
  expect(api.createTargetPaymentMethod).toHaveBeenCalledTimes(1)
  expect(vm.canSave.value).toBe(false)
})
