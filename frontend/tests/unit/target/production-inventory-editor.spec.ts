import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { createVouDraftPayload } from '@zerp/model'

import ProductionInventoryEditor from '@/target/pages/vou/shared/editors/ProductionInventoryEditor.vue'

const sourceCandidate = {
  sourceDocumentId: 'D'.repeat(26),
  sourceDocumentNo: 'SO2026090001',
  sourceEntity: 'sale-order' as const,
  rootDocumentId: 'O'.repeat(26),
  rootEntity: 'sale-order' as const,
  businessDate: '2026-09-05',
  sourceLineId: 'L'.repeat(26),
  product: { objectId: 'P'.repeat(26), code: 'FG-01', name: '水性树脂' },
  availableBaseQuantity: '8.000000',
}

function mountEditor(
  entity: 'order-production' | 'self-production' | 'inventory-count',
) {
  const payload = createVouDraftPayload(entity, () => 'I'.repeat(26))
  const wrapper = mount(ProductionInventoryEditor, {
    props: {
      entity,
      payload,
      referenceOptions: {},
      sourceLineOptions: [sourceCandidate],
    },
    global: {
      stubs: {
        'v-row': { template: '<div><slot /></div>' },
        'v-col': { template: '<div><slot /></div>' },
        'v-table': { template: '<table><slot /></table>' },
        'v-card': { template: '<section><slot /></section>' },
        'v-card-title': { template: '<h4><slot /></h4>' },
        'v-card-text': { template: '<div><slot /></div>' },
        'v-select': { template: '<select><slot /></select>' },
        'v-btn': {
          emits: ['click'],
          template: '<button @click="$emit(\'click\')"><slot /></button>',
        },
        'v-text-field': {
          props: ['modelValue', 'label'],
          emits: ['update:modelValue'],
          template:
            '<input :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
      },
    },
  })
  return { payload, wrapper }
}

function button(wrapper: ReturnType<typeof mount>, text: string) {
  const match = wrapper
    .findAll('button')
    .find((element) => element.text() === text)
  if (!match) throw new Error(`button not found: ${text}`)
  return match
}

describe('production and inventory editor public seam', () => {
  it('keeps order production source-led, self production product-led, and applies a source candidate root', async () => {
    const order = mountEditor('order-production')
    await button(order.wrapper, '添加产出行').trigger('click')

    expect(order.payload.productionLines.at(-1)).toEqual(
      expect.objectContaining({ sourceOrderLineId: '' }),
    )
    expect(order.payload.productionLines.at(-1)).not.toHaveProperty('product')

    const sourceSelects = order.wrapper.findAll('.source-line-select select')
    await sourceSelects
      .at(-1)!
      .setValue(
        `${sourceCandidate.sourceDocumentId}:${sourceCandidate.sourceLineId}`,
      )
    expect(order.payload).toMatchObject({
      parentEntity: 'sale-order',
      parentDocumentId: sourceCandidate.rootDocumentId,
    })
    expect(order.payload.productionLines.at(-1)).toMatchObject({
      sourceOrderLineId: sourceCandidate.sourceLineId,
      product: { objectId: sourceCandidate.product.objectId },
    })

    const self = mountEditor('self-production')
    await button(self.wrapper, '添加产出行').trigger('click')
    expect(self.payload.productionLines.at(-1)).toEqual(
      expect.objectContaining({ product: { objectId: '' } }),
    )
    expect(self.payload.productionLines.at(-1)).not.toHaveProperty(
      'sourceOrderLineId',
    )
  })

  it('makes production, material, and inventory numbers accessible and keeps formula lines editable integers', async () => {
    const production = mountEditor('order-production')
    await button(production.wrapper, '添加产出行').trigger('click')

    for (const label of [
      '产出录入数量',
      '产出基础数量',
      '损耗率',
      '产出备注',
      '配方行号',
      '实际录入数量',
      '实际基础数量',
      '调整原因',
    ])
      expect(
        production.wrapper.find(`input[aria-label="${label}"]`).exists(),
      ).toBe(true)

    await production.wrapper.get('input[aria-label="配方行号"]').setValue('2')
    expect(
      production.payload.productionLines[0]?.materials[0]?.formulaLineNo,
    ).toBe(2)

    const inventory = mountEditor('inventory-count')
    await button(inventory.wrapper, '添加盘点行').trigger('click')
    for (const label of ['盘点录入数量', '盘点基础数量', '盘点备注'])
      expect(
        inventory.wrapper.find(`input[aria-label="${label}"]`).exists(),
      ).toBe(true)
  })
})
