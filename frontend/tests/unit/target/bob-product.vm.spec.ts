import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import { useProductManagementViewModel } from '@/target/pages/bob/product/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetProducts: vi.fn(),
  queryTargetAuxReferences: vi.fn(),
  queryTargetBobReferences: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
})
it('product form keeps incomplete input only until closed and does not query without exact read permission', async () => {
  const session = useTargetSession()
  session.csrfToken = 'test-csrf'
  session.user = { id: 'operator', code: 'operator', name: '操作员' }
  session.apiPaths = ['/bob/product/submit-new']
  const vm = useProductManagementViewModel()
  await vm.list.initialize()
  expect(api.queryTargetProducts).not.toHaveBeenCalled()
  vm.openCreate()
  vm.editor.draft.value.name = '未提交产品'
  expect(vm.editor.open.value).toBe(true)
  vm.closeEditor()
  vm.openCreate()
  expect(vm.editor.draft.value.name).toBe('')
  expect(api.queryTargetAuxReferences).not.toHaveBeenCalled()
  vm.dispose()
})

it('formula and conversion edits update their reactive presentation immediately', async () => {
  const { computed } = await import('vue')
  const session = useTargetSession()
  session.apiPaths = ['/bob/product/submit-new']
  const vm = useProductManagementViewModel()
  vm.openCreate()
  const hasFormula = computed(() => vm.editor.draft.value.fixedFormula !== null)
  expect(hasFormula.value).toBe(false)
  vm.createFormula()
  expect(hasFormula.value).toBe(true)
  vm.addConversion()
  expect(vm.editor.draft.value.unitConversions.length).toBe(1)
  vm.editor.draft.value.unitConversions[0]!.unit.id = 'kg'
  vm.editor.draft.value.unitConversions[0]!.factor = '2.5'
  vm.conversionUnitId.value = 'kg'
  vm.conversionInput.value = '9007199254740993.000001'
  expect(vm.suggestedBaseQuantity.value).toBe('22517998136852482.5000025')
  vm.editor.draft.value.unitConversions[0]!.factor = '1.0'
  expect(vm.suggestedBaseQuantity.value).toBe('9007199254740993.0000010')
  vm.dispose()
})

it('incomplete submission reports the specific missing field and keeps temporary input', async () => {
  const session = useTargetSession()
  session.apiPaths = ['/bob/product/submit-new']
  const vm = useProductManagementViewModel()
  vm.openCreate()
  await vm.submit()
  expect(vm.editor.error.value).toBe('名称：请填写名称。')
  vm.editor.draft.value.name = '保留的名称'
  await vm.submit()
  expect(vm.editor.error.value).toBe('产品类型：请选择可用类型。')
  expect(vm.editor.draft.value.name).toBe('保留的名称')
  vm.dispose()
})
