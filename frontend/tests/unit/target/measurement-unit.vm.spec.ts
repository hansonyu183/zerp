import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { useMeasurementUnitManagementViewModel } from '@/target/pages/aux/measurement-unit/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  createTargetMeasurementUnit: vi.fn(),
  saveTargetMeasurementUnit: vi.fn(),
  getTargetMeasurementUnit: vi.fn(),
}))
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.csrfToken = 'test'
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
  session.apiPaths = ['create', 'get', 'save'].map(
    (action) => `/aux/measurement-unit/${action}`,
  )
})
it.each([-1, 7, 1.5])(
  'rejects invalid precision %s before writing',
  async (quantityScale) => {
    const vm = useMeasurementUnitManagementViewModel()
    const completion = vm.openCreate()
    Object.assign(vm.editor, { name: '千克', symbol: 'kg', quantityScale })
    await vm.saveEditor()
    expect(api.createTargetMeasurementUnit).not.toHaveBeenCalled()
    expect(vm.editorError.value).toContain('0–6')
    vm.closeEditor()
    expect(await completion).toBeUndefined()
  },
)
it('rejects blank symbol and cancels without a change', async () => {
  const vm = useMeasurementUnitManagementViewModel()
  const completion = vm.openCreate()
  Object.assign(vm.editor, { name: '千克', symbol: ' ' })
  await vm.saveEditor()
  expect(api.createTargetMeasurementUnit).not.toHaveBeenCalled()
  vm.closeEditor()
  expect(await completion).toBeUndefined()
})
it('isolates a pending create after disposal', async () => {
  let resolve!: (value: {
    id: string
    revision: string
    enabled: boolean
  }) => void
  vi.mocked(api.createTargetMeasurementUnit).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const vm = useMeasurementUnitManagementViewModel()
  const completion = vm.openCreate()
  Object.assign(vm.editor, { name: '千克', symbol: 'kg', quantityScale: 3 })
  const saving = vm.saveEditor()
  vm.dispose()
  resolve({ id: 'late', revision: '1', enabled: true })
  await saving
  expect(await completion).toBeUndefined()
  expect(vm.lastCreatedId.value).toBeNull()
  expect(vm.editorOpen.value).toBe(false)
})
it('reports a revision conflict without replaying the write', async () => {
  vi.mocked(api.createTargetMeasurementUnit).mockRejectedValue(
    new api.TargetApiError('conflict', 'diagnostic', 'test'),
  )
  const vm = useMeasurementUnitManagementViewModel()
  const completion = vm.openCreate()
  Object.assign(vm.editor, { name: '千克', symbol: 'kg', quantityScale: 3 })
  await vm.saveEditor()
  await vm.saveEditor()
  expect(vm.editorError.value).toContain('状态已变化')
  expect(api.createTargetMeasurementUnit).toHaveBeenCalledTimes(1)
  vm.closeEditor()
  await completion
})
it('blocks replay after an unknown write result', async () => {
  vi.mocked(api.createTargetMeasurementUnit).mockRejectedValue(
    new Error('network'),
  )
  const vm = useMeasurementUnitManagementViewModel()
  const completion = vm.openCreate()
  const rejected = expect(completion).rejects.toThrow('请求结果未知')
  Object.assign(vm.editor, { name: '千克', symbol: 'kg', quantityScale: 3 })
  await vm.saveEditor()
  await rejected
  await vm.saveEditor()
  expect(api.createTargetMeasurementUnit).toHaveBeenCalledTimes(1)
  expect(vm.canSave.value).toBe(false)
})
it('creates with only the three unit fields', async () => {
  vi.mocked(api.createTargetMeasurementUnit).mockResolvedValue({
    id: 'unit',
    revision: '1',
    enabled: true,
  })
  const vm = useMeasurementUnitManagementViewModel()
  const completion = vm.openCreate()
  Object.assign(vm.editor, { name: '千克', symbol: 'kg', quantityScale: 0 })
  await vm.saveEditor()
  expect(api.createTargetMeasurementUnit).toHaveBeenCalledWith('test', {
    name: '千克',
    symbol: 'kg',
    quantityScale: 0,
  })
  expect(await completion).toBe('changed')
})
it('edits a real unit detail without description and preserves revision precision', async () => {
  const detail = {
    id: 'unit',
    code: 'UNT-0001',
    py: 'qianke',
    name: '千克',
    symbol: 'kg',
    quantityScale: 6,
    revision: '9007199254740993',
    enabled: true,
    availableActions: ['edit'] as 'edit'[],
    updatedAt: '2026-09-06T00:00:00.000Z',
    updatedBy: 'admin',
  }
  vi.mocked(api.getTargetMeasurementUnit).mockResolvedValue(detail)
  vi.mocked(api.saveTargetMeasurementUnit).mockResolvedValue({
    id: 'unit',
    revision: '9007199254740994',
    enabled: true,
  })
  const vm = useMeasurementUnitManagementViewModel()
  const completion = vm.openEdit(detail)
  void completion.catch(() => {})
  await flushPromises()
  await vm.saveEditor()
  expect(api.saveTargetMeasurementUnit).toHaveBeenCalledWith('test', {
    id: 'unit',
    revision: '9007199254740993',
    name: '千克',
    symbol: 'kg',
    quantityScale: 6,
  })
  expect(await completion).toBe('changed')
})
