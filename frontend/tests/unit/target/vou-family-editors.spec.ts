import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createVouDraftPayload, vouEntities } from '@zerp/model'

import PriceLinesEditor from '@/target/pages/vou/shared/editors/PriceLinesEditor.vue'
import ProductLinesEditor from '@/target/pages/vou/shared/editors/ProductLinesEditor.vue'
import SaleOrder from '@/target/pages/vou/sale-order/SaleOrder.vue'
import SalePricing from '@/target/pages/vou/sale-pricing/SalePricing.vue'
import PurchaseInquiry from '@/target/pages/vou/purchase-inquiry/PurchaseInquiry.vue'
import PurchaseOrder from '@/target/pages/vou/purchase-order/PurchaseOrder.vue'
import FamilyEditor from '@/target/pages/vou/shared/editors/FamilyEditor.vue'
import { vouPageComponents } from '@/target/pages/vou/shared/page-components.ts'
import { vouPageConfigs } from '@/target/pages/vou/shared/config.ts'

vi.mock('@/target/pages/vou/shared/vm.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  useVouPageController: vi.fn(() => ({})),
}))

describe('VOU pricing and order family editors', () => {
  it('retains consecutive line edits before parent props refresh', async () => {
    const wrapper = mount(ProductLinesEditor, {
      props: {
        modelValue: createVouDraftPayload('sale-order', () => 'L'.repeat(26))
          .productLines,
        lineId: () => 'L'.repeat(26),
      },
    })
    await wrapper.get('input[aria-label="录入数量"]').setValue('2')
    await wrapper.get('input[aria-label="基础数量"]').setValue('2')
    await wrapper.get('input[aria-label="单价"]').setValue('3')
    const emitted = wrapper.emitted('update:modelValue')!.at(-1)![0]
    expect(emitted).toEqual([
      expect.objectContaining({
        enteredQuantity: '2',
        baseQuantity: '2',
        unitPrice: '3',
      }),
    ])
    expect(wrapper.text()).toContain('6.00')
  })

  it('retains consecutive price-line edits before parent props refresh', async () => {
    const wrapper = mount(PriceLinesEditor, {
      props: {
        modelValue: createVouDraftPayload('sale-pricing', () => 'L'.repeat(26))
          .priceLines,
      },
    })

    await wrapper.get('input[aria-label="单价"]').setValue('12.34')
    await wrapper.get('input[aria-label="备注"]').setValue('客户协议价')

    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toEqual([
      expect.objectContaining({ unitPrice: '12.34', remark: '客户协议价' }),
    ])
  })

  it('registers an explicit component for every VOU entity', () => {
    expect(Object.keys(vouPageComponents)).toEqual(vouEntities)
    for (const component of Object.values(vouPageComponents))
      expect(component).toBeTruthy()
  })

  it('keeps four explicit business pages instead of a descriptor-generated form', () => {
    for (const [page, testId] of [
      [SalePricing, 'vou-sale-pricing-page'],
      [SaleOrder, 'vou-sale-order-page'],
      [PurchaseInquiry, 'vou-purchase-inquiry-page'],
      [PurchaseOrder, 'vou-purchase-order-page'],
    ] as const) {
      const wrapper = mount(page, {
        global: { stubs: { VouWorkspace: { template: '<div />' } } },
      })
      expect(wrapper.attributes('data-vou-page')).toBe(testId)
    }
  })

  for (const [entity, expected] of [
    ['sale-delivery', '来源数量明细'],
    ['purchase-inbound', '来源数量明细'],
    ['order-production', '生产产出与用料'],
    ['inventory-count', '盘点明细'],
    ['sales-receipt', '客户子户分配'],
    ['expense-reimbursement', '费用明细'],
    ['asset-sale', '出售资产明细'],
    ['bill-receipt', '票据明细'],
    ['intermediary-calculation', '计算期间与脚本'],
    ['service-contract', '服务合同条款'],
    ['service-acceptance', '履约验收事实'],
  ] as const) {
    it(`${entity} uses its business-family editor`, () => {
      const wrapper = mount(FamilyEditor, {
        props: {
          entity,
          editor: vouPageConfigs[entity].editor,
          payload: createVouDraftPayload(entity, () => 'L'.repeat(26)),
          referenceOptions: {},
          editable: entity !== 'sale-delivery',
        },
      })
      expect(wrapper.text()).toContain(expected)
      expect(wrapper.text()).not.toContain('JSON')
      if (entity === 'sale-delivery')
        expect(wrapper.text()).not.toContain('添加来源行')
    })
  }

  it('uses a dedicated pricing table with product, unit price and remark columns', async () => {
    const wrapper = mount(PriceLinesEditor, {
      props: { modelValue: [], editable: true, productOptions: [] },
    })
    expect(wrapper.text()).toContain('定价明细')
    expect(wrapper.text()).toContain('产品')
    expect(wrapper.text()).toContain('单价')
    expect(wrapper.text()).toContain('备注')
    expect(wrapper.find('textarea').exists()).toBe(false)

    await wrapper.get('button', { name: '添加定价行' }).trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
      {
        product: {
          objectId: '',
          approvalEntryId: '',
          selectionOrigin: 'CURRENT',
        },
        unitPrice: '',
        remark: '',
      },
    ])
  })

  it('uses a dedicated order line table with quantity snapshots and amount', async () => {
    const wrapper = mount(ProductLinesEditor, {
      props: {
        modelValue: [],
        editable: true,
        productOptions: [],
        lineId: () => 'L'.repeat(26),
      },
    })
    expect(wrapper.text()).toContain('产品明细')
    expect(wrapper.text()).toContain('录入数量')
    expect(wrapper.text()).toContain('基础数量')
    expect(wrapper.text()).toContain('金额')
    expect(wrapper.find('textarea').exists()).toBe(false)

    await wrapper.get('button', { name: '添加产品行' }).trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
      expect.objectContaining({
        lineId: 'L'.repeat(26),
        product: { objectId: '' },
        enteredQuantity: '',
        enteredUnit: { objectId: '' },
        baseQuantity: '',
        unitPrice: '',
      }),
    ])
  })

  it('selects upstream source lines with their server-resolved root and labels quantities in Chinese', async () => {
    const sourceLineId = 'L'.repeat(26)
    const sourceDocumentId = 'D'.repeat(26)
    const rootDocumentId = 'O'.repeat(26)
    const returnPayload = createVouDraftPayload('sale-return', () =>
      'R'.repeat(26),
    )
    const returnWrapper = mount(FamilyEditor, {
      props: {
        entity: 'sale-return',
        editor: vouPageConfigs['sale-return'].editor,
        payload: returnPayload,
        referenceOptions: {},
        sourceLineOptions: [
          {
            sourceDocumentId,
            sourceDocumentNo: 'XSQS2026090001',
            sourceEntity: 'sale-signoff',
            rootDocumentId,
            rootEntity: 'sale-order',
            businessDate: '2026-09-05',
            sourceLineId,
            product: {
              objectId: 'P'.repeat(26),
              code: 'P-01',
              name: '水性树脂',
            },
            availableBaseQuantity: '3.000000',
          },
        ],
      },
      global: {
        stubs: { 'v-btn': { template: '<button><slot /></button>' } },
      },
    })
    await returnWrapper.get('button', { name: '添加退货行' }).trigger('click')
    expect(returnWrapper.text()).toContain('XSQS2026090001')
    expect(returnWrapper.text()).toContain('水性树脂')
    const optionValue = `${sourceDocumentId}:${sourceLineId}`
    expect(returnWrapper.find(`option[value="${optionValue}"]`).exists()).toBe(
      true,
    )
    await returnWrapper.find('.source-line-select select').setValue(optionValue)
    expect(returnPayload.returnLines[0]).toEqual(
      expect.objectContaining({ sourceDocumentId, sourceLineId }),
    )
    expect(returnPayload).toMatchObject({
      parentEntity: 'sale-order',
      parentDocumentId: rootDocumentId,
    })
    expect(
      returnWrapper
        .findAll('v-text-field')
        .map((field) => field.attributes('label')),
    ).toContain('退货基础数量')
    expect(
      returnWrapper.find('input[aria-label="sourceLineId"]').exists(),
    ).toBe(false)

    const inboundPayload = createVouDraftPayload('purchase-inbound', () =>
      'I'.repeat(26),
    )
    const inboundWrapper = mount(FamilyEditor, {
      props: {
        entity: 'purchase-inbound',
        editor: vouPageConfigs['purchase-inbound'].editor,
        payload: inboundPayload,
        referenceOptions: {},
        sourceLineOptions: [
          {
            sourceDocumentId,
            sourceDocumentNo: 'CG2026090001',
            sourceEntity: 'purchase-order',
            rootDocumentId: sourceDocumentId,
            rootEntity: 'purchase-order',
            businessDate: '2026-09-05',
            sourceLineId,
            product: {
              objectId: 'P'.repeat(26),
              code: 'P-01',
              name: '水性树脂',
            },
            availableBaseQuantity: '3.000000',
          },
        ],
      },
      global: {
        stubs: { 'v-btn': { template: '<button><slot /></button>' } },
      },
    })
    await inboundWrapper.get('button', { name: '添加来源行' }).trigger('click')
    await inboundWrapper
      .find('.source-line-select select')
      .setValue(optionValue)
    expect(inboundPayload).toMatchObject({
      parentEntity: 'purchase-order',
      parentDocumentId: sourceDocumentId,
    })
    expect(
      inboundWrapper
        .findAll('v-text-field')
        .map((field) => field.attributes('label')),
    ).toContain('来源基础数量')

    const signoffWrapper = mount(FamilyEditor, {
      props: {
        entity: 'sale-signoff',
        editor: vouPageConfigs['sale-signoff'].editor,
        payload: createVouDraftPayload('sale-signoff', () => 'S'.repeat(26)),
        referenceOptions: {},
        editable: false,
      },
    })
    expect(
      signoffWrapper
        .findAll('v-number-input')
        .map((field) => field.attributes('label')),
    ).toEqual([
      '应返溶剂容器数',
      '应返树脂容器数',
      '实返溶剂容器数',
      '实返树脂容器数',
    ])
  })

  it('uses business-labelled candidates for asset, service, bill and production object references', async () => {
    const referenceOptions = {
      asset: [{ objectId: 'A'.repeat(26), code: 'ZC-01', name: '叉车' }],
      'asset-category': [
        { objectId: 'C'.repeat(26), code: 'SB', name: '生产设备' },
      ],
      department: [{ objectId: 'D'.repeat(26), code: 'SC', name: '生产部' }],
      'service-contract': [
        {
          objectId: 'V'.repeat(26),
          approvalEntryId: 'E'.repeat(26),
          code: 'FWHT2026090001',
          name: '渠道服务合同',
        },
      ],
      bill: [{ objectId: 'B'.repeat(26), code: 'P-100', name: '票据 P-100' }],
      product: [{ objectId: 'P'.repeat(26), code: 'PRD-01', name: '水性树脂' }],
      'measurement-unit': [
        { objectId: 'U'.repeat(26), code: 'KG', name: '千克' },
      ],
    }
    for (const [entity, button, labels] of [
      ['asset-acquisition', '添加资产', ['生产设备', '生产部']],
      ['asset-sale', '添加资产', ['叉车']],
      ['bill-maturity', '添加票据', ['票据 P-100']],
      ['self-production', '添加产出行', ['水性树脂', '千克']],
    ] as const) {
      const wrapper = mount(FamilyEditor, {
        props: {
          entity,
          editor: vouPageConfigs[entity].editor,
          payload: createVouDraftPayload(entity, () => 'L'.repeat(26)),
          referenceOptions,
        },
        global: {
          stubs: { 'v-btn': { template: '<button><slot /></button>' } },
        },
      })
      await wrapper.get('button', { name: button }).trigger('click')
      for (const label of labels) expect(wrapper.text()).toContain(label)
    }

    const service = mount(FamilyEditor, {
      props: {
        entity: 'service-acceptance',
        editor: vouPageConfigs['service-acceptance'].editor,
        payload: createVouDraftPayload('service-acceptance', () =>
          'L'.repeat(26),
        ),
        referenceOptions,
      },
    })
    expect(service.text()).toContain('FWHT2026090001')
    expect(service.text()).toContain('渠道服务合同')
  })
})
