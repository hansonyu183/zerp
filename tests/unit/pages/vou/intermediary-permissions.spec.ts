import { mount } from '@vue/test-utils'
import { defineComponent, h, ref, type Component } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IntermediarySaleOrder from '@/pages/vou/intermediary-sale-order/IntermediarySaleOrder.vue'
import IntermediaryStageSection from '@/pages/vou/intermediary-sale-order/v2/IntermediaryStageSection.vue'
import type {
  IntermediaryAction,
} from '@/pages/vou/intermediary-sale-order/v2/api'
import type {
  IntermediaryChildSummary,
} from '@/pages/vou/intermediary-sale-order/v2/types'

const mocks = vi.hoisted(() => ({
  useLegacyViewModel: vi.fn(),
}))

vi.mock('@/pages/vou/intermediary-sale-order/vm', () => ({
  useIntermediarySaleOrderViewModel: mocks.useLegacyViewModel,
}))

const VBtnStub = defineComponent({
  name: 'VBtn',
  inheritAttrs: false,
  emits: ['click'],
  setup(_, { attrs, emit, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          onClick: () => emit('click'),
        },
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

const IntermediaryWorkflowPageStub = defineComponent({
  name: 'IntermediaryWorkflowPage',
  emits: ['open-legacy'],
  setup(_, { emit }) {
    return () =>
      h(
        'button',
        {
          class: 'open-legacy',
          onClick: () =>
            emit('open-legacy', {
              documentId: 'V1-1',
              documentNo: 'ISO-V1-1',
            }),
        },
        '打开 V1',
      )
  },
})

const VoucherEntityPageStub = defineComponent({
  name: 'VoucherEntityPage',
  setup() {
    return () => h('div', { class: 'legacy-page' })
  },
})

function stageItem(): IntermediaryChildSummary {
  return {
    childId: 'D-1',
    childNo: 'ISO-1-D001',
    stage: 'DELIVERY',
    status: 'EXECUTED',
    revision: 2,
    createdAt: '2026-07-25T00:00:00Z',
    createdBy: 'USER-1',
    updatedAt: '2026-07-25T00:00:00Z',
    updatedBy: 'USER-1',
  }
}

function mountStage(
  canOpen: boolean,
  canAction: (action: IntermediaryAction) => boolean,
) {
  return mount(IntermediaryStageSection as Component, {
    props: {
      stage: 'delivery',
      title: '分批送货',
      items: [stageItem()],
      canCreate: false,
      canOpen,
      currentUserId: 'USER-2',
      canAction,
    },
    global: {
      components: {
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

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Intermediary V2 permission controls', () => {
  it('子单打开入口遵循对应 get 权限', async () => {
    const wrapper = mountStage(false, () => false)
    const selector = '[aria-label="打开 ISO-1-D001"]'

    expect(wrapper.find(selector).exists()).toBe(false)

    await wrapper.setProps({ canOpen: true })
    await wrapper.get(selector).trigger('click')

    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({
      childId: 'D-1',
    })
  })

  it('创建签收同时要求 signoff-create 和 delivery-get', async () => {
    const wrapper = mountStage(
      true,
      (action) => action === 'signoffCreate',
    )

    expect(wrapper.text()).not.toContain('创建签收')

    await wrapper.setProps({
      canAction: (action: IntermediaryAction) =>
        action === 'signoffCreate' || action === 'deliveryGet',
    })

    expect(wrapper.text()).toContain('创建签收')
  })
})

describe('Intermediary V1/V2 switching', () => {
  it('保留用户取消返回时的 V1 草稿，确认后才关闭并返回 V2', async () => {
    const dirty = ref(true)
    const busy = ref(false)
    const closeWorkspace = vi.fn()
    const openDocument = vi.fn().mockResolvedValue(undefined)
    mocks.useLegacyViewModel.mockReturnValue({
      dirty,
      busy,
      closeWorkspace,
      openDocument,
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mount(IntermediarySaleOrder, {
      global: {
        components: {
          VBtn: VBtnStub,
          VContainer: passthroughStub('VContainer'),
        },
        stubs: {
          IntermediaryWorkflowPage: IntermediaryWorkflowPageStub,
          VoucherEntityPage: VoucherEntityPageStub,
        },
      },
    })

    await wrapper.get('.open-legacy').trigger('click')
    expect(openDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'V1-1' }),
    )
    expect(wrapper.find('.legacy-page').exists()).toBe(true)

    const returnButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('返回居间订单 V2'))
    expect(returnButton).toBeDefined()
    await returnButton!.trigger('click')

    expect(confirm).toHaveBeenCalledWith(
      '存在未保存修改，确认返回居间订单 V2？',
    )
    expect(closeWorkspace).not.toHaveBeenCalled()
    expect(wrapper.find('.legacy-page').exists()).toBe(true)

    confirm.mockReturnValue(true)
    await returnButton!.trigger('click')

    expect(closeWorkspace).toHaveBeenCalledOnce()
    expect(wrapper.find('.open-legacy').exists()).toBe(true)
  })

  it('V1 没有修改时直接关闭工作区并返回 V2', async () => {
    const closeWorkspace = vi.fn()
    mocks.useLegacyViewModel.mockReturnValue({
      dirty: ref(false),
      busy: ref(false),
      closeWorkspace,
      openDocument: vi.fn().mockResolvedValue(undefined),
    })
    const confirm = vi.spyOn(window, 'confirm')
    const wrapper = mount(IntermediarySaleOrder, {
      global: {
        components: {
          VBtn: VBtnStub,
          VContainer: passthroughStub('VContainer'),
        },
        stubs: {
          IntermediaryWorkflowPage: IntermediaryWorkflowPageStub,
          VoucherEntityPage: VoucherEntityPageStub,
        },
      },
    })

    await wrapper.get('.open-legacy').trigger('click')
    const returnButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('返回居间订单 V2'))
    await returnButton!.trigger('click')

    expect(confirm).not.toHaveBeenCalled()
    expect(closeWorkspace).toHaveBeenCalledOnce()
    expect(wrapper.find('.open-legacy').exists()).toBe(true)
  })
})
