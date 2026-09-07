import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'

import * as api from '@/target/api.ts'
import { useAssetCategoryManagementViewModel } from '@/target/pages/aux/asset-category/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  createTargetAssetCategory: vi.fn(),
  saveTargetAssetCategory: vi.fn(),
  getTargetAssetCategory: vi.fn(),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  const session = useTargetSession()
  session.csrfToken = 'test'
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
  session.apiPaths = ['create', 'get', 'save'].map(
    (action) => `/aux/asset-category/${action}`,
  )
})

it.each([0, 1201, 1.5])(
  'rejects invalid useful life %s without writing',
  async (months) => {
    const vm = useAssetCategoryManagementViewModel()
    const completion = vm.openCreate()
    Object.assign(vm.editor, {
      name: '机器设备',
      defaultUsefulLifeMonths: months,
      defaultResidualRate: '5.00',
    })
    await vm.saveEditor()
    expect(api.createTargetAssetCategory).not.toHaveBeenCalled()
    expect(vm.editorError.value).toContain('1–1200')
    vm.closeEditor()
    expect(await completion).toBeUndefined()
  },
)

it.each(['-0.01', '100.00', '1.234', '1e1', '01.00', '.5', ''])(
  'rejects invalid residual rate %s without writing',
  async (rate) => {
    const vm = useAssetCategoryManagementViewModel()
    const completion = vm.openCreate()
    Object.assign(vm.editor, {
      name: '机器设备',
      defaultUsefulLifeMonths: 120,
      defaultResidualRate: rate,
    })
    await vm.saveEditor()
    expect(api.createTargetAssetCategory).not.toHaveBeenCalled()
    expect(vm.editorError.value).toContain('0.00–99.99')
    vm.closeEditor()
    await completion
  },
)

it.each([
  [1, '0.00'],
  [1200, '99.99'],
  [120, '5.5'],
] as const)(
  'preserves valid endpoints %s / %s in create',
  async (months, rate) => {
    vi.mocked(api.createTargetAssetCategory).mockResolvedValue({
      id: 'category',
      revision: '1',
      enabled: true,
    })
    const vm = useAssetCategoryManagementViewModel()
    const completion = vm.openCreate()
    Object.assign(vm.editor, {
      name: '机器设备',
      description: '说明',
      defaultUsefulLifeMonths: months,
      defaultResidualRate: rate,
    })
    await vm.saveEditor()
    expect(api.createTargetAssetCategory).toHaveBeenCalledWith('test', {
      name: '机器设备',
      description: '说明',
      defaultUsefulLifeMonths: months,
      defaultResidualRate: rate,
    })
    expect(await completion).toBe('changed')
  },
)

it('fills detail and preserves decimal and string revision on save', async () => {
  const detail = {
    id: 'category',
    code: 'ACT-0001',
    py: 'jiqishebei',
    name: '机器设备',
    description: '说明',
    defaultUsefulLifeMonths: 120,
    defaultResidualRate: '5.00',
    revision: '9007199254740993',
    enabled: true,
    availableActions: ['edit'] as 'edit'[],
    updatedAt: '2026-09-06T00:00:00.000Z',
    updatedBy: 'admin',
  }
  vi.mocked(api.getTargetAssetCategory).mockResolvedValue(detail)
  vi.mocked(api.saveTargetAssetCategory).mockResolvedValue({
    id: detail.id,
    revision: '9007199254740994',
    enabled: true,
  })
  const vm = useAssetCategoryManagementViewModel()
  const completion = vm.openEdit(detail)
  await flushPromises()
  expect(vm.editor.defaultUsefulLifeMonths).toBe(120)
  expect(vm.editor.defaultResidualRate).toBe('5.00')
  await vm.saveEditor()
  expect(api.saveTargetAssetCategory).toHaveBeenCalledWith('test', {
    id: detail.id,
    revision: detail.revision,
    name: '机器设备',
    description: '说明',
    defaultUsefulLifeMonths: 120,
    defaultResidualRate: '5.00',
  })
  expect(await completion).toBe('changed')
})

it('blocks replay after an unknown write result', async () => {
  vi.mocked(api.createTargetAssetCategory).mockRejectedValue(
    new Error('network'),
  )
  const vm = useAssetCategoryManagementViewModel()
  const completion = vm.openCreate()
  const rejected = expect(completion).rejects.toThrow('请求结果未知')
  Object.assign(vm.editor, {
    name: '机器设备',
    defaultUsefulLifeMonths: 120,
    defaultResidualRate: '5.00',
  })
  await vm.saveEditor()
  await rejected
  await vm.saveEditor()
  expect(api.createTargetAssetCategory).toHaveBeenCalledTimes(1)
  expect(vm.canSave.value).toBe(false)
})
