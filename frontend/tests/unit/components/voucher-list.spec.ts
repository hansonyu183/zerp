import { mount, type VueWrapper } from '@vue/test-utils'
import {
  defineComponent,
  h,
  inject,
  provide,
  ref,
  type Component,
  type InjectionKey,
  type Ref,
} from 'vue'
import { describe, expect, it } from 'vitest'
import VoucherList from '@/components/voucher/VoucherList.vue'
import type {
  VoucherLifecycleAction,
  VoucherLifecycleLabels,
  VoucherListItem,
} from '@/components/voucher'

interface ExpansionState {
  open: Ref<boolean>
  toggle: () => void
}

const expansionStateKey: InjectionKey<ExpansionState> =
  Symbol('expansion-state')

const VExpansionPanelsStub = defineComponent({
  name: 'VExpansionPanels',
  setup(_, { slots }) {
    return () => h('section', { class: 'expansion-panels' }, slots.default?.())
  },
})

const VExpansionPanelStub = defineComponent({
  name: 'VExpansionPanel',
  setup(_, { slots }) {
    const open = ref(false)
    provide(expansionStateKey, {
      open,
      toggle: () => {
        open.value = !open.value
      },
    })
    return () => h('div', { class: 'expansion-panel' }, slots.default?.())
  },
})

const VExpansionPanelTitleStub = defineComponent({
  name: 'VExpansionPanelTitle',
  setup(_, { slots }) {
    const state = inject(expansionStateKey)
    return () =>
      h(
        'button',
        {
          'aria-expanded': String(state?.open.value ?? false),
          'data-test': 'filter-toggle',
          onClick: state?.toggle,
        },
        slots.default?.(),
      )
  },
})

const VExpansionPanelTextStub = defineComponent({
  name: 'VExpansionPanelText',
  setup(_, { slots }) {
    const state = inject(expansionStateKey)
    return () =>
      state?.open.value
        ? h('div', { 'data-test': 'filter-content' }, slots.default?.())
        : null
  },
})

const VBtnStub = defineComponent({
  name: 'VBtn',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    loading: Boolean,
  },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled || props.loading,
          onClick: () => emit('click'),
        },
        slots.default?.(),
      )
  },
})

const VTextFieldStub = defineComponent({
  name: 'VTextField',
  props: {
    label: String,
    modelValue: String,
  },
  emits: ['update:modelValue', 'keyup'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        'aria-label': props.label,
        value: props.modelValue,
        onInput: (event: Event) =>
          emit('update:modelValue', (event.target as HTMLInputElement).value),
        onKeyup: (event: KeyboardEvent) => emit('keyup', event),
      })
  },
})

const VTableStub = defineComponent({
  name: 'VTable',
  setup(_, { slots }) {
    return () => h('table', slots.default?.())
  },
})

const passthroughStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    setup(_, { slots }) {
      return () => h(tag, slots.default?.())
    },
  })

function mountList(
  props: Partial<{
    rows: readonly VoucherListItem[]
    keyword: string
    loading: boolean
    queryable: boolean
    creatable: boolean
    canView: (row: VoucherListItem) => boolean
    canEdit: (row: VoucherListItem) => boolean
    canLifecycleAction: (
      row: VoucherListItem,
      action: VoucherLifecycleAction,
    ) => boolean
    lifecycleLabels: VoucherLifecycleLabels
    actionLoading: string | null
    fulfillmentSummaryKind: 'sales' | 'purchase'
    filterable: boolean
    sortable: boolean
    showEntity: boolean
    searchLabel: string
  }> = {},
  slots: Record<string, unknown> = {},
): VueWrapper {
  return mount(VoucherList as Component, {
    props: {
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
      keyword: '',
      statuses: [],
      dateFrom: '',
      dateTo: '',
      sort: { field: 'documentNo', order: 'desc' },
      party: null,
      lifecycleLabels: {
        check: '核对',
        uncheck: '反核对',
        approve: '批准',
        unapprove: '反批准',
        finalize: '完成',
        unfinalize: '撤销完成',
        checked: '已核对',
        finalized: '已完成',
      },
      ...props,
    },
    slots,
    global: {
      components: {
        VBtn: VBtnStub,
        VBtnToggle: passthroughStub('VBtnToggle'),
        VCard: passthroughStub('VCard', 'section'),
        VCardActions: passthroughStub('VCardActions'),
        VCardTitle: passthroughStub('VCardTitle'),
        VChip: passthroughStub('VChip', 'span'),
        VExpansionPanel: VExpansionPanelStub,
        VExpansionPanels: VExpansionPanelsStub,
        VExpansionPanelText: VExpansionPanelTextStub,
        VExpansionPanelTitle: VExpansionPanelTitleStub,
        VIcon: passthroughStub('VIcon', 'span'),
        VProgressLinear: passthroughStub('VProgressLinear'),
        VSelect: passthroughStub('VSelect'),
        VSpacer: passthroughStub('VSpacer'),
        VTable: VTableStub,
        VTextField: VTextFieldStub,
      },
    },
  })
}

describe('VoucherList', () => {
  it('使用适合窄屏的短列名', () => {
    const wrapper = mountList()

    expect(wrapper.findAll('th').map((heading) => heading.text())).toEqual([
      '单号',
      '日期',
      '往来方',
      '状态',
      '金额',
      '操作',
    ])
    expect(
      wrapper
        .getComponent({ name: 'MobileSortControl' })
        .props('options')
        .map((option: { value: string }) => option.value),
    ).toEqual(['documentNo', 'businessDate', 'status', 'amount'])
    expect(wrapper.findAll('th')[0]?.classes()).toContain(
      'voucher-list__column--compact',
    )
    expect(wrapper.findAll('th')[2]?.classes()).toContain(
      'voucher-list__column--fluid',
    )
  })

  it('聚合模式复用单据列表并关闭业务筛选和排序', () => {
    const row: VoucherListItem = {
      documentId: 'DOC-1',
      entity: 'sale-order',
      documentNo: 'SO-0001',
      status: 'DRAFT',
      revision: 1,
      businessDate: '2026-07-31',
      currency: 'CNY',
      amount: '100.00',
      updatedAt: '2026-07-31T00:00:00Z',
    }
    const wrapper = mountList(
      {
        rows: [row],
        filterable: false,
        sortable: false,
        showEntity: true,
      },
      {
        'cell-entity': () => '销售订单',
        'cell-status': () => '待核对',
        'cell-amount': () => 'CNY 100.00',
      },
    )

    expect(wrapper.findAll('th').map((heading) => heading.text())).toEqual([
      '类型',
      '单号',
      '日期',
      '往来方',
      '状态',
      '金额',
      '操作',
    ])
    expect(wrapper.text()).toContain('销售订单')
    expect(wrapper.text()).toContain('待核对')
    expect(wrapper.text()).toContain('CNY 100.00')
    expect(wrapper.findComponent({ name: 'MobileSortControl' }).exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-test="filter-toggle"]').exists()).toBe(false)
  })

  it('通过表头从默认单号降序切换方向', async () => {
    const wrapper = mountList()
    const numberHeader = wrapper
      .findAll('th')
      .find((heading) => heading.text() === '单号')

    await numberHeader?.trigger('click')
    await wrapper.setProps({ sort: { field: 'documentNo', order: 'asc' } })
    await numberHeader?.trigger('click')
    await wrapper.setProps({ sort: { field: 'documentNo', order: 'desc' } })

    expect(wrapper.emitted('update:sort')).toEqual([
      [{ field: 'documentNo', order: 'asc' }],
      [{ field: 'documentNo', order: 'desc' }],
    ])
    expect(
      wrapper
        .findAll('th')
        .find((heading) => heading.text() === '单号')
        ?.attributes('aria-sort'),
    ).toBe('descending')
  })

  it('默认收起筛选条件并允许反复展开和收起', async () => {
    const wrapper = mountList()
    const toggle = wrapper.get('[data-test="filter-toggle"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(false)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(true)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(false)
  })

  it('允许业务页面复用筛选面板并替换默认筛选字段', async () => {
    const wrapper = mountList({}, { filters: '<label>待办状态</label>' })

    await wrapper.get('[data-test="filter-toggle"]').trigger('click')

    expect(wrapper.text()).toContain('待办状态')
    expect(wrapper.text()).not.toContain('业务日期起')
  })

  it('折叠切换保留筛选值并继续发出查询和重置事件', async () => {
    const wrapper = mountList({ keyword: '华东客户' })
    const toggle = wrapper.get('[data-test="filter-toggle"]')

    await toggle.trigger('click')
    expect(
      wrapper.get('input[aria-label="单号或往来方关键字"]').attributes('value'),
    ).toBe('华东客户')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查询')
      ?.trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重置')
      ?.trigger('click')

    await toggle.trigger('click')
    await toggle.trigger('click')
    expect(
      wrapper.get('input[aria-label="单号或往来方关键字"]').attributes('value'),
    ).toBe('华东客户')
    expect(wrapper.emitted('query')).toHaveLength(1)
    expect(wrapper.emitted('reset')).toHaveLength(1)
  })

  it('新建入口独立于筛选面板并遵循权限和加载状态', async () => {
    const wrapper = mountList({ creatable: true })
    const createButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '新增')

    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(false)
    expect(createButton?.exists()).toBe(true)
    await createButton?.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)

    await wrapper.setProps({ loading: true })
    expect(createButton?.attributes('disabled')).toBeDefined()

    await wrapper.setProps({ creatable: false, loading: false })
    expect(
      wrapper.findAll('button').some((button) => button.text() === '新增'),
    ).toBe(false)
  })

  it('编辑和查看只显示当前可用的一个入口', () => {
    const row: VoucherListItem = {
      documentId: 'DOC-1',
      entity: 'sale-order',
      documentNo: 'SO-0001',
      status: 'DRAFT',
      revision: 1,
      businessDate: '2026-07-31',
      currency: 'CNY',
      amount: '100.00',
      updatedAt: '2026-07-31T00:00:00Z',
    }
    const editable = mountList({
      rows: [row],
      canView: () => true,
      canEdit: () => true,
    })

    expect(editable.find('[aria-label="编辑 SO-0001"]').exists()).toBe(true)
    expect(editable.find('[aria-label="查看 SO-0001"]').exists()).toBe(false)

    const readonly = mountList({
      rows: [row],
      canView: () => true,
      canEdit: () => false,
    })
    expect(readonly.find('[aria-label="编辑 SO-0001"]').exists()).toBe(false)
    expect(readonly.find('[aria-label="查看 SO-0001"]').exists()).toBe(true)
  })

  it('在销售订单列表显示 KG 履约摘要', () => {
    const wrapper = mountList({
      fulfillmentSummaryKind: 'sales',
      rows: [
        {
          documentId: 'DOC-SUMMARY',
          entity: 'sale-order',
          documentNo: 'SOR-20260731-0001',
          status: 'APPROVED',
          revision: 3,
          businessDate: '2026-07-31',
          currency: 'CNY',
          amount: '100.00',
          updatedAt: '2026-07-31T00:00:00Z',
          salesSummary: {
            unit: 'KG',
            excludedPackaging: true,
            warehouseAvailable: true,
            shortageQuantity: '10',
            orderedQuantity: '30',
            outboundQuantity: '20',
            inTransitQuantity: '5',
            signedQuantity: '15',
            netSignedQuantity: '12',
          },
        },
      ],
    })

    expect(wrapper.text()).toContain('订购 / 出库 / 净签收')
    expect(wrapper.text()).toContain('30 / 20 / 12KG')
    expect(wrapper.text()).toContain('不含包装物')
  })

  it('按状态和权限把流程动作直接显示在操作列', async () => {
    const row = (
      status: VoucherListItem['status'],
      documentNo: string,
    ): VoucherListItem => ({
      documentId: `DOC-${documentNo}`,
      entity: 'sale-order',
      documentNo,
      status,
      revision: 1,
      businessDate: '2026-07-31',
      currency: 'CNY',
      amount: '100.00',
      updatedAt: '2026-07-31T00:00:00Z',
    })
    const rows = [
      row('DRAFT', 'SO-DRAFT'),
      row('CHECKED', 'SO-CHECKED'),
      row('APPROVED', 'SO-APPROVED'),
      row('FINALIZED', 'SO-FINALIZED'),
    ]
    const allowed = new Set<VoucherLifecycleAction>([
      'check',
      'uncheck',
      'approve',
      'unapprove',
      'finalize',
      'unfinalize',
    ])
    const wrapper = mountList({
      rows,
      canLifecycleAction: (_, action) => allowed.has(action),
    })

    for (const label of [
      '核对 SO-DRAFT',
      '反核对 SO-CHECKED',
      '批准 SO-CHECKED',
      '反批准 SO-APPROVED',
      '完成 SO-APPROVED',
      '撤销完成 SO-FINALIZED',
    ]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[aria-label^="更多操作"]').exists()).toBe(false)

    await wrapper.get('[aria-label="核对 SO-DRAFT"]').trigger('click')
    expect(wrapper.emitted('lifecycle')).toEqual([[rows[0], 'check']])
  })

  it('不显示状态不匹配或无权限的流程动作', () => {
    const row: VoucherListItem = {
      documentId: 'DOC-1',
      entity: 'sale-order',
      documentNo: 'SO-0001',
      status: 'DRAFT',
      revision: 1,
      businessDate: '2026-07-31',
      currency: 'CNY',
      amount: '100.00',
      updatedAt: '2026-07-31T00:00:00Z',
    }
    const wrapper = mountList({
      rows: [row],
      canLifecycleAction: (_, action) => action === 'approve',
    })

    expect(wrapper.find('[aria-label="核对 SO-0001"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="批准 SO-0001"]').exists()).toBe(false)
  })
})
