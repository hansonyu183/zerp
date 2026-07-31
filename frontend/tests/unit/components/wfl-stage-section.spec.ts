import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import WflStageSection from '@/components/wfl/WflStageSection.vue'
import type {
  WflAction,
  WflDocumentSummary,
  WflStageDefinition,
} from '@/components/wfl/types'

const definition: WflStageDefinition = {
  stage: 'PROCUREMENT',
  prefix: 'procurement',
  entity: 'purchase-order',
  title: '采购订单',
  icon: 'mdi-file-document-outline',
  repeatable: false,
  semanticFinalStatus: 'ORDERED',
  finalLabel: '下单',
  createAction: 'procurement-create',
  getAction: 'procurement-get',
  saveAction: 'procurement-save',
  deleteAction: 'procurement-delete',
  checkAction: 'procurement-check',
  uncheckAction: 'procurement-uncheck',
  finalAction: 'procurement-place',
  reverseFinalAction: 'procurement-unplace',
  attachments: false,
}

function document(
  status: string,
  reviewedBy?: string,
): WflDocumentSummary {
  return {
    documentId: 'DOC-1',
    documentNo: 'SO-0001',
    entity: 'purchase-order',
    stage: 'PROCUREMENT',
    status,
    revision: 1,
    businessDate: '2026-07-31',
    currency: 'CNY',
    amount: '100.00',
    attachments: [],
    createdAt: '2026-07-31T00:00:00Z',
    createdBy: 'USER-1',
    reviewedBy,
  }
}

const ListRowActionsStub = defineComponent({
  name: 'ListRowActions',
  props: {
    primary: { type: Array, default: () => [] },
    more: { type: Array, default: () => [] },
  },
  setup(props) {
    const renderActions = (zone: 'primary' | 'more') =>
      (props[zone] as Array<{ key: string; label: string }>).map((action) =>
        h('button', {
          'aria-label': action.label,
          'data-action': action.key,
          'data-zone': zone,
        }),
      )
    return () => h('div', [...renderActions('primary'), ...renderActions('more')])
  },
})

function mountSection(
  item: WflDocumentSummary,
  actions: readonly WflAction[],
  currentUserId = 'USER-2',
) {
  return mount(WflStageSection, {
    props: {
      definition,
      items: [item],
      canCreate: false,
      canOpen: true,
      currentUserId,
      canAction: (action: WflAction) => actions.includes(action),
    },
    global: {
      stubs: {
        ListRowActions: ListRowActionsStub,
        VCard: { template: '<section><slot /></section>' },
        VCardText: { template: '<div><slot /></div>' },
        VCardTitle: { template: '<div><slot /></div>' },
        VChip: { template: '<span><slot /></span>' },
        VTable: { template: '<table><slot /></table>' },
      },
    },
  })
}

describe('WflStageSection', () => {
  it('把当前状态允许的正反向流程动作直接放在操作列', () => {
    const wrapper = mountSection(document('CHECKED', 'USER-1'), [
      'procurement-place',
      'procurement-uncheck',
    ])

    expect(
      wrapper.findAll('[data-zone="primary"]').map((item) => item.attributes('data-action')),
    ).toEqual(['open', 'final', 'uncheck'])
    expect(wrapper.find('[data-zone="more"]').exists()).toBe(false)
  })

  it('隐藏当前用户不可执行的自审动作', () => {
    const wrapper = mountSection(
      document('CHECKED', 'USER-1'),
      ['procurement-place', 'procurement-uncheck'],
      'USER-1',
    )

    expect(wrapper.find('[data-action="final"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="uncheck"]').exists()).toBe(true)
  })

  it('仅将删除等非流程操作保留在更多菜单', () => {
    const draft = mountSection(document('DRAFT'), [
      'procurement-check',
      'procurement-delete',
    ])
    expect(draft.find('[data-action="check"]').attributes('data-zone')).toBe(
      'primary',
    )
    expect(draft.find('[data-action="delete"]').attributes('data-zone')).toBe(
      'more',
    )

    const approved = mountSection(document('ORDERED'), ['procurement-unplace'])
    expect(
      approved.find('[data-action="reverse-final"]').attributes('data-zone'),
    ).toBe('primary')
  })
})
