import { mount } from '@vue/test-utils'
import { defineComponent, h, type Component } from 'vue'
import { describe, expect, it } from 'vitest'
import WflStageSection from '@/components/wfl/WflStageSection.vue'
import type {
  WflAction,
  WflDocumentSummary,
} from '@/components/wfl'
import { stageDefinition } from '@/pages/wfl/intermediary-trade/definition'

const VBtnStub = defineComponent({
  name: 'VBtn',
  inheritAttrs: false,
  emits: ['click'],
  setup(_, { attrs, emit, slots }) {
    return () =>
      h(
        'button',
        { ...attrs, onClick: () => emit('click') },
        slots.default?.(),
      )
  },
})

const passthroughStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    setup(_, { slots }) {
      return () => h(tag, slots.default?.())
    },
  })

function delivery(
  status: WflDocumentSummary['status'] = 'EXECUTED',
): WflDocumentSummary {
  return {
    documentId: 'DELIVERY-1',
    documentNo: 'DN-1',
    entity: 'delivery-note',
    stage: 'DELIVERY',
    status,
    revision: 3,
    parentDocumentId: 'CUSTOMER-ORDER-1',
    businessDate: '2026-07-25',
    currency: 'CNY',
    amount: '100.00',
    lines: [],
    attachments: [],
    createdAt: '2026-07-25T00:00:00Z',
    createdBy: 'USER-1',
    reviewedBy: 'USER-1',
  }
}

function mountStage(
  item: WflDocumentSummary,
  canOpen: boolean,
  canAction: (action: WflAction) => boolean,
) {
  return mount(WflStageSection as Component, {
    props: {
      definition: stageDefinition('DELIVERY'),
      items: [item],
      canCreate: false,
      canOpen,
      currentUserId: 'USER-1',
      canAction,
    },
    global: {
      components: {
        VAlert: passthroughStub('VAlert'),
        VBtn: VBtnStub,
        VCard: passthroughStub('VCard', 'section'),
        VCardText: passthroughStub('VCardText'),
        VCardTitle: passthroughStub('VCardTitle'),
        VChip: passthroughStub('VChip', 'span'),
        VTable: passthroughStub('VTable', 'table'),
      },
    },
  })
}

describe('WFL 通用阶段组件', () => {
  it('阶段打开入口遵循 get 权限', async () => {
    const wrapper = mountStage(delivery(), false, () => false)
    expect(wrapper.find('[aria-label="打开 DN-1"]').exists()).toBe(false)

    await wrapper.setProps({ canOpen: true })
    await wrapper.get('[aria-label="打开 DN-1"]').trigger('click')
    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({
      documentId: 'DELIVERY-1',
    })
  })

  it('最终操作对同一核对人禁用并说明原因', () => {
    const wrapper = mountStage(
      delivery('CHECKED'),
      true,
      (action) => action === 'delivery-execute',
    )
    const button = wrapper
      .findAll('button')
      .find((item) => item.text().includes('执行'))

    expect(button?.attributes('disabled')).toBeDefined()
    expect(button?.attributes('title')).toContain('不能是同一用户')
  })

  it('创建签收同时要求 signoff-create 和 delivery-get', async () => {
    const wrapper = mountStage(
      delivery(),
      true,
      (action) => action === 'signoff-create',
    )
    expect(wrapper.text()).not.toContain('创建签收')

    await wrapper.setProps({
      canAction: (action: WflAction) =>
        action === 'signoff-create' || action === 'delivery-get',
    })
    expect(wrapper.text()).toContain('创建签收')
  })
})
