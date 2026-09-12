import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, shallowRef } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import ProductFormulaBlock from '@/target/components/version-page/ProductFormulaBlock.vue'
import type { ProductSnapshot } from '@/target/components/version-page/product-data.ts'
import { useTargetSession } from '@/target/session/vm.ts'
import { archiveStubs as stubs } from './helpers/archive-stubs.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetBobOptions: vi.fn(),
  queryTargetAuxOptions: vi.fn(),
}))
type Formula = NonNullable<ProductSnapshot['fixedFormula']>
function formula(count = 1): Formula {
  const quantity = {
    enteredQuantity: '2.50',
    enteredUnit: {
      id: 'kg',
      code: 'KG',
      name: '千克',
      symbol: 'kg',
      quantityScale: 2,
    },
    baseQuantity: '3.75',
  }
  return {
    output: { ...quantity, baseQuantity: '10' },
    components: Array.from({ length: count }, (_, index) => ({
      material: {
        objectId: `material-${index}`,
        approvalEntryId: 'old',
        code: `M${index}`,
        name: '旧原料',
      },
      quantity: structuredClone(quantity),
      resolutionStatus: 'CURRENT',
      requiresConfirmation: false,
    })),
  }
}
function optionPage(ids: readonly string[]) {
  return {
    items: ids.map((id) => ({
      objectId: id,
      sourceApprovalEntryId: `current-${id}`,
      sourceVersionNo: 2,
      code: id,
      name: '当前原料',
      enabled: true,
    })),
    total: ids.length,
    page: 1,
    pageSize: 20 as const,
  }
}
function mountFormula(initial: Formula) {
  return mount(
    defineComponent({
      setup() {
        const value = shallowRef<Formula | null>(structuredClone(initial))
        return () =>
          h(ProductFormulaBlock, {
            modelValue: value.value,
            disabled: false,
            'onUpdate:modelValue': (next) => {
              value.value = next
            },
          })
      },
    }),
    { global: { stubs } },
  )
}
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  useTargetSession().user = { id: 'user', code: 'user', name: '用户' }
  vi.mocked(api.queryTargetAuxOptions).mockResolvedValue(optionPage([]))
})

it('resolves copied formula materials beyond the first candidate page while preserving quantity snapshots', async () => {
  const initial = formula(21)
  vi.mocked(api.queryTargetBobOptions).mockImplementation(
    async (_entity, input) => optionPage(input.ids ?? ['material-0']),
  )
  const wrapper = mountFormula(initial)
  await flushPromises()
  const block = wrapper.getComponent(ProductFormulaBlock)
  const adopted = block.props('modelValue')!
  expect(adopted.output).toEqual(initial.output)
  expect(adopted.components).toHaveLength(21)
  for (let index = 0; index < adopted.components.length; index++) {
    expect(adopted.components[index]).toMatchObject({
      material: {
        objectId: `material-${index}`,
        approvalEntryId: `current-material-${index}`,
      },
      quantity: initial.components[index]!.quantity,
      resolutionStatus: 'CURRENT',
      requiresConfirmation: false,
    })
  }
  expect(initial.components[0]!.material.approvalEntryId).toBe('old')
  expect(block.emitted('pending')?.at(-1)).toEqual([false])
  wrapper.unmount()
})

it('leaves failed copied materials unresolved and allows an explicit retry', async () => {
  let failed = true
  vi.mocked(api.queryTargetBobOptions).mockImplementation(
    async (_entity, input) => {
      if (input.ids && failed) throw new TypeError('network')
      return optionPage(['material-0'])
    },
  )
  const wrapper = mountFormula(formula())
  await flushPromises()
  const block = wrapper.getComponent(ProductFormulaBlock)
  expect(block.props('modelValue')?.components[0]).toMatchObject({
    resolutionStatus: 'UNRESOLVED',
    requiresConfirmation: true,
  })
  expect(block.emitted('pending')?.at(-1)).toEqual([false])
  failed = false
  const retry = wrapper
    .findAll('button')
    .find((button) => button.text() === '重试解析原料')
  expect(retry).toBeDefined()
  await retry!.trigger('click')
  await flushPromises()
  expect(block.props('modelValue')?.components[0]).toMatchObject({
    material: { approvalEntryId: 'current-material-0' },
    resolutionStatus: 'CURRENT',
    requiresConfirmation: false,
  })
  wrapper.unmount()
})
