import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, shallowRef } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/target/api.ts'
import OrderBlock from '@/target/components/document-page/OrderBlock.vue'
import {
  emptyOrder,
  type OrderDraft,
} from '@/target/components/document-page/order-data.ts'
import { emptyCustomer } from '@/target/components/version-page/customer-data.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  resolveTargetCustomer: vi.fn(),
}))
const candidate = {
  entity: 'customer' as const,
  objectId: 'customer',
  approvalEntryId: 'approved',
  code: 'CUS',
  name: '客户',
}
const warehouse = { objectId: 'warehouse', code: 'WH', name: '约定仓库' }
const stubs = {
  FormBlock: true,
  FieldInput: true,
  CollectionBlock: true,
  VAlert: true,
  VouReference: defineComponent({
    props: ['entity'],
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        props.entity === 'customer'
          ? h(
              'button',
              { onClick: () => emit('update:modelValue', candidate) },
              '选择客户',
            )
          : h('span')
    },
  }),
}
function editor(initial = emptyOrder('sale-order')) {
  const value = shallowRef<OrderDraft>(initial)
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(OrderBlock, {
          modelValue: value.value,
          disabled: false,
          'onUpdate:modelValue': (next) => {
            value.value = next
          },
        }),
    }),
    { global: { stubs } },
  )
  return { wrapper, value }
}
beforeEach(() => {
  setActivePinia(createPinia())
  useTargetSession().user = { id: 'user', code: 'user', name: '用户' }
  vi.resetAllMocks()
})
it('adopts customer special approval and warehouse when explicitly selecting a new order customer', async () => {
  vi.mocked(api.resolveTargetCustomer).mockResolvedValue({
    objectId: candidate.objectId,
    code: candidate.code,
    name: candidate.name,
    enabled: true,
    sourceApprovalEntryId: candidate.approvalEntryId,
    sourceVersionNo: 1,
    data: {
      ...emptyCustomer(),
      defaultSpecialApproval: true,
      defaultOutboundWarehouse: warehouse,
    },
  })
  const { wrapper, value } = editor()
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(value.value.specialApproval).toBe(true)
  expect(value.value.warehouse).toEqual({ entity: 'warehouse', ...warehouse })
  wrapper.unmount()
})
it('opening a saved order preserves its final special approval and warehouse without rereading current customer defaults', async () => {
  const initial = {
    ...emptyOrder('sale-order'),
    counterparty: candidate,
    specialApproval: false,
    warehouse: {
      entity: 'warehouse' as const,
      objectId: 'saved',
      code: 'S',
      name: '原订单仓库',
    },
  }
  const { wrapper, value } = editor(initial)
  await flushPromises()
  expect(api.resolveTargetCustomer).not.toHaveBeenCalled()
  expect(value.value.specialApproval).toBe(false)
  expect(value.value.warehouse).toEqual(initial.warehouse)
  wrapper.unmount()
})
