import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import ProcessCompositionPage from '@/pages/wfl/shared/ProcessCompositionPage.vue'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

const mockedPost = vi.mocked(apiClient.post)

const passthrough = (tag = 'div') => ({
  template: `<${tag}><slot /></${tag}>`,
})

function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  return mount(ProcessCompositionPage, {
    props: { processEntity: 'sales-fulfillment' },
    global: {
      plugins: [router],
      stubs: {
        EntityListControls: passthrough(),
        ListRowActions: {
          props: ['primary'],
          emits: ['select'],
          template:
            '<div><button v-for="action in primary" :key="action.key" @click="$emit(`select`, action.key)">{{ action.label }}</button></div>',
        },
        VAlert: passthrough(),
        VBtn: {
          emits: ['click'],
          template: '<button @click="$emit(`click`)"><slot /></button>',
        },
        VCard: passthrough('section'),
        VCardActions: passthrough(),
        VCardText: passthrough(),
        VCardTitle: passthrough(),
        VChip: passthrough('span'),
        VContainer: passthrough('main'),
        VDialog: passthrough(),
        VExpandTransition: passthrough(),
        VSpacer: passthrough(),
        VTable: passthrough('table'),
      },
    },
  })
}

describe('workflow process composition list', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().permissions = [
      '/wfl/sales-fulfillment/query',
      '/wfl/sales-fulfillment/get',
    ]
    mockedPost.mockResolvedValue({
      data: {
        items: [
          {
            processId: '01JPROCESS000000000000000001',
            processType: 'SALES_FULFILLMENT',
            status: 'APPROVED',
            revision: 2,
            rootDocumentId: '01JORDER0000000000000000001',
            rootDocumentNo: 'SOR-20260731-0001',
            currentStage: 'OUTBOUND',
            businessDate: '2026-07-31',
            partyName: '测试客户',
            currency: 'CNY',
            amount: '1200.00',
            updatedAt: '2026-07-31T08:00:00Z',
            progressGroups: [
              {
                unit: '吨',
                productCount: 2,
                orderedQuantity: '10',
                outboundProcessingQuantity: '1',
                finalizedOutboundQuantity: '6',
                inTransitQuantity: '2',
                signedQuantity: '3',
                rejectedQuantity: '1',
                lossQuantity: '0',
                refusalReturnProcessingQuantity: '1',
                refusalReturnedQuantity: '0',
                afterSaleReturnProcessingQuantity: '0',
                afterSaleReturnedQuantity: '1',
                netSignedQuantity: '2',
                remainingQuantity: '5',
              },
              {
                unit: '桶',
                productCount: 1,
                orderedQuantity: '4',
                outboundProcessingQuantity: '0',
                finalizedOutboundQuantity: '4',
                inTransitQuantity: '0',
                signedQuantity: '4',
                rejectedQuantity: '0',
                lossQuantity: '0',
                refusalReturnProcessingQuantity: '0',
                refusalReturnedQuantity: '0',
                afterSaleReturnProcessingQuantity: '0',
                afterSaleReturnedQuantity: '0',
                netSignedQuantity: '4',
                remainingQuantity: '0',
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      },
    })
  })

  it('shows localized key data and expands unit-specific metrics', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(mockedPost).toHaveBeenCalledWith('wfl/sales-fulfillment/query', {
      page: 1,
      pageSize: 100,
    })
    expect(wrapper.text()).toContain('测试客户')
    expect(wrapper.text()).toContain('CNY 1200.00')
    expect(wrapper.text()).toContain('已批准')
    expect(wrapper.text()).toContain('销售出库')
    expect(wrapper.text()).toContain('2 个计量单位 · 1/2 已履约')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '展开履约')!
      .trigger('click')

    expect(wrapper.text()).toContain('吨 · 2 个产品')
    expect(wrapper.text()).toContain('桶 · 1 个产品')
    expect(wrapper.text()).toContain('售后退货处理中')
    expect(wrapper.text()).toContain('净签收')
    expect(wrapper.text()).toContain('待履约')
  })
})
